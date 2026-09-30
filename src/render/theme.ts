import type { ChargeMode } from "../evcc/model";

/** Colors shared by all key and dial images. */
export const THEME = {
  base: "#0B1220",
  surface: "#1E293B",
  muted: "#334155",
  subtle: "#94A3B8",
  empty: "#070B14",
  accent: "#6366F1",
  ok: "#22C55E",
  error: "#EF4444",
  warn: "#F59E0B",
  info: "#3B82F6",
  idle: "#64748B",
};

export const MODE_COLOR: Record<ChargeMode, string> = {
  off: THEME.idle,
  pv: THEME.ok,
  minpv: "#86EFAC",
  now: THEME.info,
  smart: THEME.accent,
};

export const MODE_LABEL: Record<ChargeMode, string> = {
  off: "Off",
  pv: "PV",
  minpv: "Min+PV",
  now: "Fast",
  smart: "Smart",
};

/** Colors of the site values. */
export const SITE_COLOR = {
  pv: THEME.warn,
  gridImport: THEME.error,
  gridExport: THEME.ok,
  battery: "#A3E635",
  home: THEME.info,
};
