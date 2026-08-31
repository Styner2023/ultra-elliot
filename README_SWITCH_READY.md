# Ultra Elliot — Platform Readiness

**Ultra Elliot** is designed and developed by **StynerDev**
— <https://www.stynerdev.com/> · <https://www.styner.dev/>
© 2026 StynerDev. All rights reserved.

This document describes how **Ultra Elliot** is structured today, what is
already prepared for controller play, and what a real Nintendo Switch OLED
release would still require.

> **Status: not a Switch build.**
> Ultra Elliot is an HTML5 canvas game. It cannot be uploaded to a retail
> Switch, it is not signed, and nothing in this repository is derived from a
> Nintendo SDK. We do not currently hold Nintendo developer access, an NDA, a
> dev kit, or a publisher agreement. The work below reduces the eventual port
> to a re-implementation of known systems rather than a redesign — nothing
> more, and nothing less.

---

## 1. What works in the browser right now

| Area | State |
| --- | --- |
| Rendering | Textured raycaster, per-pixel floor/ceiling casting, flashlight cone, post-processing |
| Display | Locked 16:9, five internal resolution tiers, dynamic resolution targeting 60 FPS, manual quality override |
| Responsive | Desktop, laptop, tablet, phone; portrait and landscape; no crop, no horizontal scroll |
| Keyboard | WASD + arrows, Q/E turn, Shift, Enter, Escape, F, P |
| Mouse | Pointer-lock look, click to enter |
| Gamepad | Full Gamepad API support, two player slots |
| Touch | On-screen pad, run/torch/pause buttons, drag-to-look |
| Gameplay | 10 levels, 21 creatures, 7 access cards, 3 lives, true exit — unchanged |
| Resilience | Pauses on controller disconnect, suspend, and focus loss |
| Audio | Adaptive two-deck score with crossfade on detection, plus runtime-synthesised one-shot effects and HRTF-spatialised creature voices |

### Display tiers

Every tier is an exact 16:9 multiple, so the aspect ratio never drifts:

| Tier | Resolution | Purpose |
| --- | --- | --- |
| 0 | 1920×1080 | Switch docked / TV output |
| 1 | 1280×720 | **Switch OLED handheld native — the default** |
| 2 | 1024×576 | laptops, tablets |
| 3 | 864×486 | mid phones |
| 4 | 640×360 | weak devices |

On **Auto** the game boots at 720p and never *starts* higher: dynamic
resolution promotes only after sustained frames under 7.5 ms, demotes above
20 ms, and waits out a cooldown between changes so it cannot oscillate.

Auto is only the default, not a ceiling. A quality selector in the page lets a
player pin any tier — 1080p included — which switches dynamic scaling off
entirely and is remembered per browser. So the top tier is always reachable on
demand, and the heuristic only decides when nobody has chosen.

Because 1280×720 is both the default tier and the Switch OLED panel
resolution, what you see in the browser is already framed exactly as the
handheld would frame it.

---

## 2. What is prepared for controller play

All input flows through a single layer (`Input` in `game.js`). Nothing in the
game reads a key, a button, or a touch directly. Systems ask for **intent**:

```
moveX / moveY     strafe and walk       -1..1
lookX / lookY     camera rate           -1..1
run               sprint held           bool
confirm / back / pause / torch          edge-triggered, one frame
```

### Current bindings

| Intent | Keyboard | Gamepad (W3C standard mapping) | Touch |
| --- | --- | --- | --- |
| Move | WASD, Arrow Up/Down | Left Stick, D-pad | On-screen pad |
| Turn / look | Arrow Left/Right, Q/E, mouse | Right Stick | Drag on screen |
| Run | Shift | Left Stick Click (button 10) | RUN button |
| Confirm / restart | Enter | Button 0 (bottom face) | Tap screen |
| Back / cancel | Escape | Button 1 (right face), Select | — |
| Pause | Escape, P | Start / Menu (button 9) | ❚❚ button |
| Torch | F | Button 3 (top face) | TORCH button |

Sticks use a **radial deadzone**, so diagonals stay clean and stick drift is
rejected. Buttons are **edge-triggered**, so holding one does not repeat.

