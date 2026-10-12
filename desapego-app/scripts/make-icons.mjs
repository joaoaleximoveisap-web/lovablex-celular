// Gera os ícones do app (PNG) a partir do SVG da marca, usando o Chromium já instalado.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const out = new URL("../public/icons/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const mark = (pad) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="100%" height="100%">
  <rect width="64" height="64" fill="#17352F"/>
  <g transform="translate(${32 - 32 * (1 - pad * 2)} ${32 - 32 * (1 - pad * 2)}) scale(${1 - pad * 2})">
    <path d="M20 27.5 32 18l12 9.5V44a2 2 0 0 1-2 2H22a2 2 0 0 1-2-2V27.5Z" fill="none" stroke="#fff" stroke-width="3.4" stroke-linejoin="round"/>
    <path d="M32 40.5s-6.5-3.9-6.5-8.3a3.6 3.6 0 0 1 6.5-2.2 3.6 3.6 0 0 1 6.5 2.2c0 4.4-6.5 8.3-6.5 8.3Z" fill="#7FD1B1"/>
  </g>
</svg>`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();
const jobs = [
  ["icon-192.png", 192, 0.02, 40],
  ["icon-512.png", 512, 0.02, 110],
  ["maskable-512.png", 512, 0.12, 0],
  ["apple-touch-icon.png", 180, 0.04, 0],
];
for (const [name, size, pad, radius] of jobs) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent"><div style="width:${size}px;height:${size}px;border-radius:${radius}px;overflow:hidden">${mark(pad)}</div></body></html>`);
  await page.screenshot({ path: out + name, omitBackground: true });
}
await browser.close();
console.log("ícones gerados em", out);
