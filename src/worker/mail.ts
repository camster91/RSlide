// Sends the sign-in email. Works with Cloudflare Email Service or Resend; either is optional.
//
//   Cloudflare Email Service: add  "send_email": [{ "name": "EMAIL", "remote": true }]  to wrangler.jsonc
//   Resend:                   set the RESEND_API_KEY secret
//   Both need EMAIL_FROM (an address on a domain you've verified with that service).

export interface MailEnv {
  EMAIL?: { send(msg: { from: string | { email: string; name?: string }; to: string; subject: string; html: string; text: string }): Promise<{ messageId?: string }> };
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  /** Shown as the sender name and in the email. */
  APP_NAME?: string;
  /** "1" = return sign-in links in the API response instead of emailing them. Development and tests only. */
  AUTH_DEV_LINKS?: string;
}

export const mailReady = (env: MailEnv) => !!((env.EMAIL || env.RESEND_API_KEY) && env.EMAIL_FROM);
export const devLinks = (env: MailEnv) => env.AUTH_DEV_LINKS === "1";
/** Sign-in links in API responses: only on this machine, never on a real server, whatever the setting says. */
export const devMode = (env: MailEnv, hostname: string) => devLinks(env) && ["localhost", "127.0.0.1", "[::1]"].includes(hostname);

const COPY = {
  en: { subject: "Your sign-in link for {app}", hello: "Here's your link to sign in to {app}.", button: "Sign in", note: "The link works once and expires in 15 minutes. If you didn't ask for it, you can ignore this email." },
  fr: { subject: "Votre lien de connexion à {app}", hello: "Voici votre lien pour vous connecter à {app}.", button: "Se connecter", note: "Le lien fonctionne une seule fois et expire dans 15 minutes. Si vous ne l'avez pas demandé, ignorez ce courriel." },
  es: { subject: "Tu enlace para entrar a {app}", hello: "Aquí tienes tu enlace para entrar a {app}.", button: "Entrar", note: "El enlace funciona una sola vez y caduca en 15 minutos. Si no lo pediste, puedes ignorar este correo." },
} as const;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function signInEmail(app: string, link: string, lang: string) {
  const c = COPY[(lang in COPY ? lang : "en") as keyof typeof COPY];
  const f = (s: string) => s.replace("{app}", app);
  const text = `${f(c.hello)}\n\n${link}\n\n${c.note}\n`;
  const html = `<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#f4f4f8;padding:32px">
<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:32px">
<p style="font-size:18px;margin:0 0 24px">${esc(f(c.hello))}</p>
<p style="margin:0 0 24px"><a href="${esc(link)}" style="display:inline-block;background:#3b3fd8;color:#fff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:999px">${esc(c.button)}</a></p>
<p style="color:#666;font-size:14px;margin:0 0 12px">${esc(c.note)}</p>
<p style="color:#999;font-size:12px;word-break:break-all;margin:0">${esc(link)}</p>
</div></body></html>`;
  return { subject: f(c.subject), text, html };
}

/** Throws if the email couldn't be sent. */
export async function sendSignIn(env: MailEnv, to: string, link: string, lang: string) {
  const app = env.APP_NAME || "RSlide";
  const { subject, text, html } = signInEmail(app, link, lang);
  const from = env.EMAIL_FROM!;
  if (env.EMAIL) {
    await env.EMAIL.send({ from: { email: from, name: app }, to, subject, text, html });
    return;
  }
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: `${app} <${from}>`, to: [to], subject, text, html }),
  });
  if (!r.ok) throw new Error(`Resend answered ${r.status}`);
}
