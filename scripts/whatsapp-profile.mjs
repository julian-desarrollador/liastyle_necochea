import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const input = path.join(root, "public", "logo lia style.PNG");
const output = path.join(root, "public", "whatsapp-profile-liastyle.jpg");
const size = 1024;

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

const inset = Math.round(Math.min(info.width, info.height) * 0.18);
const cropSize = Math.min(info.width, info.height) - inset * 2;

await sharp(input)
  .rotate()
  .extract({
    left: Math.round((info.width - cropSize) / 2),
    top: Math.round((info.height - cropSize) / 2),
    width: cropSize,
    height: cropSize,
  })
  .resize(size, size, { fit: "cover" })
  .flatten({ background: bg })
  .jpeg({ quality: 92 })
  .toFile(output);

console.log("Generated", path.relative(root, output), "background", bg);
