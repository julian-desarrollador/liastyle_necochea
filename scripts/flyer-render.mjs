/**
 * Renderiza los flyers de lanzamiento a PNG con Chrome headless.
 * Requiere `node scripts/flyer-server.mjs` corriendo en el puerto 7433.
 *
 * Uso: node scripts/flyer-render.mjs
 */
import path from "node:path";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import sharp from "sharp";

const run = promisify(execFile);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "flyers");
const BASE = "http://localhost:7433/flyers/fuente/flyer.html";

const chromeCandidates = [
  path.join(process.env.LOCALAPPDATA ?? "", "Google/Chrome/Application/chrome.exe"),
  path.join(process.env.ProgramFiles ?? "", "Google/Chrome/Application/chrome.exe"),
  path.join(process.env["ProgramFiles(x86)"] ?? "", "Microsoft/Edge/Application/msedge.exe"),
  path.join(process.env.ProgramFiles ?? "", "Microsoft/Edge/Application/msedge.exe"),
];
const chrome = chromeCandidates.find((p) => p && existsSync(p));
if (!chrome) {
  console.error("No encontre Chrome ni Edge instalado.");
  process.exit(1);
}

const formatos = [
  { v: "story", w: 1080, h: 1920, file: "historia-instagram-whatsapp.png" },
  { v: "square", w: 1080, h: 1080, file: "cuadrado-difusion.png" },
  { v: "og", w: 1200, h: 630, file: "og-image-link.png" },
];

await mkdir(outDir, { recursive: true });

for (const f of formatos) {
  const out = path.join(outDir, f.file);
  await run(chrome, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    `--window-size=${f.w},${f.h}`,
    "--virtual-time-budget=6000",
    `--screenshot=${out}`,
    `${BASE}?v=${f.v}`,
  ]);
  const meta = await sharp(out).metadata();
  console.log(`${f.file} -> ${meta.width}x${meta.height}`);
}

// La preview del link vive en el sitio: se sirve desde /public como JPG.
const ogPng = path.join(outDir, "og-image-link.png");
const ogJpg = path.join(root, "public", "og-image-v4.jpg");
await sharp(ogPng).jpeg({ quality: 88 }).toFile(ogJpg);
const ogMeta = await sharp(ogJpg).metadata();
console.log(`public/og-image-v4.jpg -> ${ogMeta.width}x${ogMeta.height}`);

console.log(`\nListo. Archivos en: ${path.relative(root, outDir)}`);
