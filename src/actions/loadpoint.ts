import {
  action,
  type DidReceiveSettingsEvent,
  type KeyAction,
  type KeyDownEvent,
  type KeyUpEvent,
  SingletonAction,
  type TitleParametersDidChangeEvent,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";
import { PLUGIN_ID } from "../config";
import { type ChargeMode, nextMode } from "../evcc/model";
import { evcc } from "../evcc/service";
import { loadpointKey, messageKey } from "../render/keys";
import { formatPower, loadpointCaption } from "../render/values";
import { showImage, updates } from "../throttle";

export type LoadpointSettings = {
  /** 0-based loadpoint index, as a string (select values are strings). */
  loadpoint?: string;
};

/** Holding a key this long sets the charge mode to off instead of cycling it. */
export const LONG_PRESS_MS = 600;

/** Image for keys that cannot show a loadpoint (not configured, offline, nothing selected). */
export function unavailableImage(loadpoint: string | undefined): string | undefined {
  if (evcc.state === "unconfigured") {
    return messageKey("Connect", "see settings");
  }
  if (loadpoint === undefined || loadpoint === "") {
    return messageKey("Select", "a loadpoint");
  }
  if (!evcc.isConnected) {
    return messageKey("Offline", evcc.state === "error" ? "check URL" : "connecting…");
  }
  if (!evcc.loadpoint(loadpoint)) {
    return messageKey("Unknown", "loadpoint");
  }
  return undefined;
}

/** A key showing one loadpoint; pressing it cycles the charge mode, holding it switches charging off. */
@action({ UUID: `${PLUGIN_ID}.loadpoint` })
export class LoadpointAction extends SingletonAction<LoadpointSettings> {
  readonly #settings = new Map<string, LoadpointSettings>();
  /** Keys with a user-defined title: the loadpoint title is not drawn into the image then. */
  readonly #hasTitle = new Map<string, boolean>();
  /** Long-press timers of currently pressed keys. */
  readonly #pressTimers = new Map<string, ReturnType<typeof setTimeout>>();

  override onWillAppear(ev: WillAppearEvent<LoadpointSettings>): Promise<void> {
    this.#settings.set(ev.action.id, ev.payload.settings);
    return this.#render(ev.action.id);
  }

  override onWillDisappear(ev: WillDisappearEvent<LoadpointSettings>): void {
    this.#settings.delete(ev.action.id);
    this.#hasTitle.delete(ev.action.id);
    this.#clearPress(ev.action.id);
    updates.forget(ev.action.id);
  }

  override onDidReceiveSettings(ev: DidReceiveSettingsEvent<LoadpointSettings>): Promise<void> {
    this.#settings.set(ev.action.id, ev.payload.settings);
    return this.#render(ev.action.id);
  }

  override onTitleParametersDidChange(ev: TitleParametersDidChangeEvent<LoadpointSettings>): Promise<void> {
    this.#hasTitle.set(ev.action.id, ev.payload.title.trim() !== "");
    return this.#render(ev.action.id);
  }

  override onKeyDown(ev: KeyDownEvent<LoadpointSettings>): void {
    this.#clearPress(ev.action.id);
    const timer = setTimeout(() => {
      // Long press: switch charging off while the key is still held.
      this.#pressTimers.delete(ev.action.id);
      void this.#setMode(ev.action, ev.payload.settings, "off");
    }, LONG_PRESS_MS);
    this.#pressTimers.set(ev.action.id, timer);
  }

  override async onKeyUp(ev: KeyUpEvent<LoadpointSettings>): Promise<void> {
    if (!this.#pressTimers.has(ev.action.id)) {
      // The long press already fired.
      return;
    }
    this.#clearPress(ev.action.id);
    const loadpoint = evcc.loadpoint(ev.payload.settings.loadpoint);
    await this.#setMode(ev.action, ev.payload.settings, nextMode(loadpoint?.mode));
  }

  /** Re-renders all visible keys, or only those showing loadpoint `index`. */
  async refresh(index?: number): Promise<void> {
    for (const [id, settings] of this.#settings) {
      if (index === undefined || Number(settings.loadpoint) === index) {
        await this.#render(id);
      }
    }
  }

  async #setMode(key: KeyAction<LoadpointSettings>, settings: LoadpointSettings, mode: ChargeMode): Promise<void> {
    const loadpoint = evcc.loadpoint(settings.loadpoint);
    const ok = loadpoint ? await evcc.setMode(loadpoint, mode) : false;
    if (!ok) {
      await key.showAlert();
    }
  }

  #clearPress(actionId: string): void {
    const timer = this.#pressTimers.get(actionId);
    if (timer) {
      clearTimeout(timer);
      this.#pressTimers.delete(actionId);
    }
  }

  async #render(actionId: string): Promise<void> {
    const key = this.actions.find((a) => a.id === actionId) as KeyAction<LoadpointSettings> | undefined;
    const settings = this.#settings.get(actionId);
    if (!key || !settings) {
      return;
    }

    const unavailable = unavailableImage(settings.loadpoint);
    const loadpoint = evcc.loadpoint(settings.loadpoint);
    if (unavailable || !loadpoint) {
      showImage(key, unavailable);
      return;
    }

    showImage(
      key,
      loadpointKey({
        name: this.#hasTitle.get(actionId) ? undefined : loadpoint.title,
        mode: loadpoint.mode,
        ...formatPower(loadpoint.chargePower),
        caption: loadpointCaption(loadpoint),
        soc: loadpoint.vehicleSoc,
        charging: loadpoint.charging,
        connected: loadpoint.connected,
      }),
    );
  }
}
