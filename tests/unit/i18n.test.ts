import { describe, expect, it } from "vitest";
import { collectKeys, missing } from "../../scripts/i18n-keys";
import fr from "../../src/web/i18n/fr";
import es from "../../src/web/i18n/es";
import { parsePolls } from "../../src/shared/paste";

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();

describe.each([
  ["fr", fr],
  ["es", es],
])("%s translation", (lang, dict) => {
  it("covers every piece of text in the app", async () => {
    const m = await missing(lang);
    expect(m.strings).toEqual([]);
    expect(m.plurals).toEqual([]);
    expect(m.unused).toEqual([]);
  });

  it("keeps the same {placeholders}", () => {
    const bad = Object.entries(dict.strings).filter(([k, v]) => placeholders(k) !== placeholders(v));
    expect(bad).toEqual([]);
  });

  it("has no empty translations", () => {
    expect(Object.entries(dict.strings).filter(([, v]) => !v.trim())).toEqual([]);
    expect(Object.values(dict.plurals).every(([one, many]) => one && many)).toBe(true);
  });

  it("paste-to-polls example still works", () => {
    const key = Object.keys(dict.strings).find((k) => k.startsWith("Which launch"))!;
    const types = (s: string) => parsePolls(s).polls.map((p) => p.type);
    expect(types(dict.strings[key])).toEqual(types(key));
  });
});

it("finds the app's text", () => {
  const k = collectKeys();
  expect(k.strings.length).toBeGreaterThan(500);
  expect(k.plurals).toContain("question");
});
