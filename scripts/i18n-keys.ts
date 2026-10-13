// Lists every piece of text the app translates, and which ones a language is missing.
//   npx tsx scripts/i18n-keys.ts          → missing French and Spanish strings
//   npx tsx scripts/i18n-keys.ts --all    → every key, as JSON
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === "i18n" ? [] : files(p);
    return /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}

const unescape = (s: string) => s.replace(/\\(["'`\\])/g, "$1").replace(/\\n/g, "\n");
const STR = String.raw`"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|\`((?:[^\`\\$]|\\.)*)\``;

export function collectKeys() {
  const strings = new Set<string>();
  const plurals = new Set<string>();
  for (const f of files(join(root, "src/web"))) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(new RegExp(String.raw`\b(?:t|tj)\(\s*(?:${STR})`, "g"))) strings.add(unescape(m[1] ?? m[2] ?? m[3]));
    for (const m of src.matchAll(new RegExp(String.raw`\b(?:plural|pluralWord)\([^,()]*(?:\([^()]*\))?[^,()]*,\s*(?:${STR})`, "g"))) plurals.add(unescape(m[1] ?? m[2] ?? m[3]));
  }
  // Messages the server sends to people, shown as they are (translated on the phone).
  for (const f of files(join(root, "src/worker"))) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(new RegExp(String.raw`new UserError\(\s*(?:${STR})`, "g"))) strings.add(unescape(m[1] ?? m[2] ?? m[3]));
  }
  return { strings: [...strings].sort(), plurals: [...plurals].sort() };
}

export async function missing(lang: string) {
  const dict = (await import(join(root, `src/web/i18n/${lang}.ts`))).default as { strings: Record<string, string>; plurals: Record<string, unknown> };
  const keys = collectKeys();
  return {
    strings: keys.strings.filter((k) => !(k in dict.strings)),
    plurals: keys.plurals.filter((k) => !(k in dict.plurals)),
    unused: Object.keys(dict.strings).filter((k) => !keys.strings.includes(k)),
  };
}

if (process.argv[1]?.endsWith("i18n-keys.ts")) {
  if (process.argv.includes("--all")) console.log(JSON.stringify(collectKeys(), null, 2));
  else
    for (const l of ["fr", "es"]) {
      const m = await missing(l);
      console.log(`${l}: ${m.strings.length} strings and ${m.plurals.length} plural words missing, ${m.unused.length} unused`);
      if (process.argv.includes("--list")) console.log(JSON.stringify(m, null, 2));
    }
}
