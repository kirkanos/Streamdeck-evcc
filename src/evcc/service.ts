import { EventEmitter } from "node:events";
import type { ChargeMode, EvccState, Loadpoint, Site } from "./model";
import { StateStore } from "./state";

export type EvccSettings = { url?: string };

export type ConnectionState = "unconfigured" | "connecting" | "connected" | "error";

export type ProbeResult = { ok: true; loadpointCount: number; version?: string } | { ok: false; error: string };

/** REST polling interval while the WebSocket is not delivering updates. */
export const POLL_INTERVAL_MS = 10_000;
const REQUEST_TIMEOUT_MS = 10_000;
const WS_RETRY_MIN_MS = 5_000;
const WS_RETRY_MAX_MS = 60_000;

/** Removes trailing slashes and a trailing /api from a user-entered base URL. */
export function normalizeUrl(url: string): string {
  return url
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/api$/, "");
}

/** ws(s):// URL of the evcc WebSocket for a http(s):// base URL. */
export function websocketUrl(baseUrl: string): string {
  return `${baseUrl.replace(/^http/i, "ws")}/ws`;
}

/**
 * Keeps the live state of one evcc instance.
 *
 * The full state is loaded with GET /api/state; afterwards deltas arrive over
 * the WebSocket /ws. While the WebSocket is down, the state is polled every
 * 10 s and the WebSocket is retried with backoff.
 *
 * Events:
 *   "site"             a site value changed (PV, grid, battery, home)
 *   "loadpoint" (index) one loadpoint changed
 *   "loadpoints"       the number or names of loadpoints changed
 *   "state"            the connection state changed
 */
export class EvccService extends EventEmitter<{ site: []; loadpoint: [number]; loadpoints: []; state: [] }> {
  #settings: EvccSettings = {};
  #state: ConnectionState = "unconfigured";
  #error: string | undefined;
  readonly #store = new StateStore();

  #socket: WebSocket | undefined;
  #socketOpen = false;
  #retryDelay = WS_RETRY_MIN_MS;
  #retryTimer: ReturnType<typeof setTimeout> | undefined;
  #pollTimer: ReturnType<typeof setTimeout> | undefined;
  /** Incremented on every configure() so stale async work can bail out. */
  #generation = 0;

  get settings(): EvccSettings {
    return this.#settings;
  }

  get state(): ConnectionState {
    return this.#state;
  }

  get error(): string | undefined {
    return this.#error;
  }

  get isConnected(): boolean {
    return this.#state === "connected";
  }

  get data(): EvccState {
    return this.#store.state;
  }

  get site(): Site {
    return this.#store.state.site;
  }

  loadpoints(): Loadpoint[] {
    return this.#store.state.loadpoints;
  }

  /** Loadpoint by 0-based index (settings store it as a string). */
  loadpoint(index: string | number | undefined): Loadpoint | undefined {
    if (index === undefined || index === "") {
      return undefined;
    }
    return this.#store.state.loadpoints[Number(index)];
  }

  /** Applies new connection settings; reconnects only when the URL changed. */
  configure(settings: EvccSettings): void {
    const url = settings.url ? normalizeUrl(settings.url) : undefined;
    if (url === this.#settings.url && (this.#socket || this.#pollTimer || this.#retryTimer)) {
      return;
    }
    this.#settings = { url };
    this.#disconnect();
    this.#store.replace({});
    this.emit("loadpoints");

    if (url) {
      this.#setState("connecting");
      void this.#poll();
      this.#openSocket();
    } else {
      this.#setState("unconfigured");
    }
  }

  /** Checks that `url` answers on /api/state, without touching the live connection. */
  async probe(url: string): Promise<ProbeResult> {
    try {
      const raw = await this.#getJson(normalizeUrl(url), "/api/state");
      const state = new StateStore();
      state.replace(raw);
      const version = (raw as { result?: { version?: unknown }; version?: unknown })?.result?.version ?? (raw as { version?: unknown })?.version;
      return { ok: true, loadpointCount: state.state.loadpoints.length, version: typeof version === "string" ? version : undefined };
    } catch (err) {
      return { ok: false, error: describeError(err, url) };
    }
  }

