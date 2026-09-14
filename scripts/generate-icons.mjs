/**
 * Genera favicons, iconos PWA y og:image desde public/logo lia style.PNG
 * Uso: npm run icons
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const input = path.join(root, "public", "logo lia style.PNG");
const outDir = path.join(root, "public");

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };
const SPLASH_BG = { r: 248, g: 246, b: 242, alpha: 1 };

function pipeline() {
  return sharp(input).rotate();
}

async function ensureSourceLogo() {
  if (fs.existsSync(input)) return;
  console.warn(
    `[icons] No existe ${path.relative(root, input)}. Generando placeholder (reemplazalo con el logo final).`,
  );
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
      <rect width="512" height="512" fill="#111111"/>
      <circle cx="256" cy="256" r="168" fill="none" stroke="#e4c48f" stroke-width="28"/>
      <text x="256" y="280" text-anchor="middle" font-family="Georgia,serif" font-size="72" fill="#b88e2f">Lia</text>
    </svg>`,
  );
  await sharp(svg).png().toFile(input);
}

async function paddedSquare(size, filename) {
  const resized = await pipeline()
    .ensureAlpha()
    .resize(size, size, { fit: "contain", background: TRANSPARENT })
    .toBuffer();

  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: TRANSPARENT,
    },
  })
    .composite([{ input: resized, gravity: "centre" }])
    .png({ compressionLevel: 9, effort: 10 })
    .toFile(path.join(outDir, filename));
}

async function main() {
  await ensureSourceLogo();

  for (const [size, name] of [
    [64, "favicon-64.png"],
    [48, "favicon-48.png"],
    [32, "favicon-32.png"],
    [16, "favicon-16.png"],
  ]) {
    await paddedSquare(size, name);
  }

  await paddedSquare(180, "apple-touch-icon.png");
  await paddedSquare(192, "icon-192.png");
  await paddedSquare(512, "icon-512.png");

  const ogW = 1200;
  const ogH = 630;
  const logoBox = 600;
  const logoBuf = await pipeline()
    .resize(logoBox, logoBox, { fit: "contain", background: SPLASH_BG })
    .toBuffer();

  await sharp({
    create: {
      width: ogW,
      height: ogH,
      channels: 4,
      background: SPLASH_BG,
    },
  })
    .composite([{ input: logoBuf, gravity: "centre" }])
    .jpeg({ quality: 90, mozjpeg: true })
    // Solo el logo. La preview que usa el sitio es og-image-v4.jpg
    // (logo + "Reservá tu turno online"), generada por scripts/flyer-render.mjs.
    .toFile(path.join(outDir, "og-image-v3.jpg"));

  await sharp(path.join(outDir, "og-image-v3.jpg")).jpeg({ quality: 90, mozjpeg: true }).toFile(
    path.join(outDir, "og-image.jpg"),
  );

  console.log("[icons] OK:", [
    "favicon-64.png",
    "favicon-48.png",
    "favicon-32.png",
    "favicon-16.png",
    "apple-touch-icon.png",
    "icon-192.png",
    "icon-512.png",
    "og-image-v3.jpg",
    "og-image.jpg",
  ].join(", "));
}

main().catch((e) => {
  console.error("[icons]", e);
  process.exit(1);
});