### ⚠️ Face button labels differ on Nintendo hardware

The Gamepad API's standard mapping is **positional, not by label**. Button 0 is
the bottom face button. On an Xbox-style pad that is A; on a Nintendo pad the
bottom button is physically marked **B**, and the right one is **A**.

The indices are correct as written and need no change. What a shipped Switch
build *must* change is the on-screen prompts — "Press A" has to follow
Nintendo's button naming and their button-glyph guidelines. That is a UI text
change, not an input change, which is precisely why prompts are generated from
the input layer rather than hard-coded.

---

## 3. Two-player local co-op

This is the most-asked question, so it gets a straight answer.

### What already exists

The input layer is **player-indexed from the start**. It is not a single
global control state with a second player bolted on:

* `Input.MAX_PLAYERS = 2`, with a separate intent object per player.
* Gamepad 0 fills slot 0, gamepad 1 fills slot 1, automatically.
* The slots are verified independent — one pad's stick cannot move the other
  player. There is an automated test for exactly this.
* The header shows a live gamepad count.

Plug in two controllers today and the engine already tracks two complete,
isolated sets of player intent.

### What is still missing

Two-player is **not playable yet**. The remaining work is in the renderer and
the world state, not the input:

1. **A second avatar.** `player` is currently a single object (position, angle,
   pitch, bob). It needs to become an array, and the systems that read it —
   raycasting, sprite billboarding, monster targeting, card pickup, the exit
   check — need a player argument.
2. **Split-screen viewports.** `draw()` renders one full-canvas view. For
   co-op it must render twice into half-height (or half-width) viewports.
   The floor/ceiling buffer, wall column loop, and post-processing all assume
   a full-canvas target and would need viewport rectangles threaded through.
   This roughly doubles per-frame cost, which is why the dynamic resolution
   system matters: a 2P mode would simply start a tier or two lower.
3. **Shared-world rules.** Decisions with no single-player equivalent: does a
   caught player respawn alone or end the run for both? Are the 7 cards a
   shared pool? Can one player revive the other? Do creatures target the
   nearer player or the lit one? These are design calls, not code problems.
4. **Per-player HUD.** The HUD is authored in one 1280×720 space; split-screen
   needs two smaller ones, each with its own torch battery.

Rough shape of the work: the input half is done, the renderer half is not.

### Why Joy-Con detach matters here

The Switch's defining local-multiplayer feature is sliding off two Joy-Con and
handing one to a second player. On real hardware that surfaces as two
controllers with a **reduced layout** — a single stick, no second stick, fewer
face buttons. A single-Joy-Con player therefore cannot use the current
right-stick camera scheme.

That is a design constraint worth deciding *before* the port, not after. The
usual answers are auto-centring camera, turn-with-the-single-stick, or
requiring a full controller for co-op. The input layer can express any of
them, because turning is already an abstract `lookX` rate rather than a
hard-wired stick axis.

---

## 3b. "Is it passing all the checks for Switch?"

**No — and it is important to be clear about why that question cannot be
answered yes from here.**

The 61 automated checks in this repository are **our own browser tests**. They
verify our 16:9 layout, our input abstraction, our gamepad mapping, our
resolution scaling and our gameplay rules. They are not Nintendo's checks and
they carry no certification weight whatsoever.

Nintendo's compliance pass is called **Lotcheck**. It is run by Nintendo, on
submitted retail builds, under NDA. It cannot be run, simulated, previewed or
self-assessed by anyone outside the developer programme, and its actual
contents are confidential. Nobody without an accepted developer account and a
dev kit can truthfully claim to be passing it.

On top of that, three things make a pass structurally impossible today:

| Blocker | Why it disqualifies |
| --- | --- |
| It is an HTML5 canvas game | Switch retail titles are native. There is no web runtime to submit to. |
| No SDK, no dev kit | We cannot produce a Switch executable, or run on the hardware at all. |
| No developer account or NDA | Submission is gated on both. |

### Known gaps we can already name

Independent of Lotcheck, these are things we know a console release needs and
we do not have:

