import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const input = path.join(root, "public", "logo lia style.PNG");
const output = path.join(root, "public", "whatsapp-profile-liastyle.jpg");
const size = 1024;
// WhatsApp recorta el cuadrado a un círculo: el contenido tiene que
// quedar bien adentro (aprox. 70% del diámetro) para que no se corte.
const contentRatio = 0.52;

const { data, info } = await sharp(input).rotate().ensureAlpha().raw().toBuffer({
  resolveWithObject: true,
});

function sample(x, y) {
  const sx = Math.min(info.width - 1, Math.max(0, Math.round(x)));
  const sy = Math.min(info.height - 1, Math.max(0, Math.round(y)));
  const i = (sy * info.width + sx) * info.channels;
  return { r: data[i], g: data[i + 1], b: data[i + 2] };
}

const points = [
  sample(info.width * 0.5, info.height * 0.22),
  sample(info.width * 0.22, info.height * 0.5),
  sample(info.width * 0.78, info.height * 0.5),
  sample(info.width * 0.5, info.height * 0.78),
];
const bg = points.reduce(
  (acc, p) => ({ r: acc.r + p.r, g: acc.g + p.g, b: acc.b + p.b }),
  { r: 0, g: 0, b: 0 },
);
bg.r = Math.round(bg.r / points.length);
bg.g = Math.round(bg.g / points.length);
bg.b = Math.round(bg.b / points.length);

let minX = info.width;
let minY = info.height;
let maxX = 0;
let maxY = 0;

for (let y = 0; y < info.height; y++) {
  for (let x = 0; x < info.width; x++) {
    const i = (y * info.width + x) * info.channels;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (a < 20) continue;
    const brightness = (r + g + b) / 3;
    if (brightness < 170) continue;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
}

const pad = Math.round(Math.max(maxX - minX, maxY - minY) * 0.08);
const left = Math.max(0, minX - pad);
const top = Math.max(0, minY - pad);
const width = Math.min(info.width - left, maxX - minX + 1 + pad * 2);
const height = Math.min(info.height - top, maxY - minY + 1 + pad * 2);

const target = Math.round(size * contentRatio);
const fitWidth = width >= height ? target : Math.round((width / height) * target);
const fitHeight = height >= width ? target : Math.round((height / width) * target);

const logo = await sharp(input)
  .rotate()
  .extract({ left, top, width, height })
  .resize(fitWidth, fitHeight, { fit: "fill" })
  .png()
  .toBuffer();

await sharp({
  create: { width: size, height: size, channels: 3, background: bg },
})
  .composite([{ input: logo, gravity: "centre" }])
  .jpeg({ quality: 92 })
  .toFile(output);

console.log("Generated", path.relative(root, output), {
  background: bg,
  letters: { left, top, width, height },
  placed: { fitWidth, fitHeight },
});
