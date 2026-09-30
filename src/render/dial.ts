import type { ChargeMode } from "../evcc/model";
import { alwaysBadge, chargeGlyph, socBar } from "./keys";
import { background, mix, svg, text, toDataUrl, truncate } from "./svg";
import { MODE_COLOR, THEME } from "./theme";

/** Touch strip segment of one dial (Stream Deck + / + XL). */
const W = 200;
const H = 100;

export type DialCanvas = {
  title: string;
  mode?: ChargeMode;
  value: string;
  unit?: string;
  caption?: string;
  soc?: number;
  charging: boolean;
  connected: boolean;
  alwaysCharge?: boolean;
  /** The value the dial adjusts, shown on the right. */
  target: { value: string; unit?: string; label: string; pending?: boolean };
};

export function dialCanvas(d: DialCanvas): string {
  const color = d.mode ? MODE_COLOR[d.mode] : THEME.idle;
  const bg = d.mode && d.mode !== "off" ? background("bg", mix(color, THEME.base, 0.76), THEME.base, W, H) : background("bg", THEME.surface, THEME.base, W, H);

  const dot = `<circle cx="16" cy="19" r="5" fill="${color}"/>`;
  const title = text(truncate(d.title, 12), { x: 28, y: 26, size: 19, anchor: "start" });
  const badge = d.alwaysCharge ? alwaysBadge(160, 8, 0.9) : "";
  const width = d.value.length + (d.unit ? d.unit.length * 0.5 + 0.3 : 0);
  const value = text(d.value, {
    x: 12,
    y: 62,
    size: Math.min(30, Math.floor(104 / (width * 0.68))),
    weight: 800,
    anchor: "start",
    suffix: d.unit,
    suffixSize: 15,
  });
  const caption = d.caption ? text(truncate(d.caption, 14), { x: 12, y: 81, size: 15, weight: 700, opacity: 0.85, anchor: "start" }) : "";

  const glyph = d.charging ? chargeGlyph("charging", 12, 85, 12) : d.connected ? chargeGlyph("connected", 12, 85, 12) : "";
  const bar = socBar(d.connected ? d.soc : undefined, glyph ? 28 : 12, 88, glyph ? 84 : 100, 6, d.mode === "off" ? THEME.subtle : color);

  // Right column: the value the dial adjusts.
  const box = `<rect x="122" y="36" width="66" height="58" rx="8" fill="#000000" fill-opacity="${d.target.pending ? 0.45 : 0.25}"/>`;
  const target =
    text(d.target.value, { x: 155, y: 66, size: 24, weight: 800, suffix: d.target.unit, suffixSize: 12, fill: d.target.pending ? THEME.warn : "#FFFFFF" }) +
    text(d.target.label, { x: 155, y: 84, size: 11, weight: 600, opacity: 0.7 });

  return toDataUrl(svg(W, H, bg + dot + title + badge + value + caption + glyph + bar + box + target));
}

export function dialMessage(title: string, subtitle: string): string {
  return toDataUrl(
    svg(
      W,
      H,
      background("bg", THEME.surface, THEME.base, W, H) +
        text(title, { x: 12, y: 44, size: 20, weight: 800, anchor: "start" }) +
        text(subtitle, { x: 12, y: 70, size: 14, weight: 600, fill: THEME.subtle, anchor: "start" }),
    ),
  );
}
