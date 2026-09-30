import { describe, expect, it } from "vitest";
import { nextMode, stepLimitSoc, stepMinCurrent } from "./model";
import { normalizeState, parseLoadpointKey, StateStore } from "./state";

const flat = {
  siteTitle: "Home",
  pvPower: 4321.5,
  gridPower: -1200,
  homePower: 800,
  batterySoc: 62,
  batteryPower: -500,
  loadpoints: [
    {
      title: "Garage",
      mode: "pv",
      chargePower: 3700,
      vehicleSoc: 45.4,
      charging: true,
      connected: true,
      enabled: true,
      minCurrent: 6,
      maxCurrent: 16,
      limitSoc: 80,
      vehicleName: "id3",
      chargeRemainingDuration: 5400,
    },
    { title: "Carport", mode: "off", connected: false, charging: false },
  ],
};

describe("normalizeState", () => {
  it("reads the flat state of older evcc versions", () => {
    const state = normalizeState(flat);
    expect(state.site).toEqual({ title: "Home", pvPower: 4321.5, gridPower: -1200, homePower: 800, batteryPower: -500, batterySoc: 62 });
    expect(state.loadpoints).toHaveLength(2);
    expect(state.loadpoints[0]).toMatchObject({ index: 0, id: 1, title: "Garage", mode: "pv", chargePower: 3700, vehicleSoc: 45.4, charging: true, limitSoc: 80, chargeRemainingDuration: 5400 });
    expect(state.loadpoints[1]).toMatchObject({ index: 1, id: 2, title: "Carport", mode: "off", connected: false, charging: false, chargePower: undefined });
  });

  it("unwraps the result of newer evcc versions and reads grid.power", () => {
    const state = normalizeState({ result: { ...flat, gridPower: undefined, grid: { power: 350 } } });
    expect(state.site.gridPower).toBe(350);
    expect(state.loadpoints[0].title).toBe("Garage");
  });

  it("tolerates junk", () => {
    expect(normalizeState(null)).toEqual({ site: { title: undefined, pvPower: undefined, gridPower: undefined, homePower: undefined, batteryPower: undefined, batterySoc: undefined }, loadpoints: [] });
    expect(normalizeState("nope").loadpoints).toEqual([]);
    expect(normalizeState({ loadpoints: "nope" }).loadpoints).toEqual([]);
    const state = normalizeState({ pvPower: "1234", batterySoc: NaN, loadpoints: [null, { mode: "turbo", charging: 1, title: "  " }] });
    expect(state.site.pvPower).toBe(1234);
    expect(state.site.batterySoc).toBeUndefined();
    expect(state.loadpoints[0]).toMatchObject({ title: "Loadpoint 1", mode: undefined, connected: false });
    expect(state.loadpoints[1]).toMatchObject({ title: "Loadpoint 2", mode: undefined, charging: true });
  });

  it("falls back to targetSoc for the charge limit", () => {
    expect(normalizeState({ loadpoints: [{ targetSoc: 90 }] }).loadpoints[0].limitSoc).toBe(90);
  });
});

describe("StateStore", () => {
  it("applies WebSocket deltas to loadpoints and site", () => {
    const store = new StateStore();
    store.replace({ result: flat });

    const changes = store.apply({ "loadpoints.0.mode": "now", "loadpoints.0.chargePower": 11000, pvPower: 0 });
    expect(changes.site).toBe(true);
    expect([...changes.loadpoints]).toEqual([0]);
    expect(changes.list).toBe(false);
    expect(store.state.loadpoints[0]).toMatchObject({ mode: "now", chargePower: 11000, title: "Garage" });
    expect(store.state.site.pvPower).toBe(0);
    expect(store.state.loadpoints[1].title).toBe("Carport");
  });

  it("applies nested site objects and dotted site keys", () => {
    const store = new StateStore();
    store.replace({ loadpoints: [] });
    store.apply({ grid: { power: 420 } });
    expect(store.state.site.gridPower).toBe(420);
    store.apply({ "grid.power": -99 });
    expect(store.state.site.gridPower).toBe(-99);
  });

  it("grows the loadpoint list for unknown indices", () => {
    const store = new StateStore();
    store.replace({});
    const changes = store.apply({ "loadpoints.1.title": "New" });
    expect(changes.list).toBe(true);
    expect(store.state.loadpoints.map((lp) => lp.title)).toEqual(["Loadpoint 1", "New"]);
  });

  it("replaces the whole list when it arrives as an array", () => {
    const store = new StateStore();
    store.replace(flat);
    const changes = store.apply({ loadpoints: [{ title: "Only" }] });
    expect(changes.list).toBe(true);
    expect(store.state.loadpoints).toHaveLength(1);
  });

  it("ignores messages that are not objects", () => {
    const store = new StateStore();
    store.replace(flat);
    const changes = store.apply("ping");
    expect(changes).toEqual({ site: false, loadpoints: new Set(), list: false });
    expect(store.state.loadpoints).toHaveLength(2);
  });

  it("reports list changes on replace", () => {
    const store = new StateStore();
    expect(store.replace(flat).list).toBe(true);
    expect(store.replace(flat).list).toBe(false);
  });
});

