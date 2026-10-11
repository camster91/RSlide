// Optional AI helpers (Cloudflare Workers AI). Everything works without them.
//
// Turn AI on in one of two ways:
//   1. Add a Workers AI binding to wrangler.jsonc:  "ai": { "binding": "AI" }
//   2. Or set two secrets: AI_ACCOUNT_ID and AI_API_TOKEN (a token with "Workers AI: Read").
// Then switch on "AI help" in an event's settings. It is off by default.

/** Multilingual, so a French and an English question about the same thing still match. */
export const EMBED_MODEL = "@cf/baai/bge-m3";
/** Cosine score at which two AI embeddings count as "the same question". */
export const AI_DUPLICATE_SCORE = 0.84;

export interface AiEnv {
  AI?: { run(model: string, input: unknown): Promise<unknown> };
  AI_ACCOUNT_ID?: string;
  AI_API_TOKEN?: string;
}

export const aiAvailable = (env: AiEnv) => !!(env.AI || (env.AI_ACCOUNT_ID && env.AI_API_TOKEN));

async function run(env: AiEnv, model: string, input: unknown): Promise<unknown> {
  if (env.AI) return env.AI.run(model, input);
  if (!env.AI_ACCOUNT_ID || !env.AI_API_TOKEN) throw new Error("AI is not set up");
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.AI_ACCOUNT_ID}/ai/run/${model}`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.AI_API_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) throw new Error(`Workers AI returned ${r.status}`);
  const d = (await r.json()) as { result?: unknown };
  return d.result;
}

/** One vector per text. Throws if the AI service fails, so callers can fall back. */
export async function embed(env: AiEnv, texts: string[]): Promise<number[][]> {
  const out = (await run(env, EMBED_MODEL, { text: texts })) as { data?: number[][] } | undefined;
  const data = out?.data;
  if (!Array.isArray(data) || data.length !== texts.length) throw new Error("Unexpected AI response");
  return data;
}

/** Vectors are stored as 32-bit floats to keep the database small. */
export const packVector = (v: number[]) => new Float32Array(v).buffer;
export const unpackVector = (b: ArrayBuffer) => new Float32Array(b);
