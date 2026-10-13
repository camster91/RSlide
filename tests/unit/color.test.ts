import { describe, expect, it } from "vitest";
import { brandPalette, cleanHex, contrast, ensureContrast } from "../../src/shared/color";
import { cleanBrand } from "../../src/worker/logic";
import { DEFAULT_BRAND } from "../../src/shared/protocol";

describe("brand colours", () => {
  it("cleans hex codes", () => {
    expect(cleanHex("#1A73E8")).toBe("#1a73e8");
    expect(cleanHex("1a73e8")).toBe("#1a73e8");
    expect(cleanHex("#abc")).toBe("#aabbcc");
    expect(cleanHex("red")).toBeNull();
    expect(cleanHex("#12345g")).toBeNull();
    expect(cleanHex(42)).toBeNull();
  });

  it("keeps colours that already pass, and fixes ones that don't", () => {
    expect(ensureContrast("#3b3fd8", "#ffffff")).toBe("#3b3fd8");
    const fixed = ensureContrast("#ffe600", "#ffffff");
    expect(contrast(fixed, "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });

  it("makes a readable palette from any colour", () => {
    for (const c of ["#ffff00", "#00ff00", "#000000", "#ffffff", "#e91e63", "#123456"]) {
      const p = brandPalette(c, c);
      expect(contrast(p.brandLight, "#ffffff")).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.brandDark, "#0f1030")).toBeGreaterThanOrEqual(6);
      expect(contrast(p.accentLight, "#1b1400")).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("cleans brand settings from the client", () => {
    expect(cleanBrand({ color: "#ABCDEF", accent: "nope", font: "comic", hideAppName: "yes" })).toEqual({ ...DEFAULT_BRAND, color: "#abcdef" });
    const cur = { color: "#111111", accent: "#222222", font: "mono" as const, hideAppName: true };
    expect(cleanBrand({ accent: null }, cur)).toEqual({ ...cur, accent: null });
    expect(cleanBrand("junk", cur)).toEqual(cur);
  });
});
