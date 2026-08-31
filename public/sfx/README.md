# Sound effects

Drop recordings in this folder, then run:

```
node tools/build-sfx-manifest.js
```

The game reads `manifest.json` and uses any recording it lists in place of
the synthesised cue. **Anything you do not provide keeps synthesising**, so a
partial set is fine — one good footstep recording is a real improvement even
with everything else generated.

An empty folder means every cue is synthesised, which is the current default.

## Naming

| Pattern | Meaning |
| --- | --- |
| `card.mp3` | One recording for the `card` cue |
| `card-1.mp3`, `card-2.mp3` | Several, picked at random per play |
| `footstep-carpet-1.mp3` | Footsteps for a specific surface |

`.mp3`, `.ogg`, `.wav`, `.m4a` and `.aac` are all accepted. MP3 is the safest
for browsers.

## Cues

| Cue | Fires when |
| --- | --- |
| `footstep-carpet` | Yellow Lobby, Red Rooms, Carpet Halls |
| `footstep-concrete` | Parking Garage, The Hub, Endless Exit Signs |
| `footstep-metal` | Electrical Station, Pipe Tunnels |
| `footstep-water` | Poolrooms |
| `footstep-tile` | (available, currently unused by any room) |
| `footstep` | Fallback if no surface-specific file exists |
| `card` | Picking up an access card |
| `allCards` | Picking up the seventh |
| `catch` | A creature reaches you |
| `gameOver` | The last life goes |
| `torchOn` / `torchOff` | The flashlight switch |
| `batteryLow` | The single battery warning |
| `falseExit` | Touching the exit without all cards |
| `win` | Escaping |
| `creatureIdle` | A creature within earshot, unaware — **positional** |
| `creatureAlert` | A creature that has detected you — **positional** |
| `creatureStep` | A chasing creature's footfalls — **positional** |

The three `creature*` cues are placed in 3D at the creature's position, so
record them **dry and mono** — no reverb or stereo width. The panner adds the
spatial character, and a stereo source fights it.

## Practical notes

- Keep them short. These are one-shots; anything over ~2 s will overlap itself.
- Two or three variants per cue kills the machine-gun repetition that a
  single footstep sample causes. The game also applies a small random pitch
  shift on top.
- Trim leading silence, or the sound will feel late.
- Normalise, but leave headroom — the game mixes several at once.
