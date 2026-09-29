# Streamdeck-evcc

Stream Deck plugin `com.kirkanos.evcc`. Status: plan only, no code yet.

## Goal

See the charging state and the PV situation on the deck, and switch the charge mode without opening the evcc app.

## Keys & dials

- **Loadpoint** key: charge mode as background color (off gray, pv green, minpv light green, now blue), charge power in kW, vehicle SoC as a bar, plug/charging icon. Press cycles the mode (off, pv, minpv, now), long press sets off.
- **Site** key: PV production, grid power with sign (import/export), battery SoC. Press cycles the value shown, like the value cycling in Kuma Glance.
- **Dial**: turn sets the minimum current (6 to 16 A) or the target SoC (configurable), push cycles the mode, touch strip shows a loadpoint summary (mode, power, SoC, remaining time).

## Data source & API

- evcc REST: `GET /api/state` (everything: site, loadpoints, vehicles), `POST /api/loadpoints/{id}/mode/{mode}`, `POST /api/loadpoints/{id}/mincurrent/{amps}`, `POST /api/loadpoints/{id}/limitsoc/{soc}`.
- Live updates over the WebSocket `/ws` (evcc pushes state deltas as JSON), REST as fallback with 10 s polling.
- Loadpoints, meters and vehicles are configured in the evcc UI, so the plugin discovers them from `/api/state`.
- evcc has no API auth of its own. The public hostname is behind an SSO reverse proxy, so the plugin talks to the host directly on port 8089 inside the LAN, or gets a proxy bypass rule for its client.

## Settings

- Base URL (default `http://<docker-host>:8089`).
- Loadpoint picker (datasource from `/api/state`), value shown on the Site key, dial function (min current or target SoC).

## Open questions

- LAN address of the Docker host running evcc (`network.host` in `evcc.yaml` says `evcc.local`, which is the container name).
- Access from outside the LAN: an SSO session cookie is impractical for a plugin. A network-based bypass rule for the LAN plus VPN is the cleaner option.
- Does the WebSocket work through the reverse proxy with forward auth? If not, only the direct LAN route is used.

## Milestones

- M1: Site and Loadpoint keys read-only over REST polling, tests for value formatting.
- M2: WebSocket updates, mode switching.
- M3: Dial for min current and target SoC, touch strip layout.
- M4: CI workflows, release `v1.0.0`.

## Scaffold

Copy the tooling from [Kuma Glance](https://github.com/kirkanos/kuma-glance) (`../Streamdeck-Uptime-Kuma`), not from Termine:

- `@elgato/streamdeck` ^3, `@elgato/cli`, TypeScript, rollup via `scripts/build.mjs` and `createRollupConfig()` from its `rollup.config.mjs`; `tsconfig` extends `@tsconfig/node20`, `moduleResolution: Bundler`, `customConditions: ["node"]`.
- Manifest: SDKVersion 3, Nodejs 24, `Software.MinimumVersion` 7.1, version `0.0.0.0` (the build fills it in).
- Layout: `plugin/` (manifest, `ui/`, `layouts/`, icons), `src/plugin.ts`, `src/actions/`, `src/<service>/`, `src/render/` (reuse `svg.ts` and `theme.ts`).
- Dev variant `<uuid>-dev` via `--dev`, `npm run link:dev`, `npm run watch:dev`.
- Settings pages: static HTML with vendored sdpi-components 4.0.1 in `plugin/ui/`.
- CI: `.github/workflows/ci.yml` (typecheck, vitest, pack, artifact) and `release.yml` (tag `v*`, `PLUGIN_VERSION`, `gh release create`).
- Tests: vitest for model and render code, like `render.test.ts` in Kuma Glance.
- Secrets live in the action settings, never in global settings. Passwords are exchanged for a token once and not stored.
- No license for now.
