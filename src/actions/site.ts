import {
  action,
  type DidReceiveSettingsEvent,
  type KeyAction,
  type KeyDownEvent,
  SingletonAction,
  type TitleParametersDidChangeEvent,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";
import { PLUGIN_ID } from "../config";
import { evcc } from "../evcc/service";
import { messageKey, siteKey } from "../render/keys";
import { nextSiteValue, SITE_VALUE_ORDER, siteDisplay, type SiteValue } from "../render/values";
import { showImage, updates } from "../throttle";

export type SiteSettings = {
  value?: SiteValue;
};

/** A key showing PV, grid, battery or home power of the site; pressing it cycles the value. */
@action({ UUID: `${PLUGIN_ID}.site` })
export class SiteAction extends SingletonAction<SiteSettings> {
  readonly #settings = new Map<string, SiteSettings>();
  readonly #hasTitle = new Map<string, boolean>();

  override onWillAppear(ev: WillAppearEvent<SiteSettings>): Promise<void> {
    this.#settings.set(ev.action.id, ev.payload.settings);
    return this.#render(ev.action.id);
  }

  override onWillDisappear(ev: WillDisappearEvent<SiteSettings>): void {
    this.#settings.delete(ev.action.id);
    this.#hasTitle.delete(ev.action.id);
    updates.forget(ev.action.id);
  }

  override onDidReceiveSettings(ev: DidReceiveSettingsEvent<SiteSettings>): Promise<void> {
    this.#settings.set(ev.action.id, ev.payload.settings);
    return this.#render(ev.action.id);
  }

  override onTitleParametersDidChange(ev: TitleParametersDidChangeEvent<SiteSettings>): Promise<void> {
    this.#hasTitle.set(ev.action.id, ev.payload.title.trim() !== "");
    return this.#render(ev.action.id);
  }

  override async onKeyDown(ev: KeyDownEvent<SiteSettings>): Promise<void> {
    const settings = { ...ev.payload.settings, value: nextSiteValue(ev.payload.settings.value) };
    this.#settings.set(ev.action.id, settings);
    await ev.action.setSettings(settings);
    await this.#render(ev.action.id);
  }

  async refresh(): Promise<void> {
    for (const id of this.#settings.keys()) {
      await this.#render(id);
    }
  }

  async #render(actionId: string): Promise<void> {
    const key = this.actions.find((a) => a.id === actionId) as KeyAction<SiteSettings> | undefined;
    const settings = this.#settings.get(actionId);
    if (!key || !settings) {
      return;
    }

    if (evcc.state === "unconfigured") {
      showImage(key, messageKey("Connect", "see settings"));
      return;
    }
    if (!evcc.isConnected) {
      showImage(key, messageKey("Offline", evcc.state === "error" ? "check URL" : "connecting…"));
      return;
    }

    const value = settings.value ?? "pv";
    const site = evcc.site;
    const main = siteDisplay(site, value);
    const others = SITE_VALUE_ORDER.filter((v) => v !== value).map((v) => {
      const d = siteDisplay(site, v);
      return { label: d.short, value: d.value, unit: d.unit };
    });

    showImage(
      key,
      siteKey({
        name: this.#hasTitle.get(actionId) ? undefined : site.title,
        color: main.color,
        value: main.value,
        unit: main.unit,
        caption: main.caption,
        others,
      }),
    );
  }
}