  setMode(loadpoint: Loadpoint, mode: ChargeMode): Promise<boolean> {
    return this.#post(loadpoint, `mode/${mode}`, () => {
      loadpoint.mode = mode;
    });
  }

  setMinCurrent(loadpoint: Loadpoint, amps: number): Promise<boolean> {
    return this.#post(loadpoint, `mincurrent/${amps}`, () => {
      loadpoint.minCurrent = amps;
    });
  }

  setLimitSoc(loadpoint: Loadpoint, soc: number): Promise<boolean> {
    return this.#post(loadpoint, `limitsoc/${soc}`, () => {
      loadpoint.limitSoc = soc;
    });
  }

  async #post(loadpoint: Loadpoint, path: string, applyLocally: () => void): Promise<boolean> {
    const url = this.#settings.url;
    if (!url || !this.isConnected) {
      return false;
    }
    try {
      const response = await fetch(`${url}/api/loadpoints/${loadpoint.id}/${path}`, {
        method: "POST",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        return false;
      }
      // Show the change right away; evcc confirms it over the WebSocket.
      applyLocally();
      this.emit("loadpoint", loadpoint.index);
      return true;
    } catch {
      return false;
    }
  }

  async #getJson(url: string, path: string): Promise<unknown> {
    const response = await fetch(`${url}${path}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
  }

  /** Loads the full state over REST; reschedules itself while the WebSocket is down. */
  async #poll(): Promise<void> {
    const url = this.#settings.url;
    const generation = this.#generation;
    if (!url) {
      return;
    }
    clearTimeout(this.#pollTimer);
    this.#pollTimer = undefined;

    try {
      const raw = await this.#getJson(url, "/api/state");
      if (generation !== this.#generation) {
        return;
      }
      this.#applyChanges(this.#store.replace(raw));
      this.#setState("connected");
    } catch (err) {
      if (generation !== this.#generation) {
        return;
      }
      this.#setState("error", describeError(err, url));
    }

    if (!this.#socketOpen) {
      this.#pollTimer = setTimeout(() => void this.#poll(), POLL_INTERVAL_MS);
    }
  }

  #openSocket(): void {
    const url = this.#settings.url;
    if (!url || this.#socket) {
      return;
    }
    let socket: WebSocket;
    try {
      socket = new WebSocket(websocketUrl(url));
    } catch {
      this.#scheduleSocketRetry();
      return;
    }
    this.#socket = socket;

    socket.addEventListener("open", () => {
      this.#socketOpen = true;
      this.#retryDelay = WS_RETRY_MIN_MS;
      // evcc sends its full state right after the connection opens, but a
      // REST snapshot makes sure nothing is missed between the two channels.
      void this.#poll();
    });

    socket.addEventListener("message", (ev) => {
      let delta: unknown;
      try {
        delta = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      this.#applyChanges(this.#store.apply(delta));
      if (this.#state !== "connected") {
        this.#setState("connected");
      }
    });

    const onClose = () => {
      if (this.#socket !== socket) {
        return;
      }
      this.#socket = undefined;
      this.#socketOpen = false;
      this.#scheduleSocketRetry();
      // Fall back to polling; it also reports the connection state.
      if (!this.#pollTimer) {
        this.#pollTimer = setTimeout(() => void this.#poll(), POLL_INTERVAL_MS);
      }
    };
    socket.addEventListener("close", onClose);
    socket.addEventListener("error", () => {
      // "error" is always followed by "close"; closing here makes sure of it.
      try {
        socket.close();
      } catch {
        // ignore
      }
    });
  }

  #scheduleSocketRetry(): void {
    clearTimeout(this.#retryTimer);
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = undefined;
      this.#openSocket();
    }, this.#retryDelay);
    this.#retryDelay = Math.min(WS_RETRY_MAX_MS, this.#retryDelay * 2);
  }

  #applyChanges(changes: { site: boolean; loadpoints: Set<number>; list: boolean }): void {
    if (changes.list) {
      this.emit("loadpoints");
    }
    if (changes.site) {
      this.emit("site");
    }
    for (const index of changes.loadpoints) {
      this.emit("loadpoint", index);
    }
  }

  #disconnect(): void {
    this.#generation++;
    clearTimeout(this.#pollTimer);
    clearTimeout(this.#retryTimer);
    this.#pollTimer = undefined;
    this.#retryTimer = undefined;
    this.#retryDelay = WS_RETRY_MIN_MS;
    const socket = this.#socket;
    this.#socket = undefined;
    this.#socketOpen = false;
    try {
      socket?.close();
    } catch {
      // ignore
    }
  }

  #setState(state: ConnectionState, error?: string): void {
    if (state === this.#state && error === this.#error) {
      return;
    }
    this.#state = state;
    this.#error = error;
    this.emit("state");
  }
}

function describeError(err: unknown, url: string): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/HTTP \d+/.test(message)) {
    return `${url}: ${message}`;
  }
  if (/abort|timeout/i.test(message)) {
    return `Cannot reach ${url}: timeout`;
  }
  const cause = (err as { cause?: { code?: string; message?: string } })?.cause;
  return `Cannot reach ${url}: ${cause?.code ?? cause?.message ?? message}`;
}

export const evcc = new EvccService();
