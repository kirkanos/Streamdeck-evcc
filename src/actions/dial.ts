import {
  action,
  type DialAction,
  type DialDownEvent,
  type DialRotateEvent,
  type DialUpEvent,
  type DidReceiveSettingsEvent,
  SingletonAction,
  type TouchTapEvent,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";
import { PLUGIN_ID } from "../config";
import { type Loadpoint, modesFromSettings, nextMode, stepLimitSoc, stepMinCurrent } from "../evcc/model";
import { evcc } from "../evcc/service";
import { dialCanvas, dialMessage } from "../render/dial";
import { formatPower, loadpointCaption } from "../render/values";
import { updates } from "../throttle";
import { LONG_PRESS_MS } from "./loadpoint";

export type DialFunction = "minCurrent" | "limitSoc";

export type DialSettings = {
  /** 0-based loadpoint index, as a string (select values are strings). */
  loadpoint?: string;
  function?: DialFunction;
  /** Charge modes the push cycles through; all when unset. */
  modes?: string[];
};

/** Turning the dial is sent to evcc once the dial has been still for this long. */
export const ROTATE_SETTLE_MS = 500;

type Pending = { value: number; timer: ReturnType<typeof setTimeout> };

/** A dial adjusting the min current or the charge limit of one loadpoint; the touch strip shows its state. */
@action({ UUID: `${PLUGIN_ID}.dial` })
export class LoadpointDialAction extends SingletonAction<DialSettings> {
  readonly #settings = new Map<string, DialSettings>();
  /** Values turned to but not yet sent, per dial. */
  readonly #pending = new Map<string, Pending>();
  /** Long-push timers of currently pushed dials. */
  readonly #pushTimers = new Map<string, ReturnType<typeof setTimeout>>();

  override onWillAppear(ev: WillAppearEvent<DialSettings>): Promise<void> {
    this.#settings.set(ev.action.id, ev.payload.settings);
    return this.#render(ev.action.id);
  }

  override onWillDisappear(ev: WillDisappearEvent<DialSettings>): void {
    this.#settings.delete(ev.action.id);
    this.#dropPending(ev.action.id);
    this.#clearPush(ev.action.id);
    updates.forget(ev.action.id);
  }

  override onDidReceiveSettings(ev: DidReceiveSettingsEvent<DialSettings>): Promise<void> {
    this.#settings.set(ev.action.id, ev.payload.settings);
    this.#dropPending(ev.action.id);
    return this.#render(ev.action.id);
  }

  override async onDialRotate(ev: DialRotateEvent<DialSettings>): Promise<void> {
    const settings = ev.payload.settings;
    const loadpoint = evcc.loadpoint(settings.loadpoint);
    if (!loadpoint || !evcc.isConnected || ev.payload.ticks === 0) {
      return;
    }
    const fn = settings.function ?? "minCurrent";
    const current = this.#pending.get(ev.action.id)?.value ?? (fn === "limitSoc" ? loadpoint.limitSoc : loadpoint.minCurrent);
    const value = fn === "limitSoc" ? stepLimitSoc(current, ev.payload.ticks) : stepMinCurrent(current, ev.payload.ticks);

    // Coalesce fast turns into one request once the dial rests.
    this.#dropPending(ev.action.id);
    const timer = setTimeout(() => void this.#commit(ev.action, loadpoint, fn, value), ROTATE_SETTLE_MS);
    this.#pending.set(ev.action.id, { value, timer });
    await this.#render(ev.action.id);
  }

  override onDialDown(ev: DialDownEvent<DialSettings>): void {
    this.#clearPush(ev.action.id);
    const timer = setTimeout(() => {
      // Long push: toggle "always charge" while the dial is still held.
      this.#pushTimers.delete(ev.action.id);
      void this.#toggleAlwaysCharge(ev.action, ev.payload.settings);
    }, LONG_PRESS_MS);
    this.#pushTimers.set(ev.action.id, timer);
  }

  override onDialUp(ev: DialUpEvent<DialSettings>): Promise<void> {
    if (!this.#pushTimers.has(ev.action.id)) {
      // The long push already fired.
      return Promise.resolve();
    }
    this.#clearPush(ev.action.id);
    return this.#cycleMode(ev.action, ev.payload.settings);
  }

  override onTouchTap(ev: TouchTapEvent<DialSettings>): Promise<void> {
    return this.#cycleMode(ev.action, ev.payload.settings);
  }

  /** Re-renders all visible dials, or only those showing loadpoint `index`. */
  async refresh(index?: number): Promise<void> {
    for (const [id, settings] of this.#settings) {
      if (index === undefined || Number(settings.loadpoint) === index) {
        await this.#render(id);
      }
    }
  }

  async #commit(dial: DialAction<DialSettings>, loadpoint: Loadpoint, fn: DialFunction, value: number): Promise<void> {
    this.#pending.delete(dial.id);
    const ok = fn === "limitSoc" ? await evcc.setLimitSoc(loadpoint, value) : await evcc.setMinCurrent(loadpoint, value);
    if (!ok) {
      await dial.showAlert();
    }
    await this.#render(dial.id);
  }

  async #cycleMode(dial: DialAction<DialSettings>, settings: DialSettings): Promise<void> {
    const loadpoint = evcc.loadpoint(settings.loadpoint);
    const ok = loadpoint ? await evcc.setMode(loadpoint, nextMode(loadpoint.mode, modesFromSettings(settings.modes))) : false;
    if (!ok) {
      await dial.showAlert();
    }
  }

  async #toggleAlwaysCharge(dial: DialAction<DialSettings>, settings: DialSettings): Promise<void> {
    const loadpoint = evcc.loadpoint(settings.loadpoint);
    const ok = loadpoint ? await evcc.setAlwaysCharge(loadpoint, !loadpoint.alwaysCharge) : false;
    if (!ok) {
      await dial.showAlert();
    }
    await this.#render(dial.id);
  }

  #clearPush(actionId: string): void {
    const timer = this.#pushTimers.get(actionId);
    if (timer) {
      clearTimeout(timer);
      this.#pushTimers.delete(actionId);
    }
  }

  #dropPending(actionId: string): void {
    const pending = this.#pending.get(actionId);
    if (pending) {
      clearTimeout(pending.timer);
      this.#pending.delete(actionId);
    }
  }

  async #render(actionId: string): Promise<void> {
    const dial = this.actions.find((a) => a.id === actionId);
    const settings = this.#settings.get(actionId);
    if (!dial?.isDial() || !settings) {
      return;
    }

    const loadpoint = evcc.loadpoint(settings.loadpoint);
    let canvas: string;
    if (evcc.state === "unconfigured") {
      canvas = dialMessage("Connect", "open the dial settings");
    } else if (!evcc.isConnected) {
      canvas = dialMessage("Offline", evcc.state === "error" ? "check URL" : "connecting…");
    } else if (!loadpoint) {
      canvas = dialMessage("Select", `a loadpoint (${evcc.loadpoints().length} found)`);
    } else {
      const fn = settings.function ?? "minCurrent";
      const pending = this.#pending.get(actionId);
      const raw = pending?.value ?? (fn === "limitSoc" ? loadpoint.limitSoc : loadpoint.minCurrent);
      const target =
        fn === "limitSoc"
          ? { value: raw === undefined ? "–" : raw === 0 ? "none" : String(Math.round(raw)), unit: raw ? "%" : undefined, label: "limit SoC" }
          : { value: raw === undefined ? "–" : String(Math.round(raw)), unit: "A", label: "min current" };
      canvas = dialCanvas({
        title: loadpoint.title,
        mode: loadpoint.mode,
        ...formatPower(loadpoint.chargePower),
        caption: loadpointCaption(loadpoint),
        soc: loadpoint.vehicleSoc,
        charging: loadpoint.charging,
        connected: loadpoint.connected,
        alwaysCharge: loadpoint.alwaysCharge,
        target: { ...target, pending: pending !== undefined },
      });
    }
    updates.update(dial.id, canvas, (value) => dial.setFeedback({ canvas: value }));
  }
}
