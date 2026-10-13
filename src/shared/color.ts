// Colour helpers for custom branding.
// A host can pick any brand colour. We nudge it lighter or darker just enough
// that text on it (and it on the page) stays readable (WCAG AA, 4.5:1).

export const HEX = /^#[0-9a-f]{6}$/i;

export function cleanHex(v: unknown): string | null {
  if (typeof v !== "string") return null;
  let s = v.trim().toLowerCase();
  if (/^#?[0-9a-f]{3}$/.test(s)) s = "#" + s.replace("#", "").replace(/./g, "$&$&");
  if (!s.startsWith("#")) s = "#" + s;
  return HEX.test(s) ? s : null;
}

type RGB = [number, number, number];

export function toRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHex([r, g, b]: RGB): string {
  return "#" + [r, g, b].map((x) => Math.round(Math.min(255, Math.max(0, x))).toString(16).padStart(2, "0")).join("");
}

export function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

/** Mix `hex` toward `to` by `t` (0–1). */
export function mix(hex: string, to: string, t: number): string {
  const a = toRgb(hex);
  const b = toRgb(to);
  return toHex([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
}

/** Move `hex` toward black or white, in small steps, until it reaches `ratio` against `against`. */
export function ensureContrast(hex: string, against: string, ratio = 4.5): string {
  if (contrast(hex, against) >= ratio) return hex;
  const toward = luminance(against) > 0.18 ? "#000000" : "#ffffff";
  for (let t = 0.05; t <= 1; t += 0.05) {
    const c = mix(hex, toward, t);
    if (contrast(c, against) >= ratio) return c;
  }
  return toward;
}

export interface BrandColors {
  brandLight: string;
  brandDark: string;
  accentLight: string;
  accentDark: string;
}

/** Light-mode and dark-mode versions of a brand (and accent) colour that pass contrast. */
export function brandPalette(color: string, accent: string | null): BrandColors {
  // Light pages: white text sits on the brand colour.
  const brandLight = ensureContrast(color, "#ffffff");
  // Dark pages: the brand colour sits on a dark page, with dark text on top.
  const brandDark = ensureContrast(color, "#0f1030", 6);
  // The accent carries dark text (buttons, tags), so it must be light enough.
  const a = accent ?? "#ffb21a";
  const accentLight = ensureContrast(a, "#1b1400");
  const accentDark = ensureContrast(a, "#1b1400", 7);
  return { brandLight, brandDark, accentLight, accentDark };
}
