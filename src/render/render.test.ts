import { describe, expect, it } from "vitest";
import type { Loadpoint } from "../evcc/model";
import { dialCanvas } from "./dial";
import { loadpointKey, messageKey, siteKey, vehicleKey } from "./keys";
import { escapeXml } from "./svg";
import { MODE_COLOR } from "./theme";
import { formatDuration, formatPower, formatSignedPower, formatSoc, loadpointCaption, nextSiteValue, siteDisplay } from "./values";

const decode = (dataUrl: string) => Buffer.from(dataUrl.split(",")[1], "base64").toString("utf8");

const loadpoint = (over: Partial<Loadpoint> = {}): Loadpoint => ({
  index: 0,
  id: 1,
  title: "Garage",
  mode: "pv",
  chargePower: 3700,
  charging: true,
  connected: true,
  enabled: true,
  vehicleSoc: 45,
  minCurrent: 6,
  limitSoc: 80,
  ...over,
});

describe("power formatting", () => {
  it("uses W below 1 kW and kW with one decimal above", () => {
    expect(formatPower(0)).toEqual({ value: "0", unit: "W" });
    expect(formatPower(842.4)).toEqual({ value: "842", unit: "W" });
    expect(formatPower(999.6)).toEqual({ value: "1.0", unit: "kW" });
    expect(formatPower(3700)).toEqual({ value: "3.7", unit: "kW" });
    expect(formatPower(11049)).toEqual({ value: "11.0", unit: "kW" });
    expect(formatPower(undefined)).toEqual({ value: "–", unit: "kW" });
  });

  it("signs grid power", () => {
    expect(formatSignedPower(1234)).toEqual({ value: "+1.2", unit: "kW" });
    expect(formatSignedPower(-1234)).toEqual({ value: "-1.2", unit: "kW" });
    expect(formatSignedPower(-350)).toEqual({ value: "-350", unit: "W" });
    expect(formatSignedPower(0.2)).toEqual({ value: "0", unit: "W" });
    expect(formatSignedPower(undefined)).toEqual({ value: "–", unit: "kW" });
  });

  it("rounds the SoC", () => {
    expect(formatSoc(45.4)).toEqual({ value: "45", unit: "%" });
    expect(formatSoc(undefined)).toEqual({ value: "–", unit: "%" });
  });

  it("formats remaining time", () => {
    expect(formatDuration(0)).toBeUndefined();
    expect(formatDuration(undefined)).toBeUndefined();
    expect(formatDuration(90)).toBe("2 min");
    expect(formatDuration(25 * 60)).toBe("25 min");
    expect(formatDuration(5400)).toBe("1:30 h");
    expect(formatDuration(3600 * 10 + 5 * 60)).toBe("10:05 h");
  });
});

describe("site values", () => {
  const site = { pvPower: 4321, gridPower: -1200, batterySoc: 62, batteryPower: -500, homePower: 800 };

  it("cycles through the values", () => {
    expect(nextSiteValue(undefined)).toBe("grid");
    expect(nextSiteValue("grid")).toBe("battery");
    expect(nextSiteValue("home")).toBe("pv");
  });

  it("describes grid import and export", () => {
    expect(siteDisplay(site, "grid")).toMatchObject({ value: "-1.2", unit: "kW", caption: "grid export" });
    expect(siteDisplay({ ...site, gridPower: 500 }, "grid")).toMatchObject({ value: "+500", unit: "W", caption: "grid import" });
    expect(siteDisplay({ ...site, gridPower: 0 }, "grid")).toMatchObject({ value: "0", caption: "grid" });
  });

  it("describes the other values", () => {
    expect(siteDisplay(site, "pv")).toMatchObject({ value: "4.3", unit: "kW", caption: "production" });
    expect(siteDisplay(site, "battery")).toMatchObject({ value: "62", unit: "%", caption: "charging" });
    expect(siteDisplay({ ...site, batteryPower: 300 }, "battery")).toMatchObject({ caption: "discharging" });
    expect(siteDisplay(site, "home")).toMatchObject({ value: "800", unit: "W", caption: "consumption" });
    expect(siteDisplay({}, "pv")).toMatchObject({ value: "–" });
  });
});

