import streamDeck from "@elgato/streamdeck";
import { LoadpointDialAction } from "./actions/dial";
import { LoadpointAction } from "./actions/loadpoint";
import { SiteAction } from "./actions/site";
import { evcc, type EvccSettings } from "./evcc/service";

type JsonValue = Parameters<typeof streamDeck.ui.sendToPropertyInspector>[0];

streamDeck.logger.setLevel("info");

const loadpoint = new LoadpointAction();
const site = new SiteAction();
const dial = new LoadpointDialAction();

streamDeck.actions.registerAction(loadpoint);
streamDeck.actions.registerAction(site);
streamDeck.actions.registerAction(dial);

// Keep every visible key and dial in sync with evcc.

evcc.on("loadpoint", (index) => {
  void loadpoint.refresh(index);
  void dial.refresh(index);
});

evcc.on("site", () => void site.refresh());

function refreshAll(): void {
  void loadpoint.refresh();
  void site.refresh();
  void dial.refresh();
}

evcc.on("loadpoints", () => {
  refreshAll();
  // Property inspectors with a hot-reloading loadpoint list pick this up.
  sendToPropertyInspector({ event: "getLoadpoints", items: loadpointItems() });
});

evcc.on("state", () => {
  streamDeck.logger.info(`evcc connection: ${evcc.state}${evcc.error ? ` (${evcc.error})` : ""}`);
  refreshAll();
  sendToPropertyInspector(statusMessage());
});

// Messages from the property inspectors (ui/*.html).

type UiMessage = { event: "getLoadpoints" | "getStatus" } | { event: "connect"; url: string };

streamDeck.ui.onSendToPlugin<UiMessage>(async (ev) => {
  const message = ev.payload;
  switch (message.event) {
    case "getLoadpoints":
      sendToPropertyInspector({ event: "getLoadpoints", items: loadpointItems() });
      break;
    case "getStatus":
      sendToPropertyInspector(statusMessage());
      break;
    case "connect": {
      const url = message.url.trim().replace(/\/+$/, "");
      const result = await evcc.probe(url);
      if (result.ok) {
        await saveSettings({ url });
      }
      sendToPropertyInspector({ event: "connect", ...result });
      break;
    }
  }
});

function loadpointItems(): JsonValue {
  return evcc.loadpoints().map((lp) => ({ label: lp.title, value: String(lp.index) }));
}

function statusMessage(): JsonValue {
  return {
    event: "status",
    state: evcc.state,
    url: evcc.settings.url ?? "",
    error: evcc.error ?? "",
    configured: Boolean(evcc.settings.url),
    loadpointCount: evcc.loadpoints().length,
  };
}

function sendToPropertyInspector(payload: JsonValue): void {
  if (streamDeck.ui.action) {
    streamDeck.ui.sendToPropertyInspector(payload).catch(() => undefined);
  }
}

async function saveSettings(settings: EvccSettings): Promise<void> {
  await streamDeck.settings.setGlobalSettings(settings);
  evcc.configure(settings);
  sendToPropertyInspector(statusMessage());
}

streamDeck.settings.onDidReceiveGlobalSettings<EvccSettings>((ev) => evcc.configure(ev.settings));

await streamDeck.connect();
evcc.configure(await streamDeck.settings.getGlobalSettings<EvccSettings>());
