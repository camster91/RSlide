import { describe, expect, it } from "vitest";
import { h } from "preact";
import "../../src/web/lib/px";

describe("inline style numbers", () => {
  it("become pixels, except unitless properties", () => {
    const v = h("span", { style: { fontSize: 22, marginTop: 8, opacity: 0.5, zIndex: 3, flex: 1, lineHeight: 1.2, top: 0 } });
    expect((v.props as any).style).toEqual({ fontSize: "22px", marginTop: "8px", opacity: 0.5, zIndex: 3, flex: 1, lineHeight: 1.2, top: 0 });
  });
  it("leaves strings and components alone", () => {
    expect((h("div", { style: { width: "50%" } }).props as any).style.width).toBe("50%");
    const C = () => null;
    expect((h(C, { style: { width: 5 } } as any).props as any).style.width).toBe(5);
  });
});

import { codeFromScan } from "../../src/web/lib/native";
describe("codeFromScan", () => {
  it("finds the event code in what a QR code holds", () => {
    expect(codeFromScan("https://rslide.app/e/abc123")).toBe("ABC123");
    expect(codeFromScan("https://rslide.app/ABC123")).toBe("ABC123");
    expect(codeFromScan(" xyz789 ")).toBe("XYZ789");
    expect(codeFromScan("https://rslide.app/host/ABC123")).toBeNull();
    expect(codeFromScan("WIFI:S:home;T:WPA;P:secret;;")).toBeNull();
  });
});
