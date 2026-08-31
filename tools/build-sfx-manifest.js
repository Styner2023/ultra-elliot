/*
 * Ultra Elliot - sound effect manifest builder
 *
 * Scans public/sfx/ and writes manifest.json. The game reads that manifest
 * and uses any listed recording in place of its synthesised cue; anything
 * not listed keeps synthesising, so a partial set is perfectly fine.
 *
 *     node tools/build-sfx-manifest.js
 *
 * Naming
 *   <cue>.<ext>              one recording for a cue      card.mp3
 *   <cue>-1.<ext>            several, picked at random    card-1.mp3, card-2.mp3
 *   footstep-<surface>.<ext> per-surface footsteps        footstep-carpet-1.mp3
 */

const fs = require("fs");
const path = require("path");

const DIR = path.resolve(__dirname, "..", "public", "sfx");
const EXTENSIONS = [".mp3", ".ogg", ".wav", ".m4a", ".aac"];

const SURFACES = ["carpet", "concrete", "metal", "water", "tile"];

const CUES = [
  "footstep",
  ...SURFACES.map((s) => "footstep-" + s),
  "card", "allCards", "catch", "gameOver",
  "torchOn", "torchOff", "batteryLow",
  "falseExit", "win",
  "creatureIdle", "creatureAlert", "creatureStep"
];

if (!fs.existsSync(DIR)) {
  console.error("public/sfx/ does not exist");
  process.exit(1);
}

const files = fs
  .readdirSync(DIR)
  .filter((f) => EXTENSIONS.includes(path.extname(f).toLowerCase()))
  .sort();

const manifest = {};
const unknown = [];

for (const file of files) {
  const stem = path.basename(file, path.extname(file));
  /* strip a trailing -1 / -2 variant suffix */
  const cue = stem.replace(/-\d+$/, "");

  if (!CUES.includes(cue)) {
    unknown.push(file);
    continue;
  }

  (manifest[cue] || (manifest[cue] = [])).push(file);
}

const out = path.join(DIR, "manifest.json");

if (files.length === 0) {
  if (fs.existsSync(out)) fs.unlinkSync(out);
  console.log("no recordings in public/sfx/ - the game will synthesise every cue");
  process.exit(0);
}

fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + "\n");

const used = Object.keys(manifest).sort();
console.log(`wrote public/sfx/manifest.json`);
console.log(`  ${files.length - unknown.length} recordings across ${used.length} cues`);
used.forEach((c) => console.log(`    ${c.padEnd(20)} ${manifest[c].length} file(s)`));

const missing = CUES.filter((c) => c !== "footstep" && !manifest[c]);
if (missing.length) {
  console.log(`  still synthesised (no recording): ${missing.join(", ")}`);
}

if (unknown.length) {
  console.log(`\n  IGNORED - filename does not match a cue:`);
  unknown.forEach((f) => console.log(`    ${f}`));
  console.log(`  valid cues: ${CUES.join(", ")}`);
}
