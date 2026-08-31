# Ultra Elliot — Porting Guide

Everything a native port needs, in a form that does not depend on the browser.

This directory is **engine-agnostic**. Nothing in it is Nintendo-specific, and
nothing in it came from a platform SDK. It is equally useful for Unity, Godot,
a C++ engine, or a rewrite of the web version.

## Files

| File | Purpose |
| --- | --- |
| `ultra-elliot.json` | The whole game as data: level, entities, rules, tuning |
| `export-data.js` | Regenerates the JSON from `game.js` — run after any change |
| `validate-data.js` | Proves the JSON alone is sufficient and the level completable |

```
node port/export-data.js      # regenerate
node port/validate-data.js    # verify
```

`validate-data.js` deliberately never reads `game.js`. It rebuilds the level
from the JSON and flood-fills it, so a green run means someone holding only
that file can build a navigable, completable game.

---

## What ports as-is

All of this is plain logic and data. It carries straight over:

* **Level geometry** — `world.collision` is 44 rows of 56 characters, `#` wall
  and `.` floor. One cell is one world unit; walls are 1.0 tall and the camera
  sits at 0.5. Build geometry directly from it.
* **Room ownership** — `world.roomOwnership` gives the owning room per cell in
  base 36 (`0` = solid). This drives per-room lighting, textures and the
  creature "same room" rule.
* **Entities** — 21 creature spawns, 7 access cards, 14 decoy exit signs and
  the true exit, all with coordinates and room assignments.
* **Every tuning number** — speeds, detection radii, battery economy, catch
  radius, spawn grace.
* **The input contract** — see `inputContract`.

## What must be rewritten

The renderer, entirely. The browser build is a software raycaster with a
per-pixel floor/ceiling caster and a 2D post-processing chain. A native port
should not port that — it should use the GPU properly. The JSON gives you the
world; how you draw it is a fresh decision.

Also platform-specific and therefore not portable: audio backend, controller
backend, suspend/resume, and save data.

---

## The rules, precisely

### Creature detection

```
chasing =
      not inSpawnGrace
  and creatureRoom == playerRoom            # roomOwnership lookup
  and distance < detectionRadius + (torchOn ? 1.0 : 0)
  and clearLineOfSight(creature, player)    # sampled every 0.14 units
```

When chasing, the creature turns to face the player and moves at
`chaseSpeed`; otherwise it drifts at `wanderSpeed` (0.42). If it moves less
than 0.003 units in a frame it is stuck: turn 1.0–3.3 radians and pause
0.08–0.24 s.

Contact within `catchRadius` (0.47) costs a life.

**The player always outruns every creature** (run 3.05 vs fastest 1.34). Being
caught is a navigation failure, not a footrace — this is deliberate and worth
preserving.

### On being caught

1. Lose a life. At zero lives the run ends.
2. Return the player to `player.spawn`.
3. Return every creature within `spawnSafeRadius` (7 units) to its own spawn.
4. Restore 0.35 battery.
5. Grant `spawnGraceSeconds` (3) during which nothing chases and nothing
   catches.

Steps 3 and 5 exist because without them a respawn drops the player straight
back into whatever just caught them. That was a real bug; do not drop it.

### Flashlight

Drains 0.0055/s on, recharges 0.0042/s off — roughly 182 s of light against
238 s to refill. The ratio is the whole economy: light is a resource you spend
to see and to be seen.

* Cone half-angle `FOV * 0.40`, with a vertical falloff so it does not light
  the ceiling directly overhead.
* Below 0.25 battery the beam stutters.
* Room 4 (Electrical Station) disrupts the beam continuously.
* **A lit player is detected 1.0 units further away.** This is the cost.

Ambient light is per-room (`rooms[].ambientLight`, 0.07–0.34). The Yellow
Lobby is crossable without the torch; the Endless Exit Signs is not.

### Winning

Collect all 7 cards (pickup radius 0.55), then reach the true exit (radius
0.75) in room 10. Touching it early reports a false exit. The 14 decoy signs
are visual only and carry no collision.

---

## Input contract

The game consumes **intent**, never devices:

```
moveX, moveY   -1..1   strafe, walk
lookX, lookY   -1..1   yaw rate, pitch rate
run            bool
confirm / back / pause / torch / music   edge-triggered, one frame
```

Implement that shape from native controller APIs and every system keeps
working unchanged. Sticks use a **radial** deadzone of 0.22.

Two player slots already exist (`inputContract.playerSlots`). See the co-op
section of `../README_SWITCH_READY.md` for what local co-op still needs — the
input half is done, the renderer half is not.

### A note on face buttons

The browser build uses the W3C standard mapping, which is **positional**:
button 0 is the bottom face button. On Nintendo hardware the bottom button is
marked **B** and the right one **A** — the inverse of an Xbox pad. Indices
stay correct; on-screen prompts must be relabelled. Prompts are generated from
the input layer rather than hard-coded, so this is a text change.

---

## Display

Five tiers, every one an exact 16:9 multiple:

| Tier | Resolution |
| --- | --- |
| 0 | 1920×1080 |
| 1 | 1280×720 — default |
| 2 | 1024×576 |
| 3 | 864×486 |
| 4 | 640×360 |

The browser build runs dynamic resolution against a 60 FPS target and exposes
a manual override. A native port has a fixed target and should measure on real
hardware rather than inherit these numbers.

---

## Scope limits

This directory prepares a port. It is not a port, and it cannot become one
here:

* No platform SDK is present, referenced, or required by any file here.
* Producing a console build needs that platform's toolchain, an approved
  developer account, and hardware to test on.
* Platform compliance requirements are confidential to their holders. Work
  from the documentation your developer account gives you — do not paste it
  into third-party tools, this one included.
