import type { ChargeMode, Loadpoint, Site } from "../evcc/model";
import { MODE_LABEL, SITE_COLOR, THEME } from "./theme";

export type Formatted = { value: string; unit?: string };

/** Power in W below 1 kW, otherwise in kW with one decimal. */
export function formatPower(watts: number | undefined): Formatted {
  if (watts === undefined) {
    return { value: "–", unit: "kW" };
  }
  const abs = Math.abs(watts);
  if (Math.round(abs) < 1000) {
    return { value: String(Math.round(abs)), unit: "W" };
  }
  return { value: (abs / 1000).toFixed(1), unit: "kW" };
}

/** Like formatPower, with a sign: "+" for import (positive), "-" for export. */
export function formatSignedPower(watts: number | undefined): Formatted {
  const formatted = formatPower(watts);
  if (watts === undefined || Math.round(Math.abs(watts)) === 0) {
    return formatted;
  }
  return { value: `${watts > 0 ? "+" : "-"}${formatted.value}`, unit: formatted.unit };
}

export function formatSoc(soc: number | undefined): Formatted {
  return { value: soc === undefined ? "–" : String(Math.round(soc)), unit: "%" };
}

/** Remaining charge time in seconds as "25 min" or "1:20 h". */
export function formatDuration(seconds: number | undefined): string | undefined {
  if (seconds === undefined || seconds <= 0) {
    return undefined;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, "0")} h`;
}

export type SiteValue = "pv" | "grid" | "battery" | "home";

export const SITE_VALUE_ORDER: SiteValue[] = ["pv", "grid", "battery", "home"];

export function nextSiteValue(value: SiteValue | undefined): SiteValue {
  const index = SITE_VALUE_ORDER.indexOf(value ?? "pv");
  return SITE_VALUE_ORDER[(index + 1) % SITE_VALUE_ORDER.length];
}

export type SiteDisplay = Formatted & { caption: string; color: string; short: string };

/** The big value shown on a Site key for one of the site values. */
export function siteDisplay(site: Site, value: SiteValue = "pv"): SiteDisplay {
  switch (value) {
    case "grid": {
      const power = site.gridPower;
      const importing = power !== undefined && Math.round(power) > 0;
      const exporting = power !== undefined && Math.round(power) < 0;
      return {
        ...formatSignedPower(power),
        caption: importing ? "grid import" : exporting ? "grid export" : "grid",
        color: importing ? SITE_COLOR.gridImport : exporting ? SITE_COLOR.gridExport : THEME.idle,
        short: "Grid",
      };
    }
    case "battery":
      return { ...formatSoc(site.batterySoc), caption: batteryCaption(site.batteryPower), color: SITE_COLOR.battery, short: "Bat" };
    case "home":
      return { ...formatPower(site.homePower), caption: "home", color: SITE_COLOR.home, short: "Home" };
    default:
      return { ...formatPower(site.pvPower), caption: "PV production", color: SITE_COLOR.pv, short: "PV" };
  }
}

function batteryCaption(power: number | undefined): string {
  if (power === undefined || Math.round(Math.abs(power)) === 0) {
    return "battery";
  }
  return power < 0 ? "battery charging" : "battery discharging";
}

/** Caption of a loadpoint: charge mode and vehicle state. */
export function loadpointCaption(lp: Loadpoint): string {
  const mode = lp.mode ? MODE_LABEL[lp.mode] : "–";
  if (!lp.connected) {
    return `${mode} · no vehicle`;
  }
  if (lp.charging) {
    const remaining = formatDuration(lp.chargeRemainingDuration);
    return remaining ? `${mode} · ${remaining}` : `${mode} · charging`;
  }
  return `${mode} · connected`;
}

export const modeLabel = (mode: ChargeMode | undefined): string => (mode ? MODE_LABEL[mode] : "–");
