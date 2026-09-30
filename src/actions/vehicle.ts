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
import { nextVehicle, type Vehicle } from "../evcc/model";
import { evcc } from "../evcc/service";
import { vehicleKey } from "../render/keys";
import { showImage, updates } from "../throttle";
import { LONG_PRESS_MS, type LoadpointSettings, unavailableImage } from "./loadpoint";

/**
 * A key showing the vehicle assigned to a loadpoint. Pressing it assigns the
 * next configured vehicle (after the last one: the guest vehicle), holding it
 * removes the vehicle. Useful when evcc does not detect the vehicle itself.
 */
@action({ UUID: `${PLUGIN_ID}.vehicle` })
export class VehicleAction extends SingletonAction<LoadpointSettings> {
  readonly #settings = new Map<string, LoadpointSettings>();
  readonly #hasTitle = new Map<string, boolean>();
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
      // Long press: back to the guest vehicle while the key is still held.
      this.#pressTimers.delete(ev.action.id);
      void this.#setVehicle(ev.action, ev.payload.settings, undefined);
    }, LONG_PRESS_MS);
    this.#pressTimers.set(ev.action.id, timer);
  }

  override async onKeyUp(ev: KeyUpEvent<LoadpointSettings>): Promise<void> {
    if (!this.#pressTimers.has(ev.action.id)) {
      return;
    }
    this.#clearPress(ev.action.id);
    const loadpoint = evcc.loadpoint(ev.payload.settings.loadpoint);
    await this.#setVehicle(ev.action, ev.payload.settings, nextVehicle(evcc.vehicles(), loadpoint?.vehicleName));
  }

  /** Re-renders all visible keys, or only those showing loadpoint `index`. */
  async refresh(index?: number): Promise<void> {
    for (const [id, settings] of this.#settings) {
      if (index === undefined || Number(settings.loadpoint) === index) {
        await this.#render(id);
      }
    }
  }

  async #setVehicle(key: KeyAction<LoadpointSettings>, settings: LoadpointSettings, vehicle: Vehicle | undefined): Promise<void> {
    const loadpoint = evcc.loadpoint(settings.loadpoint);
    const ok = loadpoint ? await evcc.setVehicle(loadpoint, vehicle) : false;
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
    const vehicle = loadpoint.vehicleName ? evcc.vehicles().find((v) => v.name === loadpoint.vehicleName) : undefined;
    showImage(
      key,
      vehicleKey({
        name: this.#hasTitle.get(actionId) ? undefined : loadpoint.title,
        vehicle: vehicle?.title ?? loadpoint.vehicleTitle,
        soc: loadpoint.vehicleSoc,
        connected: loadpoint.connected,
        charging: loadpoint.charging,
      }),
    );
  }
}
