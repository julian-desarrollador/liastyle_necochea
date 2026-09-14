import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, stat } from "node:fs/promises";
import sharp from "sharp";

const dir = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(dir, "export");
await mkdir(outDir, { recursive: true });

const jobs = [
  ["story-elegante.html", "story-elegante.png", 1080, 1920],
  ["story-salon.html", "story-salon.png", 1080, 1920],
  ["story-analia.html", "story-analia.png", 1080, 1920],
  ["story-app.html", "story-app.png", 1080, 1920],
  ["wa-cuadrado.html", "wa-cuadrado.png", 1080, 1080],
  ["qr-salon.html", "qr-salon.png", 1080, 1080],
];

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit" });
    child.on("exit", (code) => {
      if (code === 0 || code === 124) resolve(code);
      else reject(new Error(`${cmd} exited ${code}`));
    });
  });
}

for (const [html, png, w, h] of jobs) {
  const input = `file://${path.join(dir, html)}`;
  const output = path.join(outDir, png);
  const dataDir = `/tmp/chrome-flyers-${png.replace(/\W/g, "")}`;
  console.log("render", png);
  await run("timeout", [
    "12",
    "google-chrome",
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-background-networking",
    "--disable-sync",
    "--disable-extensions",
    "--disable-component-update",
    "--no-first-run",
    "--hide-scrollbars",
    `--user-data-dir=${dataDir}`,
    `--window-size=${w},${h}`,
    "--force-device-scale-factor=1",
    "--virtual-time-budget=4000",
    "--timeout=9000",
    `--screenshot=${output}`,
    input,
  ]);
  spawn("pkill", ["-f", `user-data-dir=${dataDir}`]);
  const info = await stat(output);
  if (info.size < 20_000) throw new Error(`tiny screenshot ${png} (${info.size})`);
  const jpg = output.replace(/\.png$/, ".jpg");
  await sharp(output).jpeg({ quality: 88, mozjpeg: true }).toFile(jpg);
  console.log("wrote", png, info.size);
}

console.log("ok", outDir);
