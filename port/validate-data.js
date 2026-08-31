/*
 * Ultra Elliot - portable data validation
 *
 * Reads ONLY port/ultra-elliot.json - never game.js - and proves the export
 * is self-sufficient: that someone with just this file can build a level
 * that is navigable and completable.
 *
 *     node port/validate-data.js
 */

const fs = require("fs");
const path = require("path");

const data = JSON.parse(
  fs.readFileSync(path.join(__dirname, "ultra-elliot.json"), "utf8")
);

let failures = 0;
const check = (label, condition, detail) => {
  if (condition) console.log(`  ok   ${label}${detail ? " -> " + detail : ""}`);
  else { console.log(`  FAIL ${label}${detail ? " -> " + detail : ""}`); failures++; }
};

const W = data.world.gridWidth;
const H = data.world.gridHeight;
const map = data.world.collision;
const owner = data.world.roomOwnership;

const solid = (x, y) =>
  x < 0 || x >= W || y < 0 || y >= H || map[y][x] === "#";

console.log("=== structure ===");
check("collision map has the declared height", map.length === H, `${map.length} rows`);
check("every row has the declared width", map.every((r) => r.length === W), `${W} cols`);
check("ownership map matches collision dimensions",
  owner.length === H && owner.every((r) => r.length === W));

let open = 0;
for (const row of map) for (const c of row) if (c === ".") open++;
check("open cell count matches", open === data.world.openCells, `${open} cells`);

console.log("\n=== entities sit on open floor ===");
const onFloor = (p) => !solid(Math.floor(p.x), Math.floor(p.y));
check("player spawn", onFloor(data.player.spawn));
check("all cards", data.objectives.cards.every(onFloor),
  `${data.objectives.cards.length} cards`);
check("all creatures", data.creatures.every((c) => onFloor(c.spawn)),
  `${data.creatures.length} creatures`);
check("all decoy signs", data.objectives.decoyExitSigns.every(onFloor),
  `${data.objectives.decoyExitSigns.length} signs`);
check("true exit", onFloor(data.objectives.trueExit));

console.log("\n=== the level is completable from this file alone ===");
const seen = Array.from({ length: H }, () => new Array(W).fill(false));
const sx = Math.floor(data.player.spawn.x);
const sy = Math.floor(data.player.spawn.y);
const queue = [[sx, sy]];
seen[sy][sx] = true;
let reached = 0;

while (queue.length) {
  const [x, y] = queue.pop();
  reached++;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx, ny = y + dy;
    if (solid(nx, ny) || seen[ny][nx]) continue;
    seen[ny][nx] = true;
    queue.push([nx, ny]);
  }
}

const reach = (p) => seen[Math.floor(p.y)][Math.floor(p.x)];
check("every open cell is reachable from spawn", reached === open, `${reached}/${open}`);
check("every access card is reachable", data.objectives.cards.every(reach));
check("the true exit is reachable", reach(data.objectives.trueExit));

const roomsSeen = new Set();
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++)
    if (seen[y][x]) roomsSeen.add(parseInt(owner[y][x], 36));
check("every room is reachable", data.rooms.every((r) => roomsSeen.has(r.id)),
  `${roomsSeen.size} rooms entered`);

console.log("\n=== tuning is internally consistent ===");
check("torch drains faster than it recharges (the core tension)",
  data.flashlight.batteryDrainPerSecond > data.flashlight.batteryRechargePerSecond,
  `drain ${data.flashlight.batteryDrainPerSecond}/s vs recharge ${data.flashlight.batteryRechargePerSecond}/s`);
check("run speed exceeds walk speed",
  data.player.runSpeed > data.player.walkSpeed);
check("player outruns every creature",
  data.creatures.every((c) => c.chaseSpeed < data.player.runSpeed),
  `fastest creature ${Math.max(...data.creatures.map((c) => c.chaseSpeed))} vs run ${data.player.runSpeed}`);
check("no creature spawns inside the spawn safe radius",
  data.creatures.every((c) =>
    Math.hypot(c.spawn.x - data.player.spawn.x, c.spawn.y - data.player.spawn.y) >=
    data.player.spawnSafeRadius),
  `nearest ${Math.min(...data.creatures.map((c) =>
    Math.hypot(c.spawn.x - data.player.spawn.x, c.spawn.y - data.player.spawn.y))).toFixed(1)} units`);
check("every display tier is exactly 16:9",
  data.display.tiers.every((t) => t.w * 9 === t.h * 16),
  data.display.tiers.map((t) => `${t.w}x${t.h}`).join(" "));
check("card count matches the declared objective",
  data.objectives.cards.length === data.objectives.totalCards);

console.log(failures
  ? `\nRESULT: ${failures} FAILED`
  : "\nRESULT: the export is self-sufficient and the level is completable");
process.exit(failures ? 1 : 0);
