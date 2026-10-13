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

/** Fast, capable chat model on Workers AI. */
export const CHAT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

/** One chat turn. Returns the model's text, trimmed. */
export async function chat(env: AiEnv, system: string, user: string, maxTokens = 900): Promise<string> {
  const out = (await run(env, CHAT_MODEL, {
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    max_tokens: maxTokens,
    temperature: 0.3,
  })) as { response?: unknown } | undefined;
  const text = typeof out?.response === "string" ? out.response.trim() : "";
  if (!text) throw new Error("The AI returned nothing");
  return text;
}

/**
 * The AI writes polls in the same plain-text format people can paste,
 * so one parser handles both and the AI can never add anything we don't support.
 */
export const POLLS_PROMPT = `You turn a presenter's notes into audience polls.
Write ONLY the polls, in this exact plain-text format, with a blank line between polls:

Question text?
- Option one
- Option two

Rules:
- 2 to 6 options per multiple-choice question. Keep options under 8 words.
- For a quiz question, put " *" after the correct option.
- For questions without options, add one hint in brackets after the question: (rating), (word cloud), (open) or (scale).
- Use (ranking) after the question when people should put the options in order.
- Write 3 to 8 polls. Plain language. No numbering, no headings, no extra text.
- Write in the same language as the notes.`;

export const SUMMARY_PROMPT = `You write a short recap of a live event's audience Q&A and polls for people who attended.
Write 3 short paragraphs or fewer, under 160 words in total, in plain language.
Cover: what the audience cared about most (the top questions), what the polls showed, and anything left unanswered.
Do not invent facts, names or numbers that are not in the data. Do not use headings or bullet points.
Write in the same language as most of the questions.`;