| Gap | Status |
| --- | --- |
| Audio | Score, one-shot effects and HRTF-spatialised creature voices all done. Recordings can replace any cue via `public/sfx/`; synthesis is the fallback. |
| Localisation | English only. |
| Save data / user profiles | None. No progress is persisted. |
| Button glyphs and naming | Prompts say "A"; a Switch build must follow Nintendo's naming and glyph rules. |
| Age rating | Not submitted (ESRB / PEGI / etc.). |
| HD rumble, player LEDs, Joy-Con detach | Not applicable in a browser. |

### What we have hardened

Some certification-shaped behaviour is genuinely implementable in a browser,
and has been done, so the native port inherits correct behaviour rather than
having to discover it:

* **Controller disconnect pauses immediately** instead of dropping the player.
* **Suspend pauses** — tab hidden in a browser, sleep mode on a console.
* **Focus loss pauses.**
* **No world simulation runs while paused** (verified: the player is frozen
  across 60 frames).
* Dynamic resolution holds a 60 FPS target, with a manual override.
* **Audio stops on suspend, focus loss and controller disconnect**, and never
  autoplays before a user gesture.

That is real hardening. It is not certification, and it should never be
described as such.

---

## 4. What still requires Nintendo approval and a real port

None of the following can be done from this repository, and no amount of
browser work substitutes for it.

### Requires Nintendo, and cannot be started without them

* **Nintendo Developer Portal approval** and an accepted developer/publisher
  application.
* **An NDA**, without which the Switch SDK, its documentation, and its APIs
  cannot legally be read, discussed, or targeted.
* **A dev kit.** Retail hardware cannot run unsigned code. Performance,
  thermals, and handheld-vs-docked behaviour cannot be honestly measured on
  anything else.
* **Lotcheck / submission approval**, Nintendo's compliance pass covering
  suspend/resume, controller disconnect handling, error message wording,
  button-glyph usage, age rating, and much more.
* **eShop publishing agreement** and territory ratings (ESRB / PEGI / etc.).

### Requires a real port, not this code

The browser is not a shipping target for Switch. A release means
re-implementing this game natively — realistically **Unity** (well-trodden
Switch support, fastest route for a small team) or **C++** against the native
SDK (more control, considerably more work).

What ports cleanly, because it is plain logic and data:

* the maze generation and all 10 room layouts
* creature behaviour, detection ranges, and the awareness model
* the flashlight battery economy and lighting model
* card, lives, spawn-grace, and exit rules
* the input *intent* model and its bindings table

What must be rewritten:

* **All rendering.** The canvas raycaster, the per-pixel floor/ceiling caster,
  and the 2D post-processing chain have no equivalent. A native version would
  use the GPU properly — real 3D, shaders — rather than porting a software
  renderer.
* **Input backend.** Gamepad API → native controller APIs, including
  Joy-Con detach, HD rumble, player LEDs, and controller-disconnect pause,
  which is a lotcheck requirement.
* **Suspend / resume, docking transitions, and the software keyboard.**
* **Audio.** The game currently has none; a Switch release would need a full
  sound pass regardless.

### Honest summary

This repository makes Ultra Elliot **architecturally ready** — 16:9 native,
one input abstraction, controller-mapped, resolution-scalable, two player
slots. It does not make it a Switch game, and it cannot. That step needs
Nintendo's approval, their hardware, their SDK, and a native rewrite of the
renderer.

---

## 5. Where the marked code lives

Search `game.js` for `FUTURE NINTENDO SWITCH PORT PREPARATION`:

| Marker | What it covers |
| --- | --- |
| DISPLAY | 16:9 tiers, dynamic resolution, UI scaling |
| INPUT | the whole abstract input layer and its bindings |
| AUDIO | playlist rotation, ducking, mute — backend swaps for the port |
| SOUND EFFECTS | cue names, sample-or-synthesis selection, and 3D placement |
| SYSTEM INPUT | menu / pause / restart intent |
| (in `update`) | movement driven entirely by intent |
| (in `drawHUD`) | HUD authored at 1280×720 and scaled |

`style.css` carries a matching note on the 16:9 stage.
