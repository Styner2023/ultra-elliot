/*
 * Ultra Elliot - release package builder
 *
 * Produces dist/ultra-elliot-web.zip: the playable game and nothing else.
 * index.html sits at the root of the archive, which is what itch.io,
 * Newgrounds, GameJolt and most HTML5 hosts expect.
 *
 *     node tools/build-release.js
 *
 * Excluded: source audio masters, the full-resolution cover, port tooling,
 * documentation, backups and OS noise.
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const STAGE = path.join(DIST, "ultra-elliot-web");

const INCLUDE = [
  "_headers",
  "index.html",
  "style.css",
  "game.js",
  "public/Ultra-Elliot-cover.jpg",
  "public/Ultra-Elliot-icon.png"
];

const INCLUDE_DIRS = [
  { from: "public/sound", skip: ["source", ".DS_Store"] },
  { from: "public/sfx", skip: ["README.md", ".DS_Store"] }
];

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });

let bytes = 0;
const copy = (rel) => {
  const src = path.join(ROOT, rel);
  if (!fs.existsSync(src)) return false;
  const dest = path.join(STAGE, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  bytes += fs.statSync(src).size;
  return true;
};

const missing = INCLUDE.filter((f) => !copy(f)).filter((f) => f !== "_headers");

if (missing.length) {
  console.error("MISSING required files: " + missing.join(", "));
  process.exit(1);
}

for (const dir of INCLUDE_DIRS) {
  const abs = path.join(ROOT, dir.from);
  if (!fs.existsSync(abs)) continue;

  for (const entry of fs.readdirSync(abs)) {
    if (dir.skip.includes(entry)) continue;
    if (fs.statSync(path.join(abs, entry)).isDirectory()) continue;
    copy(path.join(dir.from, entry));
  }
}

/* the archive must have index.html at its root, not inside a folder */
const zip = path.join(DIST, "ultra-elliot-web.zip");
execFileSync("zip", ["-r", "-q", "-X", zip, "."], { cwd: STAGE });

const zipped = fs.statSync(zip).size;

console.log("built dist/ultra-elliot-web.zip");
console.log(`  ${(bytes / 1024 / 1024).toFixed(2)} MB of files -> ${(zipped / 1024 / 1024).toFixed(2)} MB zipped`);
console.log("\ncontents:");
const walk = (dir, prefix = "") => {
  for (const entry of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) walk(full, prefix + entry + "/");
    else console.log(`  ${prefix}${entry}`);
  }
};
walk(STAGE);
console.log("\nitch.io  - upload the zip, tick \"played in the browser\", 1280x720, fullscreen on");
console.log("Cloudflare - wrangler pages deploy dist/ultra-elliot-web --project-name ultra-elliot");
console.log("Netlify    - netlify deploy --dir dist/ultra-elliot-web --prod");
