import type { ChargeMode } from "../evcc/model";
import { background, mix, svg, text, toDataUrl, truncate, wrapText } from "./svg";
import { MODE_COLOR, THEME } from "./theme";

/** Key images are drawn at 144×144 and scaled by Stream Deck. */
const S = 144;

function modeBackground(mode: ChargeMode | undefined): string {
  if (!mode || mode === "off") {
    return background("bg", THEME.surface, THEME.base, S, S);
  }
  return background("bg", mix(MODE_COLOR[mode], THEME.base, 0.68), THEME.base, S, S);
}

/** Horizontal state-of-charge bar; `soc` in %, undefined draws an empty track. */
export function socBar(soc: number | undefined, x: number, y: number, width: number, height: number, color: string): string {
  const track = `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${height / 2}" fill="${THEME.muted}"/>`;
  if (soc === undefined) {
    return track;
  }
  const fillWidth = Math.max(height, (width * Math.min(100, Math.max(0, soc))) / 100);
  return track + `<rect x="${x}" y="${y}" width="${fillWidth.toFixed(1)}" height="${height}" rx="${height / 2}" fill="${color}"/>`;
}

/** Lightning bolt (charging) or plug (connected) glyph, `size` px wide. */
export function chargeGlyph(kind: "charging" | "connected", x: number, y: number, size: number): string {
  const s = size / 20;
  if (kind === "charging") {
    return `<path transform="translate(${x} ${y}) scale(${s})" d="M11 1 3 12h6l-1 7 8-11h-6z" fill="#FFFFFF"/>`;
  }
  return (
    `<g transform="translate(${x} ${y}) scale(${s})" fill="none" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="M7 2v5M13 2v5M5 7h10v3a5 5 0 0 1-10 0zM10 15v4"/></g>`
  );
}

export type LoadpointKey = {
  /** Loadpoint title; omitted when the user shows their own title on the key. */
  name?: string;
  mode?: ChargeMode;
  value: string;
  unit?: string;
  caption?: string;
  /** Vehicle SoC in %. */
  soc?: number;
  charging: boolean;
  connected: boolean;
};

// Baselines for value / caption depending on the number of name lines.
const VALUE_Y = [78, 86, 94];
const CAPTION_Y = [100, 106, 113];

export function loadpointKey(k: LoadpointKey): string {
  const lines = k.name ? wrapText(k.name, 11, 2) : [];
  const nameSize = 19;
  const lineHeight = nameSize + 2;
  const color = k.mode ? MODE_COLOR[k.mode] : THEME.idle;

  const accent = `<rect x="0" y="0" width="${S}" height="5" fill="${color}"/>`;
  const names = lines.map((line, i) => text(line, { x: S / 2, y: 28 + i * lineHeight, size: nameSize })).join("");

  const long = k.value.length + (k.unit ? k.unit.length / 2 : 0) > 5;
  const valueSize = Math.round(34 * (long ? 0.8 : 1));
  const value = text(k.value, {
    x: S / 2,
    y: VALUE_Y[lines.length],
    size: valueSize,
    weight: 800,
    suffix: k.unit,
    suffixSize: Math.round(valueSize * 0.5),
  });
  const caption = k.caption ? text(truncate(k.caption, 20), { x: S / 2, y: CAPTION_Y[lines.length], size: 14, weight: 600, opacity: 0.7 }) : "";

  // Bottom row: plug / bolt glyph and the vehicle SoC bar.
  const glyph = k.charging ? chargeGlyph("charging", 10, 118, 20) : k.connected ? chargeGlyph("connected", 10, 118, 20) : "";
  const barX = glyph ? 36 : 10;
  const bar = socBar(k.connected ? k.soc : undefined, barX, 123, S - barX - 10, 10, k.mode === "off" ? THEME.subtle : color);

  return toDataUrl(svg(S, S, modeBackground(k.mode) + accent + names + value + caption + glyph + bar));
}

export type SiteKey = {
  /** Site title; omitted when the user shows their own title on the key. */
  name?: string;
  color: string;
  value: string;
  unit?: string;
  caption: string;
  /** The other site values, shown small at the bottom. */
  others: { label: string; value: string; unit?: string }[];
};

export function siteKey(k: SiteKey): string {
  const lines = k.name ? wrapText(k.name, 11, 2) : [];
  const names = lines.map((line, i) => text(line, { x: S / 2, y: 28 + i * 21, size: 19 })).join("");
  const bg = background("bg", mix(k.color, THEME.base, 0.7), THEME.base, S, S);
  const accent = `<rect x="0" y="0" width="${S}" height="5" fill="${k.color}"/>`;

  const long = k.value.length + (k.unit ? k.unit.length / 2 : 0) > 5;
  const valueSize = Math.round(34 * (long ? 0.8 : 1));
  const value = text(k.value, {
    x: S / 2,
    y: VALUE_Y[lines.length],
    size: valueSize,
    weight: 800,
    suffix: k.unit,
    suffixSize: Math.round(valueSize * 0.5),
  });
  const caption = text(truncate(k.caption, 20), { x: S / 2, y: CAPTION_Y[lines.length], size: 14, weight: 600, opacity: 0.7 });

  const others = k.others.slice(0, 3);
  const columnWidth = (S - 16) / Math.max(1, others.length);
  const row = others
    .map((o, i) => {
      const cx = 8 + columnWidth * (i + 0.5);
      return (
        text(o.unit ? `${o.value} ${o.unit}` : o.value, { x: cx, y: 124, size: 12, weight: 700, opacity: 0.9 }) +
        text(o.label, { x: cx, y: 136, size: 9, weight: 600, opacity: 0.6 })
      );
    })
    .join("");
  const divider = others.length > 0 ? `<rect x="10" y="110" width="${S - 20}" height="1" fill="#FFFFFF" fill-opacity="0.15"/>` : "";

  return toDataUrl(svg(S, S, bg + accent + names + value + caption + divider + row));
}

/** Neutral key with two lines of text, e.g. "Select / a loadpoint" or "Offline". */
export function messageKey(title: string, subtitle: string): string {
  return toDataUrl(
    svg(
      S,
      S,
      background("bg", THEME.surface, THEME.base, S, S) +
        `<rect x="3" y="3" width="${S - 6}" height="${S - 6}" rx="14" fill="none" stroke="${THEME.muted}" stroke-width="2"/>` +
        text(title, { x: S / 2, y: 68, size: 22, weight: 800 }) +
        text(subtitle, { x: S / 2, y: 92, size: 15, weight: 600, fill: THEME.subtle }),
    ),
  );
}