describe("loadpoint caption", () => {
  it("combines mode and vehicle state", () => {
    expect(loadpointCaption(loadpoint({ chargeRemainingDuration: 5400 }))).toBe("PV · 1:30h");
    expect(loadpointCaption(loadpoint({ chargeRemainingDuration: 0 }))).toBe("PV · charging");
    expect(loadpointCaption(loadpoint({ charging: false, mode: "minpv" }))).toBe("Min+PV · plugged");
    expect(loadpointCaption(loadpoint({ charging: false, connected: false, mode: "off" }))).toBe("Off · no car");
    expect(loadpointCaption(loadpoint({ mode: undefined, connected: false }))).toBe("– · no car");
  });
});

describe("images", () => {
  it("draws the loadpoint key with mode color, SoC bar and bolt", () => {
    const svg = decode(loadpointKey({ name: "Garage", mode: "now", value: "3.7", unit: "kW", caption: "Fast · charging", soc: 50, charging: true, connected: true }));
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('width="144" height="144"');
    expect(svg).toContain(`fill="${MODE_COLOR.now}"`);
    expect(svg).toContain("Garage");
    expect(svg).toContain("3.7");
    expect(svg).toContain(">Fast · charging<");
    // Bolt glyph and a half-filled bar (track from x=36 to 134 -> 49 px).
    expect(svg).toContain('d="M11 1 3 12h6l-1 7 8-11h-6z"');
    expect(svg).toContain('width="49.0"');
  });

  it("draws an empty bar and no glyph without a vehicle", () => {
    const svg = decode(loadpointKey({ mode: "off", value: "0", unit: "W", soc: 50, charging: false, connected: false }));
    expect(svg).not.toContain("M11 1 3 12");
    expect(svg).not.toContain('width="62.0"');
    expect(svg).toContain(`fill="${MODE_COLOR.off}"`);
  });

  it("escapes names", () => {
    expect(escapeXml(`<a & "b">`)).toBe("&lt;a &amp; &quot;b&quot;&gt;");
    const svg = decode(loadpointKey({ name: "R&D <lp>", mode: "pv", value: "1", charging: false, connected: true }));
    expect(svg).toContain("R&amp;D");
    expect(svg).not.toContain("<lp>");
  });

  it("draws the site key with the value name on top and one big value", () => {
    const svg = decode(siteKey({ name: "PV", color: "#F59E0B", value: "4.3", unit: "kW", caption: "production" }));
    expect(svg).toContain(">PV<");
    expect(svg).toContain('font-size="22"');
    expect(svg).toContain(">4.3<tspan");
    expect(svg).toContain('font-size="46"');
    expect(svg).toContain(">production<");
    expect(svg).toContain('fill="#F59E0B"');
  });

  it("draws message keys", () => {
    const svg = decode(messageKey("Select", "a loadpoint"));
    expect(svg).toContain(">Select<");
    expect(svg).toContain(">a loadpoint<");
  });

  it("draws the dial canvas at 200x100 with the target value", () => {
    const svg = decode(
      dialCanvas({ title: "Garage", mode: "pv", value: "3.7", unit: "kW", caption: "PV · charging", soc: 45, charging: true, connected: true, target: { value: "8", unit: "A", label: "min current", pending: true } }),
    );
    expect(svg).toContain('width="200" height="100"');
    expect(svg).toContain(">8<tspan");
    expect(svg).toContain(">min current<");
    expect(svg).toContain('fill="#F59E0B"');
  });
});

describe("vehicleKey", () => {
  it("draws the vehicle title big with the SoC caption", () => {
    const svg = decode(vehicleKey({ name: "Carport", vehicle: "ID3", soc: 61.6, connected: true, charging: true }));
    expect(svg).toContain(">Carport<");
    expect(svg).toContain(">ID3<");
    expect(svg).toContain(">62% · charging<");
  });

  it("shows Guest when no vehicle is assigned", () => {
    const svg = decode(vehicleKey({ vehicle: undefined, connected: false, charging: false }));
    expect(svg).toContain(">Guest<");
    expect(svg).toContain(">not assigned<");
  });
});
