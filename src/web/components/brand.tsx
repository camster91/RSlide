// The brand editor: main colour, highlight colour, headline font, and hiding the app name.
// Used in event settings and team workspace settings.
import { useEffect, useState } from "preact/hooks";
import { brandPalette, cleanHex } from "../../shared/color";
import type { Brand, BrandFont } from "../../shared/protocol";
import { t } from "../lib/i18n";
import { CFG, toast } from "../lib/util";

function BrandSwatch({ k, label, fallback, brand, onChange }: { k: "color" | "accent"; label: string; fallback: string; brand: Brand; onChange: (b: Partial<Brand>) => void }) {
  const [text, setText] = useState(brand[k] ?? "");
  useEffect(() => setText(brand[k] ?? ""), [brand[k]]);
  const commit = (v: string) => {
    const hex = cleanHex(v);
    if (hex || !v.trim()) onChange({ [k]: hex });
    else toast(t("Use a colour code like #1a73e8"));
  };
  return (
    <div class="brand-swatch">
      <label class="label" for={`brand-${k}`}>
        {label}
      </label>
      <div class="row">
        <input type="color" aria-label={label} value={brand[k] ?? fallback} onChange={(e) => onChange({ [k]: e.currentTarget.value })} />
        <input id={`brand-${k}`} class="input" placeholder={t("Theme colour")} value={text} maxLength={7} onInput={(e) => setText(e.currentTarget.value)} onBlur={(e) => commit(e.currentTarget.value)} onKeyDown={(e) => e.key === "Enter" && commit(e.currentTarget.value)} />
        {brand[k] && (
          <button type="button" class="btn sm quiet" onClick={() => onChange({ [k]: null })}>
            {t("Reset")}
          </button>
        )}
      </div>
    </div>
  );
}

/** Your own brand colours and font. Colours are nudged just enough to stay readable. */
export function BrandEditor({ brand, onChange }: { brand: Brand; onChange: (b: Partial<Brand>) => void }) {
  const fonts: [BrandFont, string][] = [
    ["default", t("Modern")],
    ["classic", t("Classic")],
    ["rounded", t("Rounded")],
    ["mono", t("Mono")],
  ];
  const adjusted = brand.color && brandPalette(brand.color, null).brandLight !== brand.color;
  return (
    <div class="stack brand-editor" style={{ marginTop: 14 }}>
      <p class="label">{t("Your brand")}</p>
      <div class="brand-grid">
        <BrandSwatch k="color" label={t("Main colour")} fallback="#3b3fd8" brand={brand} onChange={onChange} />
        <BrandSwatch k="accent" label={t("Highlight colour")} fallback="#ffb21a" brand={brand} onChange={onChange} />
      </div>
      {adjusted && <p class="muted tiny">{t("We made your main colour a little darker so white text on it stays easy to read.")}</p>}
      <p class="label">{t("Headline font")}</p>
      <div class="seg" role="group" aria-label={t("Headline font")}>
        {fonts.map(([f, l]) => (
          <button key={f} aria-pressed={brand.font === f} onClick={() => onChange({ font: f })} data-font-sample={f}>
            {l}
          </button>
        ))}
      </div>
      <label class="toggle">
        <span>
          {t("Hide the {name} name", { name: CFG.name })}
          <span class="muted small" style={{ display: "block" }}>
            {t("Attendees and the big screen see only your logo.")}
          </span>
        </span>
        <input type="checkbox" checked={brand.hideAppName} onChange={(e) => onChange({ hideAppName: e.currentTarget.checked })} />
      </label>
    </div>
  );
}