describe("parseLoadpointKey", () => {
  it("splits loadpoint keys", () => {
    expect(parseLoadpointKey("loadpoints.0.mode")).toEqual({ index: 0, field: "mode" });
    expect(parseLoadpointKey("loadpoints.12.vehicle.soc")).toEqual({ index: 12, field: "vehicle.soc" });
    expect(parseLoadpointKey("pvPower")).toBeUndefined();
    expect(parseLoadpointKey("loadpoints")).toBeUndefined();
  });
});

describe("modes and dial steps", () => {
  it("cycles the charge mode", () => {
    expect(nextMode("off")).toBe("pv");
    expect(nextMode("pv")).toBe("minpv");
    expect(nextMode("minpv")).toBe("now");
    expect(nextMode("now")).toBe("smart");
    expect(nextMode("smart")).toBe("off");
    expect(nextMode(undefined)).toBe("pv");
  });

  it("steps the min current within 6 to 16 A", () => {
    expect(stepMinCurrent(6, 1)).toBe(7);
    expect(stepMinCurrent(16, 1)).toBe(16);
    expect(stepMinCurrent(6, -1)).toBe(6);
    expect(stepMinCurrent(undefined, 1)).toBe(7);
    expect(stepMinCurrent(6.5, 1)).toBe(7);
    expect(stepMinCurrent(6.5, -1)).toBe(6);
    expect(stepMinCurrent(10, 3)).toBe(13);
    expect(stepMinCurrent(32, -1)).toBe(16);
  });

  it("steps the limit SoC in 5 % steps", () => {
    expect(stepLimitSoc(80, 1)).toBe(85);
    expect(stepLimitSoc(100, 1)).toBe(100);
    expect(stepLimitSoc(0, -1)).toBe(0);
    expect(stepLimitSoc(undefined, -1)).toBe(95);
    expect(stepLimitSoc(82, 1)).toBe(85);
    expect(stepLimitSoc(82, -1)).toBe(80);
  });
});

describe("evcc 0.316 state shape", () => {
  // Trimmed from a real GET /api/state of evcc 0.316.1.
  const real = {
    version: "0.316.1",
    siteTitle: "Mein Zuhause",
    pvPower: 1807,
    pv: [{ name: "db:9", title: "PV", power: 1807 }],
    grid: { name: "db:10", power: 12 },
    battery: { power: -1390, capacity: 13.245, soc: 87.92, devices: [{ title: "Powerwall" }] },
    homePower: 429,
    loadpoints: [{ title: "Carport", mode: "smart", chargePower: 0, vehicleSoc: 0, charging: false, connected: false, minCurrent: 6, limitSoc: 0, effectiveLimitSoc: 100 }],
  };

  it("reads nested grid and battery values", () => {
    const state = normalizeState(real);
    expect(state.site).toMatchObject({ title: "Mein Zuhause", pvPower: 1807, gridPower: 12, homePower: 429, batteryPower: -1390, batterySoc: 87.92 });
  });

  it("accepts the smart charge mode", () => {
    const state = normalizeState(real);
    expect(state.loadpoints[0].mode).toBe("smart");
    expect(state.loadpoints[0].title).toBe("Carport");
  });

  it("applies battery and grid deltas from the WebSocket", () => {
    const store = new StateStore();
    store.replace(real);
    const changes = store.apply({ "battery.soc": 90, "grid.power": -500, "loadpoints.0.mode": "pv" });
    expect(changes.site).toBe(true);
    expect(store.state.site.batterySoc).toBe(90);
    expect(store.state.site.gridPower).toBe(-500);
    expect(store.state.loadpoints[0].mode).toBe("pv");
  });
});
