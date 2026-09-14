import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const dir = path.dirname(fileURLToPath(import.meta.url));
const input = path.join(dir, "../../public/logo lia style.PNG");
const output = path.join(dir, "assets/logo-ls.png");

const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({
  resolveWithObject: true,
});

const px = Buffer.from(data);
for (let i = 0; i < px.length; i += 4) {
  const r = px[i];
  const g = px[i + 1];
  const b = px[i + 2];
  if (r < 32 && g < 32 && b < 32) px[i + 3] = 0;
}

await sharp(px, {
  raw: { width: info.width, height: info.height, channels: 4 },
}).png({ compressionLevel: 9 }).toFile(output);

console.log("logo", output);
