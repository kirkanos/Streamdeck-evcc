/** Small helpers for building the SVG images drawn on keys and dials. */

export const FONT = "Helvetica Neue, Helvetica, Arial, sans-serif";

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function toDataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

/** Mixes two #rrggbb colors; `amount` 0 = a, 1 = b. */
export function mix(a: string, b: string, amount: number): string {
  const pa = parseHex(a);
  const pb = parseHex(b);
  const channel = (i: number) => Math.round(pa[i] + (pb[i] - pa[i]) * amount);
  return `#${[0, 1, 2].map((i) => channel(i).toString(16).padStart(2, "0")).join("")}`;
}

function parseHex(color: string): [number, number, number] {
  let hex = color.replace("#", "");
  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const value = Number.parseInt(hex.slice(0, 6), 16);
  if (Number.isNaN(value)) {
    return [100, 116, 139];
  }
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** True if white text is more readable than dark text on `color`. */
export function prefersLightText(color: string): boolean {
  const [r, g, b] = parseHex(color);
  return 0.299 * r + 0.587 * g + 0.114 * b < 170;
}

/**
 * Splits `text` into at most `maxLines` lines of up to `maxChars` characters,
 * preferring breaks after spaces, dots, dashes and underscores. Text that does
 * not fit ends with an ellipsis.
 */
export function wrapText(text: string, maxChars: number, maxLines: number): string[] {
  const lines: string[] = [];
  let rest = text.trim();

  while (rest.length > 0 && lines.length < maxLines) {
    if (rest.length <= maxChars) {
      lines.push(rest);
      rest = "";
      break;
    }
    let cut = -1;
    for (let i = maxChars; i > 0; i--) {
      if (/[\s._-]/.test(rest[i - 1])) {
        cut = i;
        break;
      }
    }
    if (cut <= 0) {
      // A single long word: hyphenate it instead of cutting it off anywhere.
      cut = maxChars - 1;
      lines.push(`${rest.slice(0, cut)}-`);
      rest = rest.slice(cut);
      continue;
    }
    lines.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }

  if (rest.length > 0 && lines.length > 0) {
    const last = lines[lines.length - 1];
    lines[lines.length - 1] = `${last.length >= maxChars ? last.slice(0, maxChars - 1).trimEnd() : last}…`;
  }

  return lines;
}

export function truncate(text: string, maxChars: number): string {
  const trimmed = text.trim();
  return trimmed.length <= maxChars ? trimmed : `${trimmed.slice(0, maxChars - 1).trimEnd()}…`;
}

export type TextOptions = {
  x: number;
  y: number;
  size: number;
  weight?: number;
  fill?: string;
  opacity?: number;
  anchor?: "start" | "middle" | "end";
  /** Optional smaller suffix, e.g. a unit. */
  suffix?: string;
  suffixSize?: number;
};

export function text(content: string, o: TextOptions): string {
  const suffix = o.suffix
    ? `<tspan font-size="${o.suffixSize ?? Math.round(o.size * 0.5)}" font-weight="600" fill-opacity="0.75"> ${escapeXml(o.suffix)}</tspan>`
    : "";
  return (
    `<text x="${o.x}" y="${o.y}" font-family="${FONT}" font-size="${o.size}" font-weight="${o.weight ?? 700}" ` +
    `fill="${o.fill ?? "#FFFFFF"}" fill-opacity="${o.opacity ?? 1}" text-anchor="${o.anchor ?? "middle"}">` +
    `${escapeXml(content)}${suffix}</text>`
  );
}

/** Vertical gradient background with rounded corners. */
export function background(id: string, top: string, bottom: string, width: number, height: number, radius = 0): string {
  return (
    `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/>` +
    `</linearGradient></defs>` +
    `<rect width="${width}" height="${height}" rx="${radius}" fill="url(#${id})"/>`
  );
}

export function svg(width: number, height: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`;
}

/** SVG path of a ring segment (donut slice) between two angles in degrees (0 = top). */
export function ringSegment(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const point = (deg: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return `${(cx + r * Math.cos(rad)).toFixed(2)} ${(cy + r * Math.sin(rad)).toFixed(2)}`;
  };
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${point(startDeg)} A ${r} ${r} 0 ${large} 1 ${point(endDeg)}`;
}
