import { type EvccState, isChargeMode, type Loadpoint, type Site } from "./model";

/**
 * Turns the JSON of GET /api/state into an EvccState, and applies the deltas
 * pushed over the WebSocket.
 *
 * evcc's state shape varies between versions: the REST response is either the
 * state itself or wrapped in `result`, grid power is `gridPower` or
 * `grid.power`, the charge limit is `limitSoc` or `targetSoc`. The WebSocket
 * sends objects like { "loadpoints.0.mode": "pv", "pvPower": 1234 }. Every
 * accessor here tolerates missing or oddly typed values.
 */

type Raw = Record<string, unknown>;

function isObject(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function num(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function bool(value: unknown): boolean {
  return value === true || value === 1 || value === "true";
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

/** Unwraps { result: {...} } as returned by newer evcc versions. */
export function unwrapState(raw: unknown): Raw {
  if (!isObject(raw)) {
    return {};
  }
  return isObject(raw.result) ? raw.result : raw;
}

export function normalizeSite(raw: Raw): Site {
  const grid = isObject(raw.grid) ? raw.grid : undefined;
  return {
    title: str(raw.siteTitle),
    pvPower: num(raw.pvPower),
    gridPower: num(raw.gridPower) ?? num(grid?.power),
    homePower: num(raw.homePower),
    batteryPower: num(raw.batteryPower),
    batterySoc: num(raw.batterySoc),
  };
}

export function normalizeLoadpoint(raw: unknown, index: number): Loadpoint {
  const lp = isObject(raw) ? raw : {};
  const mode = lp.mode;
  return {
    index,
    id: index + 1,
    title: str(lp.title) ?? `Loadpoint ${index + 1}`,
    mode: isChargeMode(mode) ? mode : undefined,
    chargePower: num(lp.chargePower),
    charging: bool(lp.charging),
    connected: bool(lp.connected),
    enabled: bool(lp.enabled),
    vehicleName: str(lp.vehicleName),
    vehicleTitle: str(lp.vehicleTitle),
    vehicleSoc: num(lp.vehicleSoc),
    minCurrent: num(lp.minCurrent),
    maxCurrent: num(lp.maxCurrent),
    limitSoc: num(lp.limitSoc) ?? num(lp.targetSoc),
    chargeRemainingDuration: num(lp.chargeRemainingDuration),
    chargedEnergy: num(lp.chargedEnergy),
  };
}

export function normalizeState(raw: unknown): EvccState {
  const state = unwrapState(raw);
  const loadpoints = Array.isArray(state.loadpoints) ? state.loadpoints : [];
  return {
    site: normalizeSite(state),
    loadpoints: loadpoints.map((lp, index) => normalizeLoadpoint(lp, index)),
  };
}

/** Which parts of the state a delta touched. */
export type Changes = {
  site: boolean;
  /** Indices of changed loadpoints. */
  loadpoints: Set<number>;
  /** The number of loadpoints changed. */
  list: boolean;
};

/** Parses a WebSocket key like "loadpoints.0.mode" into its loadpoint index and field. */
export function parseLoadpointKey(key: string): { index: number; field: string } | undefined {
  const match = /^loadpoints\.(\d+)\.(.+)$/.exec(key);
  return match ? { index: Number(match[1]), field: match[2] } : undefined;
}

/**
 * Holds the raw state tree and the normalized view of it. Deltas from the
 * WebSocket are applied to the raw tree, then the affected parts are
 * normalized again.
 */
export class StateStore {
  #raw: Raw = {};
  #state: EvccState = { site: {}, loadpoints: [] };

  get state(): EvccState {
    return this.#state;
  }

  /** Replaces everything with the response of GET /api/state. */
  replace(raw: unknown): Changes {
    const before = this.#state.loadpoints.length;
    // Own copy: deltas are applied in place and must not leak into the caller's object.
    this.#raw = structuredClone(unwrapState(raw));
    if (!Array.isArray(this.#raw.loadpoints)) {
      this.#raw.loadpoints = [];
    }
    this.#state = normalizeState(this.#raw);
    return { site: true, loadpoints: new Set(this.#state.loadpoints.map((lp) => lp.index)), list: before !== this.#state.loadpoints.length };
  }

  /** Applies one WebSocket message; unknown keys are kept in the raw tree but ignored. */
  apply(delta: unknown): Changes {
    const changes: Changes = { site: false, loadpoints: new Set(), list: false };
    if (!isObject(delta)) {
      return changes;
    }
    const loadpoints = this.#raw.loadpoints as unknown[];

    for (const [key, value] of Object.entries(delta)) {
      const lpKey = parseLoadpointKey(key);
      if (lpKey) {
        while (loadpoints.length <= lpKey.index) {
          loadpoints.push({});
          changes.list = true;
        }
        const lp = loadpoints[lpKey.index];
        if (isObject(lp)) {
          lp[lpKey.field] = value;
          changes.loadpoints.add(lpKey.index);
        }
      } else if (key === "loadpoints") {
        if (Array.isArray(value)) {
          this.#raw.loadpoints = value;
          changes.list = true;
          for (let i = 0; i < value.length; i++) {
            changes.loadpoints.add(i);
          }
        }
      } else if (key.includes(".")) {
        // Nested site values like "grid.power" or "pv.0.power".
        const [head, ...rest] = key.split(".");
        const target = isObject(this.#raw[head]) ? (this.#raw[head] as Raw) : (this.#raw[head] = {});
        setPath(target, rest, value);
        changes.site = true;
      } else {
        this.#raw[key] = value;
        changes.site = true;
      }
    }

    if (changes.site || changes.list || changes.loadpoints.size > 0) {
      this.#state = normalizeState(this.#raw);
    }
    return changes;
  }
}

function setPath(target: Raw, path: string[], value: unknown): void {
  let current = target;
  for (let i = 0; i < path.length - 1; i++) {
    const next = current[path[i]];
    if (!isObject(next)) {
      current[path[i]] = {};
    }
    current = current[path[i]] as Raw;
  }
  if (path.length > 0) {
    current[path[path.length - 1]] = value;
  }
}
