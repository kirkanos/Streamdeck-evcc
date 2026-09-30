/** Data model of the site and loadpoints reported by evcc. */

export type ChargeMode = "off" | "pv" | "minpv" | "now" | "smart";

/** Charge modes in the order the keys cycle through them. */
export const MODES: ChargeMode[] = ["off", "pv", "minpv", "smart", "now"];

export function isChargeMode(value: unknown): value is ChargeMode {
  return typeof value === "string" && (MODES as string[]).includes(value);
}

/**
 * The mode after `mode` in the cycle. `allowed` (a key's "Modes" setting)
 * restricts the cycle to a subset in MODES order; a current mode outside the
 * subset leads to the subset's first mode.
 */
export function nextMode(mode: ChargeMode | undefined, allowed?: ChargeMode[]): ChargeMode {
  const cycle = allowed && allowed.length > 0 ? MODES.filter((m) => allowed.includes(m)) : MODES;
  const index = cycle.indexOf(mode ?? "off");
  return cycle[(index + 1) % cycle.length];
}

/** The "Modes" setting of a key (a checkbox list) as charge modes; undefined = all modes. */
export function modesFromSettings(value: unknown): ChargeMode[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const modes = value.filter(isChargeMode);
  return modes.length > 0 ? modes : undefined;
}

export type Site = {
  title?: string;
  /** PV production in W. */
  pvPower?: number;
  /** Grid power in W: positive = import, negative = export. */
  gridPower?: number;
  /** Home consumption in W. */
  homePower?: number;
  /** Battery power in W: positive = discharging, negative = charging. */
  batteryPower?: number;
  /** Battery state of charge in %. */
  batterySoc?: number;
};

export type Loadpoint = {
  /** 0-based position in the loadpoints array (used in WebSocket keys and settings). */
  index: number;
  /** 1-based id as used by the REST endpoints /api/loadpoints/{id}/... */
  id: number;
  title: string;
  mode?: ChargeMode;
  /** Current charge power in W. */
  chargePower?: number;
  charging: boolean;
  connected: boolean;
  enabled: boolean;
  vehicleName?: string;
  vehicleTitle?: string;
  /** Vehicle state of charge in %. */
  vehicleSoc?: number;
  /** Minimum charge current in A. */
  minCurrent?: number;
  /** Maximum charge current in A. */
  maxCurrent?: number;
  /** Charge limit in % of the vehicle SoC (0 = no limit). */
  limitSoc?: number;
  /** Estimated remaining charge time in seconds. */
  chargeRemainingDuration?: number;
  /** Energy charged in this session in Wh. */
  chargedEnergy?: number;
};

/** A vehicle configured in evcc; `name` is the key used by the REST API. */
export type Vehicle = {
  name: string;
  title: string;
  /** Battery capacity in kWh. */
  capacity?: number;
};

export type EvccState = {
  site: Site;
  loadpoints: Loadpoint[];
  vehicles: Vehicle[];
};

/**
 * The vehicle after `current` when cycling through the configured vehicles and
 * "no vehicle" (guest): guest → first → … → last → guest. `undefined` = guest.
 */
export function nextVehicle(vehicles: Vehicle[], current: string | undefined): Vehicle | undefined {
  if (vehicles.length === 0) {
    return undefined;
  }
  const index = current ? vehicles.findIndex((v) => v.name === current) : -1;
  return index + 1 < vehicles.length ? vehicles[index + 1] : undefined;
}

/** Limits of the values the dial adjusts. */
export const MIN_CURRENT_RANGE = { min: 6, max: 16, step: 1 } as const;
export const LIMIT_SOC_RANGE = { min: 0, max: 100, step: 5 } as const;

function stepValue(value: number | undefined, ticks: number, range: { min: number; max: number; step: number }, fallback: number): number {
  const current = value ?? fallback;
  // Snap to the grid first so that e.g. a min current of 6.5 A becomes 7 A on the next tick.
  const snapped = ticks > 0 ? Math.floor(current / range.step) * range.step : Math.ceil(current / range.step) * range.step;
  const next = snapped + Math.sign(ticks) * Math.min(Math.abs(ticks), 20) * range.step;
  return Math.min(range.max, Math.max(range.min, next));
}

/** Min current after turning the dial by `ticks` (positive = clockwise). */
export function stepMinCurrent(amps: number | undefined, ticks: number): number {
  return stepValue(amps, ticks, MIN_CURRENT_RANGE, MIN_CURRENT_RANGE.min);
}

/** Limit SoC after turning the dial by `ticks`, in 5 % steps. */
export function stepLimitSoc(soc: number | undefined, ticks: number): number {
  return stepValue(soc, ticks, LIMIT_SOC_RANGE, LIMIT_SOC_RANGE.max);
}
