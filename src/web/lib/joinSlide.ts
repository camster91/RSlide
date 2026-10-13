// Makes a 1920×1080 "join" slide (code + QR) as a PNG, to drop into any deck:
// PowerPoint, Google Slides, Keynote, Canva… Drawn in the browser, nothing is uploaded.
import { t } from "./i18n";

export async function joinSlidePng(opts: { url: string; host: string; code: string; title: string }): Promise<Blob> {
  const { default: qrcode } = await import("qrcode-generator");
  const W = 1920;
  const H = 1080;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  const css = getComputedStyle(document.documentElement);
  const brand = css.getPropertyValue("--brand").trim() || "#3b3fd8";
  const accent = css.getPropertyValue("--accent").trim() || "#ffb21a";
  const display = css.getPropertyValue("--display").trim() || "system-ui, sans-serif";
  const body = css.getPropertyValue("--body").trim() || "system-ui, sans-serif";
  await document.fonts?.ready;

  // Background: the brand colour (white text on it always passes contrast).
  g.fillStyle = brand;
  g.fillRect(0, 0, W, H);

  // Left: title, instructions, the big code.
  const left = 120;
  const maxText = 1000;
  g.fillStyle = "#ffffff";
  g.textBaseline = "alphabetic";
  g.font = `500 44px ${body}`;
  g.globalAlpha = 0.9;
  g.fillText(fit(g, opts.title, maxText), left, 330);
  g.globalAlpha = 1;
  g.font = `700 72px ${display}`;
  const goTo = t("Go to {site}", { site: opts.host });
  g.fillText(fit(g, goTo, maxText), left, 450);
  g.fillText(fit(g, t("and enter the code"), maxText), left, 540);
  // Big code, shrunk to fit.
  let size = 230;
  g.font = `800 ${size}px ${display}`;
  while (g.measureText(opts.code).width > maxText && size > 80) g.font = `800 ${(size -= 10)}px ${display}`;
  g.fillText(opts.code, left, 540 + size + 20);
  g.fillStyle = accent;
  g.fillRect(left, 540 + size + 50, Math.min(maxText, g.measureText(opts.code).width), 14);

  // Right: the QR code on a white card.
  const qr = qrcode(0, "M");
  qr.addData(opts.url);
  qr.make();
  const n = qr.getModuleCount();
  const card = 620;
  const cx = W - card - 120;
  const cy = (H - card) / 2 - 20;
  g.fillStyle = "#ffffff";
  roundRect(g, cx, cy, card, card, 36);
  g.fill();
  const pad = 44;
  const cell = Math.floor((card - pad * 2) / n);
  const off = (card - cell * n) / 2;
  g.fillStyle = "#000000";
  for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) if (qr.isDark(r, col)) g.fillRect(cx + off + col * cell, cy + off + r * cell, cell, cell);
  g.fillStyle = "#ffffff";
  g.font = `500 38px ${body}`;
  g.textAlign = "center";
  g.fillText(t("Or scan to join"), cx + card / 2, cy + card + 70);

  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't draw the slide"))), "image/png"));
}

function fit(g: CanvasRenderingContext2D, text: string, max: number) {
  if (g.measureText(text).width <= max) return text;
  let s = text;
  while (s.length > 1 && g.measureText(`${s}…`).width > max) s = s.slice(0, -1);
  return `${s}…`;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export async function downloadJoinSlide(opts: { url: string; host: string; code: string; title: string }) {
  const blob = await joinSlidePng(opts);
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `join-${opts.code}.png` });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
