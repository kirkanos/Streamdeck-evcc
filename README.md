# evcc Charge

Your [evcc](https://evcc.io) charging state and PV situation at a glance on your Elgato Stream Deck, with charge mode switching.

Unofficial plugin, not affiliated with the evcc project.

## Features

* **Loadpoint** key for one loadpoint:
  * The charge mode as background color: ⬛ Off, 🟩 Smart, 🟦 Fast.
  * "Wallbox" on top (left out if you set your own title on the key), the charge power, the mode with the remaining charge time or the plug state, and the vehicle SoC as a bar with a plug / bolt glyph.
  * Pressing the key switches to the next charge mode (Off, Smart, Fast, or the subset you tick in the key settings); holding it toggles "always charge" (no interruptions) of the smart mode, shown as an ∞ badge.
* **Vehicle** key: "Vehicle" on top, the vehicle assigned to a loadpoint (or "Guest") big, its SoC and plug state below. Pressing the key assigns the next vehicle configured in evcc, after the last one the guest vehicle; holding it removes the vehicle. Handy when evcc does not detect the vehicle by itself.
* **Site** key: PV production, grid power with sign (import / export), battery SoC or home consumption, with the value's name on top. Pressing the key switches to the next value.
* **Loadpoint Dial** (Stream Deck + / + XL): turning the dial sets the minimum charge current (6 to 16 A) or the charge limit (SoC, 5 % steps) of a loadpoint; pushing the dial or tapping the touch strip switches the charge mode, holding the dial toggles "always charge". The touch strip shows mode, power, SoC, remaining time and the value the dial adjusts.
* Live updates over the evcc WebSocket, the same one the evcc web UI uses; the REST API is polled every 10 s while the WebSocket is down. Works with the flat state of older evcc versions and the `result`-wrapped state of newer ones.

## Installation

Download the [latest release](https://github.com/kirkanos/Streamdeck-evcc/releases/latest) and open `com.kirkanos.evcc.streamDeckPlugin`. Requires Stream Deck 7.1 or newer.

Then add a key, open its settings, enter the base URL of your evcc instance (for example `http://192.168.1.10:8089`) and press **Connect**. Loadpoints, meters and vehicles are configured in evcc itself; the plugin discovers them from `/api/state`.

## Settings

| Setting | Where | Description |
| --- | --- | --- |
| URL | every key and dial (shared) | Base URL of evcc, e.g. `http://192.168.1.10:8089`. Stored once for all keys. |
| Loadpoint | Loadpoint key, Vehicle key, Loadpoint Dial | The loadpoint to show and control, picked from the list evcc reports. |
| Modes | Loadpoint key, Loadpoint Dial | Which charge modes a press cycles through, e.g. only Off and Fast. Nothing ticked means all three. |
| Value | Site key | PV production, grid power, battery SoC or home consumption; pressing the key cycles through them. |
| Turning sets | Loadpoint Dial | Minimum charge current (6 to 16 A) or charge limit (SoC, 5 % steps). |

The plugin uses the evcc REST API (`GET /api/state`, `POST /api/loadpoints/{id}/mode/{mode}`, `.../mincurrent/{amps}`, `.../limitsoc/{soc}`, `.../alwayscharge/{on|off}`, `POST`/`DELETE .../vehicle[/{name}]`) and the WebSocket `/ws`.

## Prerequisites

* evcc 0.300 or newer: the plugin uses its charge modes Off, Smart and Fast. Older versions with PV and Min+PV are not supported.

evcc has no API authentication of its own, so the plugin needs to reach it without a login:

* **Direct LAN access** to the evcc host on its port (8089 by default), e.g. `http://192.168.1.10:8089`. This is the simplest option; the Stream Deck computer must be in the LAN or connected through a VPN.
* **Behind a reverse proxy with Authelia** (or a similar forward-auth middleware): a session cookie is impractical for a plugin. Add a network-based bypass rule for the LAN and VPN address ranges so that requests from those networks reach evcc without a login, for example:

  ```yaml
  access_control:
    rules:
      - domain: evcc.example.com
        policy: bypass
        networks:
          - 192.168.1.0/24
          - 10.8.0.0/24
  ```

  Make sure the WebSocket `/ws` passes the proxy as well; if it does not, the plugin keeps working over the 10 s REST polling.

## Development

evcc Charge is a Node.js plugin built with the official [Stream Deck SDK](https://docs.elgato.com/streamdeck/sdk/introduction/getting-started/) (`@elgato/streamdeck`, TypeScript, rollup). The settings pages use [sdpi-components](https://sdpi-components.dev). It runs on the Node.js 24 runtime of the Stream Deck app, so `fetch` and `WebSocket` are built in and no further dependencies are needed.

| Path | Content |
| --- | --- |
| `src/actions/` | One class per Stream Deck action (loadpoint key, site key, loadpoint dial) |
| `src/evcc/` | evcc connection (REST + WebSocket), state normalizer and data model |
| `src/render/` | SVG images for keys and touch strips, value formatting |
| `plugin/` | Static plugin files: manifest, icons, settings pages (`ui/`), dial layout |
| `assets/` | Plugin icon source (rendered to PNG by the build) |
| `scripts/` | Build script |

```sh
npm install
npm test               # unit tests (state normalizer, formatting, rendering)
npm run typecheck

# Development: a parallel-installable copy "evcc Charge (dev)"
npm run link:dev       # build + link into Stream Deck (once)
npm run watch:dev      # rebuild and restart the plugin on every change

npm run validate       # build + streamdeck validate
npm run pack           # Release/com.kirkanos.evcc.streamDeckPlugin
```

Linking and restarting need the Stream Deck developer mode (`npx streamdeck dev`, then restart the Stream Deck app once). Plugin logs are written to `dist/<plugin id>.sdPlugin/logs/`.

GitHub Actions builds and tests every push (`.github/workflows/ci.yml`) and publishes a release with the packed plugin for tags like `v1.0.0` (`.github/workflows/release.yml`).

## Troubleshooting

* **Keys show "Connect":** open the settings of any key, enter the evcc URL and press Connect.
* **Keys show "Offline" / "check URL":** check that evcc is reachable from this computer at that URL without a login (see Prerequisites).
* **Values update only every 10 s:** the WebSocket `/ws` is not getting through (proxy, firewall); the plugin is falling back to REST polling.
* Anything else: [open an issue](https://github.com/kirkanos/Streamdeck-evcc/issues).
