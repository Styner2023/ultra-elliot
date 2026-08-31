"use strict";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const statusEl = document.getElementById("status");
const roomStat = document.getElementById("roomStat");
const cardStat = document.getElementById("cardStat");
const lifeStat = document.getElementById("lifeStat");
const restartBtn = document.getElementById("restartBtn");
const pauseBtn = document.getElementById("pauseBtn");
const padStat = document.getElementById("padStat");
const qualitySel = document.getElementById("quality");
const musicBtn = document.getElementById("musicBtn");

/* =====================================================================
   FUTURE NINTENDO SWITCH PORT PREPARATION - DISPLAY
   ---------------------------------------------------------------------
   The stage is locked to 16:9 and rendered into a fixed internal
   resolution, exactly the way a console title targets a panel:

     1280x720  Switch OLED handheld native
     1920x1080 Switch docked / TV output
     lower tiers for weak phones and laptops

   The browser stretches that buffer to whatever the page gives it, so
   gameplay, HUD layout and field of view are identical on every device.
   Dynamic resolution keeps the 60 FPS target when a device cannot hold
   the top tier.

   NOTE: this is ordinary HTML canvas code. It contains nothing
   Nintendo-proprietary and cannot be uploaded to a retail Switch. It
   only makes the eventual port a re-implementation rather than a
   redesign.
   ===================================================================== */

const Display = {
  BASE_W: 1280,
  BASE_H: 720,
  ASPECT: 16 / 9,

  /* every tier is exactly 16:9 */
  tiers: [
    { w: 1920, h: 1080, label: "1080p (docked / TV)" },
    { w: 1280, h: 720, label: "720p (Switch OLED handheld)" },
    { w: 1024, h: 576, label: "576p" },
    { w: 864, h: 486, label: "486p" },
    { w: 640, h: 360, label: "360p" }
  ],

  tier: 1,
  ui: 1,

  /* "auto" runs dynamic resolution; a numeric mode pins that tier and
     switches dynamic scaling off. Persisted per browser. */
  mode: "auto",
  STORE_KEY: "ultraElliot.quality",

  _avgMs: 16.7,
  _samples: 0,
  _cooldown: 0,
  _sized: false,
  _locked: false,

  init() {
    this.pickStartTier();

    /* a saved preference wins over the auto-detected tier */
    let saved = null;
    try {
      saved = window.localStorage.getItem(this.STORE_KEY);
    } catch (err) {
      saved = null;
    }

    this.setMode(saved || "auto", false);

    if (qualitySel) {
      qualitySel.value = this.mode;
      qualitySel.addEventListener("change", () => {
        this.setMode(qualitySel.value, true);
        canvas.focus();
      });
    }

    window.addEventListener("resize", () => this.apply());
    window.addEventListener("orientationchange", () => {
      setTimeout(() => this.apply(), 150);
    });
  },

  /* Start at Switch-native 720p and never above it. 1080p is earned by
     a machine that demonstrably has the headroom, not assumed. */
  pickStartTier() {
    const cssW = canvas.clientWidth || window.innerWidth || this.BASE_W;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const target = cssW * dpr;

    let t = 1;
    while (t < this.tiers.length - 1 && this.tiers[t].w > target * 1.1) t++;

    this.tier = t;
  },

  apply() {
    const { w, h } = this.tiers[this.tier];

    /* _sized guards the case where the markup already declares the
       starting tier's size: the dimensions match, so no resize would
       fire, and the render buffers would never be allocated. */
    if (canvas.width !== w || canvas.height !== h || !this._sized) {
      canvas.width = w;
      canvas.height = h;
      onDisplayResize(w, h);
      this._sized = true;
    }

    /* HUD and menu text are authored against BASE_H and scaled from it */
    this.ui = h / this.BASE_H;
  },

  /* Dynamic resolution. Consoles ship this; it is what keeps a 60 FPS
     target honest on hardware that cannot hold the top tier.

     Thresholds are deliberately asymmetric and followed by a cooldown.
     Each step up is ~1.5x the pixels, so a symmetric rule would sit and
     oscillate between two tiers forever. */
  DEMOTE_MS: 20,
  PROMOTE_MS: 7.5,
  WINDOW: 90,
  COOLDOWN: 240,

  sample(ms) {
    if (this._locked) return;

    this._avgMs += (ms - this._avgMs) * 0.08;
    this._samples++;

    if (this._cooldown > 0) {
      this._cooldown--;
      return;
    }

    if (this._samples < this.WINDOW) return;
    this._samples = 0;

    if (this._avgMs > this.DEMOTE_MS && this.tier < this.tiers.length - 1) {
      this.tier++;
      this.apply();
      this._cooldown = this.COOLDOWN;
    } else if (this._avgMs < this.PROMOTE_MS && this.tier > 0) {
      this.tier--;
      this.apply();
      this._cooldown = this.COOLDOWN;
    }
  },

  /* mode: "auto" or a tier index as a string */
  setMode(mode, persist) {
    if (mode === "auto") {
      this.mode = "auto";
      this._locked = false;
      this.pickStartTier();
    } else {
      const index = Number(mode);

      if (!Number.isInteger(index) || index < 0 || index >= this.tiers.length) {
        return this.setMode("auto", persist);
      }

      this.mode = String(index);
      this.tier = index;
      this._locked = true;
    }

    this._avgMs = 16.7;
    this._samples = 0;
    this._cooldown = 0;

    this.apply();

    if (persist) {
      try {
        window.localStorage.setItem(this.STORE_KEY, this.mode);
      } catch (err) {
        /* private mode: the choice simply will not persist */
      }
      setStatus(
        this.mode === "auto"
          ? "Quality: Auto (dynamic resolution)."
          : `Quality locked to ${this.label()}.`,
        2.5
      );
    }

    return undefined;
  },

  label() {
    return this.tiers[this.tier].label;
  }
};

/* =====================================================================
   FUTURE NINTENDO SWITCH PORT PREPARATION - INPUT
   ---------------------------------------------------------------------
   One input layer. Nothing in the game reads a key, a button or a touch
   directly; it reads an abstract per-player intent:

     moveX / moveY   strafe and walk        -1..1
     lookX / lookY   camera rate            -1..1
     run             sprint held            bool
     confirm / back / pause / torch         edge-triggered

   Sources feeding it today:
     keyboard  -> player 0
     mouse     -> player 0 (pointer lock)
     touch     -> player 0
     gamepad 0 -> player 0
     gamepad 1 -> player 1     (slot exists; see README_SWITCH_READY.md)

   Because intent is per-player and already indexed, adding local co-op
   is a renderer change (split viewports) plus a second avatar - not an
   input rewrite. That is the whole point of this layer.

   Gamepad indices below are the W3C *standard mapping*, which is
   positional, not by label. Button 0 is the bottom face button. On a
   Nintendo pad the bottom button is physically marked B and the right
   one A, so a shipped Switch build must relabel prompts even though the
   indices stay put.
   ===================================================================== */

function makePlayerInput() {
  return {
    connected: false,
    padIndex: -1,

    moveX: 0,
    moveY: 0,
    lookX: 0,
    lookY: 0,
    run: false,

    /* accumulated pointer / touch look, in pixels, consumed each frame */
    lookDX: 0,
    lookDY: 0,

    held: { confirm: false, back: false, pause: false, torch: false, music: false },
    prev: { confirm: false, back: false, pause: false, torch: false, music: false },
    pressed: { confirm: false, back: false, pause: false, torch: false, music: false }
  };
}

/* radial deadzone: keeps diagonals clean and stops stick drift */
function stickVector(x, y, dead) {
  const m = Math.hypot(x, y);

  if (m < dead) return [0, 0];

  const scaled = (m - dead) / (1 - dead) / m;

  return [x * scaled, y * scaled];
}

const clamp1 = (v) => (v < -1 ? -1 : v > 1 ? 1 : v);

const Input = {
  MAX_PLAYERS: 2,
  DEADZONE: 0.22,

  /* stick sensitivities */
  TURN_RATE: 2.9,
  PITCH_RATE: 460,
  MOUSE_SENS: 0.0022,
  TOUCH_SENS: 0.0042,

  keys: new Set(),
  touchHeld: new Set(),
  taps: new Set(),

  players: [],
  padCount: 0,
  lastPadCount: -1,

  HELD_KEYS: [
    "w", "a", "s", "d", "q", "e", "shift",
    "arrowup", "arrowdown", "arrowleft", "arrowright"
  ],

  init() {
    for (let i = 0; i < this.MAX_PLAYERS; i++) {
      this.players.push(makePlayerInput());
    }

    /* hybrids and touchscreen laptops report pointer:fine, so the CSS
       media query alone is not enough to decide about touch controls */
    if (
      (navigator.maxTouchPoints || 0) > 0 ||
      "ontouchstart" in window
    ) {
      document.body.classList.add("has-touch");
    }

    this.bindKeyboard();
    this.bindPointer();
    this.bindTouchButtons();

    window.addEventListener("gamepadconnected", () => this.pollPads());

    /* FUTURE NINTENDO SWITCH PORT PREPARATION:
       every console certification programme requires that losing a
       controller mid-game pauses immediately rather than dropping the
       player. Implemented here so the behaviour is already correct and
       the native port only has to swap the event source. */
    window.addEventListener("gamepaddisconnected", () => {
      this.pollPads();

      if (this.lastPadCount > 0) {
        systemPause("Controller disconnected - reconnect, then press Start.");
      }
    });

    /* Suspend / resume. In a browser that is the tab being hidden; on a
       console it is sleep mode and the home menu. Same requirement:
       never keep simulating while the player cannot see the screen. */
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) systemPause("Suspended - paused.");
      else Music.resume();
    });
  },

  player(i) {
    return this.players[i] || this.players[0];
  },

  /* ---------- keyboard ---------- */

  bindKeyboard() {
    window.addEventListener("keydown", (event) => {
      const key = event.key.toLowerCase();

      /* a real key press is a user gesture, which is what browsers
         require before any audio may start */
      Music.unlock();
      Sfx.unlock();

      if (this.HELD_KEYS.includes(key)) {
        event.preventDefault();
        this.keys.add(key);
        return;
      }

      if (key === "enter") {
        event.preventDefault();
        this.taps.add("confirm");
      } else if (key === "escape") {
        this.taps.add("back");
      } else if (key === "p") {
        this.taps.add("pause");
      } else if (key === "f") {
        event.preventDefault();
        this.taps.add("torch");
      } else if (key === "m") {
        event.preventDefault();
        this.taps.add("music");
      } else if (key === "b") {
        bloomOn = !bloomOn;
        setStatus(`Bloom ${bloomOn ? "on" : "off"}.`, 1.5);
      }
    });

    window.addEventListener("keyup", (event) => {
      this.keys.delete(event.key.toLowerCase());
    });

    window.addEventListener("blur", () => {
      this.keys.clear();
      this.touchHeld.clear();
      systemPause("Focus lost - paused.");
    });
  },

  /* ---------- mouse and touch look ---------- */

  bindPointer() {
    canvas.addEventListener("mousemove", (event) => {
      if (document.pointerLockElement !== canvas) return;

      const p = this.players[0];
      p.lookDX += event.movementX * this.MOUSE_SENS;
      p.lookDY += event.movementY * this.MOUSE_SENS;
    });

    /* drag to look on phones and tablets */
    let dragId = null;
    let lastX = 0;
    let lastY = 0;

    canvas.addEventListener("pointerdown", (event) => {
      if (event.pointerType !== "touch") return;
      dragId = event.pointerId;
      lastX = event.clientX;
      lastY = event.clientY;
    });

    canvas.addEventListener("pointermove", (event) => {
      if (event.pointerId !== dragId) return;

      const p = this.players[0];
      p.lookDX += (event.clientX - lastX) * this.TOUCH_SENS;
      p.lookDY += (event.clientY - lastY) * this.TOUCH_SENS;

      lastX = event.clientX;
      lastY = event.clientY;
    });

    const endDrag = (event) => {
      if (event.pointerId === dragId) dragId = null;
    };

    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);
  },

  /* ---------- on-screen buttons ---------- */

  bindTouchButtons() {
    document.querySelectorAll("[data-key]").forEach((button) => {
      const key = button.dataset.key;

      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        Music.unlock();
      Sfx.unlock();
        this.touchHeld.add(key);
      });

      ["pointerup", "pointercancel", "pointerleave"].forEach((name) => {
        button.addEventListener(name, () => this.touchHeld.delete(key));
      });
    });

    document.querySelectorAll("[data-tap]").forEach((button) => {
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        Music.unlock();
      Sfx.unlock();
        this.taps.add(button.dataset.tap);
      });
    });
  },

  /* ---------- gamepads ---------- */

  pollPads() {
    return navigator.getGamepads ? navigator.getGamepads() : [];
  },

  readGamepads() {
    const pads = this.pollPads();
    let slot = 0;
    let count = 0;

    for (let i = 0; i < pads.length && slot < this.MAX_PLAYERS; i++) {
      const pad = pads[i];
      if (!pad || !pad.connected) continue;

      count++;

      const p = this.players[slot];
      p.connected = true;
      p.padIndex = pad.index;
      slot++;

      const held = (n) => !!(pad.buttons[n] && pad.buttons[n].pressed);
      const axis = (n) => (typeof pad.axes[n] === "number" ? pad.axes[n] : 0);

      /* left stick: move */
      const [lx, ly] = stickVector(axis(0), axis(1), this.DEADZONE);
      p.moveX += lx;
      p.moveY += -ly;

      /* right stick: camera */
      const [rx, ry] = stickVector(axis(2), axis(3), this.DEADZONE);
      p.lookX += rx;
      p.lookY += ry;

      /* d-pad mirrors the left stick */
      if (held(12)) p.moveY += 1;
      if (held(13)) p.moveY -= 1;
      if (held(14)) p.moveX -= 1;
      if (held(15)) p.moveX += 1;

      if (held(10)) p.run = true;          /* left stick click = run   */
      if (held(0)) p.held.confirm = true;  /* bottom face  = confirm   */
      if (held(1)) p.held.back = true;     /* right face   = back      */
      if (held(9)) p.held.pause = true;    /* start / menu = pause     */
      if (held(8)) p.held.back = true;     /* select       = back      */
      if (held(3)) p.held.torch = true;    /* top face     = torch     */
    }

    this.padCount = count;

    if (count !== this.lastPadCount) {
      this.lastPadCount = count;
      if (padStat) padStat.hidden = count === 0;
      if (count > 0 && padStat) {
        padStat.textContent = count > 1 ? `${count} Gamepads` : "Gamepad";
      }
    }
  },

  /* ---------- per-frame resolve ---------- */

  update() {
    for (const p of this.players) {
      p.moveX = 0;
      p.moveY = 0;
      p.lookX = 0;
      p.lookY = 0;
      p.run = false;
      p.connected = false;
      p.held.confirm = false;
      p.held.back = false;
      p.held.pause = false;
      p.held.torch = false;
      p.held.music = false;
    }

    const p0 = this.players[0];

    /* keyboard + on-screen buttons both drive player 0 */
    const down = (k) => this.keys.has(k) || this.touchHeld.has(k);

    if (down("w") || down("arrowup")) p0.moveY += 1;
    if (down("s") || down("arrowdown")) p0.moveY -= 1;
    if (down("a")) p0.moveX -= 1;
    if (down("d")) p0.moveX += 1;
    if (down("arrowleft") || down("q")) p0.lookX -= 1;
    if (down("arrowright") || down("e")) p0.lookX += 1;
    if (down("shift")) p0.run = true;

    this.readGamepads();

    /* one-shot taps from keys and on-screen buttons */
    if (this.taps.size) {
      for (const tap of this.taps) {
        if (tap in p0.held) p0.held[tap] = true;
      }
    }

    for (const p of this.players) {
      p.moveX = clamp1(p.moveX);
      p.moveY = clamp1(p.moveY);
      p.lookX = clamp1(p.lookX);
      p.lookY = clamp1(p.lookY);

      for (const name of ["confirm", "back", "pause", "torch", "music"]) {
        /* a tap is pressed for exactly one frame */
        const isTap = p === p0 && this.taps.has(name);
        p.pressed[name] = isTap || (p.held[name] && !p.prev[name]);
        p.prev[name] = p.held[name] && !isTap;
      }
    }

    this.taps.clear();
  },

  /* pointer/touch look is a delta, not a rate, so it is drained */
  consumeLook(p) {
    const out = { x: p.lookDX, y: p.lookDY };
    p.lookDX = 0;
    p.lookDY = 0;
    return out;
  },

  clearLook() {
    for (const p of this.players) {
      p.lookDX = 0;
      p.lookDY = 0;
    }
  },

  anyPad() {
    return this.padCount > 0;
  }
};

/* =====================================================================
   FUTURE NINTENDO SWITCH PORT PREPARATION - AUDIO
   ---------------------------------------------------------------------
   A rotating soundtrack behind a small state machine. The game never
   touches an <audio> element directly; it asks Music for a state and
   Music decides what should be playing and how loud.

   A native port replaces the HTMLAudioElement backend with the console
   audio API and keeps the playlist, rotation, ducking and mute logic
   exactly as-is.
   ===================================================================== */

const Music = {
  DIR: "public/sound/",
  STORE_KEY: "ultraElliot.music",

  /* Two decks. Only one is ever audible; the other is faded to silence
     and parked. Switching decks is a crossfade, not a cut. */
  decks: {
    explore: {
      name: "explore",
      lazy: false,
      tracks: [
        { file: "explore-01-claustrophobic-drone-i.mp3", title: "Claustrophobic Drone I" },
        { file: "explore-02-fluorescent-shadows-i.mp3", title: "Fluorescent Shadows I" },
        { file: "explore-03-fluorescent-shadows-ii.mp3", title: "Fluorescent Shadows II" },
        { file: "explore-04-claustrophobic-drone-ii.mp3", title: "Claustrophobic Drone II" }
      ],
      el: null,
      index: 0,
      volume: 0,
      armed: false
    },
    danger: {
      name: "danger",
      /* not fetched until the player is actually in the maze, so the
         title screen does not pay for it */
      lazy: true,
      tracks: [
        { file: "danger-01-creature-hunt-i.mp3", title: "Creature Hunt I" },
        { file: "danger-02-creature-hunt-ii.mp3", title: "Creature Hunt II" },
        { file: "danger-03-pounding-heartbeat.mp3", title: "Pounding Heartbeat" }
      ],
      el: null,
      index: 0,
      volume: 0,
      armed: false
    }
  },

  active: "explore",
  enabled: true,
  unlocked: false,
  failed: false,

  /* A menu pause ducks the score but keeps it running. A *system*
     suspend - hidden tab, lost focus, controller gone - stops it dead.
     Without this flag update() simply restarts the deck one frame after
     suspend() paused it. */
  suspended: false,

  /* volume targets by game state */
  VOL_TITLE: 0.55,
  VOL_EXPLORE: 0.42,
  VOL_DANGER: 0.62,
  VOL_PAUSED: 0.12,

  /* a creature flickering in and out of sight must not flap the score */
  DANGER_HOLD: 4.5,
  FADE_IN: 2.2,
  FADE_OUT: 1.1,

  master: 0,
  hold: 0,

  list() {
    return [this.decks.explore, this.decks.danger];
  },

  init() {
    try {
      this.decks.explore.el = new Audio();
      this.decks.danger.el = new Audio();
    } catch (err) {
      this.failed = true;
      return;
    }

    for (const deck of this.list()) {
      deck.el.preload = deck.lazy ? "none" : "auto";
      deck.el.loop = false;
      deck.el.volume = 0;

      deck.el.addEventListener("ended", () => this.advance(deck, true));
      deck.el.addEventListener("error", () => {
        if (deck.tracks.length > 1) this.advance(deck, false);
      });
    }

    try {
      if (window.localStorage.getItem(this.STORE_KEY) === "off") {
        this.enabled = false;
      }
    } catch (err) {
      /* private mode - preference will not persist */
    }

    this.load(this.decks.explore, 0);

    if (musicBtn) {
      musicBtn.addEventListener("click", () => {
        this.toggle();
        canvas.focus();
      });
    }

    this.syncButton();
  },

  src(deck, i) {
    return this.DIR + deck.tracks[i].file;
  },

  load(deck, i) {
    if (this.failed) return;

    const count = deck.tracks.length;
    deck.index = ((i % count) + count) % count;
    deck.el.src = this.src(deck, deck.index);
    deck.armed = true;
  },

  /* pull the danger deck down only once the maze is actually running */
  arm(deck) {
    if (this.failed || deck.armed) return;

    deck.el.preload = "auto";
    this.load(deck, deck.index);
  },

  advance(deck, announce) {
    if (this.failed) return;

    this.load(deck, deck.index + 1);

    if (deck.name === this.active) {
      this.playDeck(deck);
      if (announce) setStatus(`♪ ${deck.tracks[deck.index].title}`, 3);
    }
  },

  playDeck(deck) {
    if (this.failed || !this.enabled || !this.unlocked) return;

    const promise = deck.el.play();
    if (promise && typeof promise.catch === "function") {
      promise.catch(() => {});
    }
  },

  unlock() {
    if (this.failed || this.unlocked) return;

    this.unlocked = true;
    this.playDeck(this.decks[this.active]);
  },

  current() {
    const deck = this.decks[this.active];
    return deck.tracks[deck.index] || { title: "" };
  },

  toggle() {
    if (this.failed) return;

    this.enabled = !this.enabled;

    if (this.enabled) {
      this.unlocked = true;
      this.playDeck(this.decks[this.active]);
      setStatus(`♪ ${this.current().title}`, 3);
    } else {
      for (const deck of this.list()) deck.el.pause();
      setStatus("Music off.", 2);
    }

    try {
      window.localStorage.setItem(this.STORE_KEY, this.enabled ? "on" : "off");
    } catch (err) {
      /* not persistable here */
    }

    /* one control for all audio: players expect a mute to mute */
    Sfx.setEnabled(this.enabled);

    this.syncButton();
  },

  syncButton() {
    if (!musicBtn) return;

    musicBtn.textContent = this.enabled ? "♪ On" : "♪ Off";
    musicBtn.setAttribute("aria-pressed", this.enabled ? "true" : "false");
  },

  /* Called once per frame. Chooses the deck the situation calls for and
     the volume the game state deserves, then eases everything there. */
  update(dt, hunted) {
    if (this.failed) return;

    /* deck selection, with hysteresis so it cannot flap */
    if (started && !won && !gameOver) {
      this.arm(this.decks.danger);

      if (hunted) {
        this.hold = this.DANGER_HOLD;
        this.active = "danger";
      } else if (this.hold > 0) {
        this.hold -= dt;
        if (this.hold <= 0) this.active = "explore";
      }
    } else {
      this.hold = 0;
      this.active = "explore";
    }

    /* master volume by game state */
    if (!this.enabled || this.suspended) {
      this.master = 0;
    } else if (!started) {
      this.master = this.VOL_TITLE;
    } else if (paused) {
      this.master = this.VOL_PAUSED;
    } else if (won || gameOver) {
      this.master = this.VOL_TITLE;
    } else if (this.active === "danger") {
      this.master = this.VOL_DANGER;
    } else {
      this.master = this.VOL_EXPLORE;
    }

    /* crossfade: rising deck comes in faster than the falling one leaves */
    for (const deck of this.list()) {
      const isActive =
        deck.name === this.active && this.enabled && !this.suspended;
      const target = isActive ? this.master : 0;
      const rate = target > deck.volume ? this.FADE_OUT : this.FADE_IN;

      deck.volume += (target - deck.volume) * Math.min(1, dt * (1 / rate) * 3);

      if (deck.volume < 0) deck.volume = 0;
      if (deck.volume > 1) deck.volume = 1;

      try {
        deck.el.volume = deck.volume;
      } catch (err) {
        /* some browsers refuse volume writes; harmless */
      }

      if (isActive) {
        if (deck.el.paused && this.unlocked) this.playDeck(deck);
      } else if (deck.volume < 0.005 && !deck.el.paused) {
        /* fully faded out: park it rather than burn bandwidth */
        deck.el.pause();
      }
    }
  },

  suspend() {
    if (this.failed) return;

    this.suspended = true;
    for (const deck of this.list()) deck.el.pause();
    Sfx.suspend();
  },

  resume() {
    if (this.failed) return;

    this.suspended = false;
    Sfx.resume();
    this.playDeck(this.decks[this.active]);
  }
};

/* =====================================================================
   FUTURE NINTENDO SWITCH PORT PREPARATION - SOUND EFFECTS
   ---------------------------------------------------------------------
   One-shot effects, synthesised at runtime with Web Audio rather than
   streamed from files. Nothing to download, nothing to cache, and every
   sound is a handful of numbers that can be retuned without a re-encode.

   The game never builds an oscillator itself; it calls Sfx.play("card")
   and this module decides what that means. Swapping to real recorded
   samples, or to a console audio backend, is a change inside play() -
   every call site stays as it is.
   ===================================================================== */

/* Footsteps take their character from what the player is walking on. */
const SFX_SURFACES = {
  carpet: { freq: 430, q: 1.0, dur: 0.15, gain: 0.15, thump: 70 },
  concrete: { freq: 1500, q: 1.7, dur: 0.10, gain: 0.17, thump: 95 },
  metal: { freq: 2700, q: 3.6, dur: 0.18, gain: 0.14, thump: 150 },
  water: { freq: 950, q: 0.8, dur: 0.24, gain: 0.18, thump: 0 },
  tile: { freq: 2100, q: 2.3, dur: 0.11, gain: 0.16, thump: 130 }
};

const SFX_ROOM_SURFACE = {
  1: "carpet", 2: "carpet", 3: "concrete", 4: "metal", 5: "water",
  6: "metal", 7: "concrete", 8: "carpet", 9: "carpet", 10: "concrete"
};

const Sfx = {
  ctx: null,
  master: null,
  noiseBuffer: null,
  enabled: true,
  muted: false,
  failed: false,

  MASTER_GAIN: 0.85,

  /* Created lazily: an AudioContext made before a user gesture starts
     suspended and stays that way in most browsers. */
  unlock() {
    if (this.failed) return;

    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
      return;
    }

    const Ctor = window.AudioContext || window.webkitAudioContext;

    if (!Ctor) {
      this.failed = true;
      return;
    }

    try {
      this.ctx = new Ctor();
    } catch (err) {
      this.failed = true;
      return;
    }

    this.master = this.ctx.createGain();
    this.master.gain.value = this.MASTER_GAIN;
    this.master.connect(this.ctx.destination);

    this.noiseBuffer = this.buildNoise(0.5);
  },

  buildNoise(seconds) {
    const rate = this.ctx.sampleRate;
    const buffer = this.ctx.createBuffer(1, Math.floor(rate * seconds), rate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    return buffer;
  },

  ready() {
    return (
      !this.failed &&
      !!this.ctx &&
      this.enabled &&
      !this.muted &&
      this.ctx.state === "running"
    );
  },

  /* Current gain for the current state. */
  level() {
    return this.enabled && !this.muted ? this.MASTER_GAIN : 0;
  },

  applyGain() {
    if (!this.master) return;

    try {
      this.master.gain.value = this.level();
    } catch (err) {
      /* harmless */
    }
  },

  /* ---- primitives ---- */

  /* a filtered burst of noise: impacts, footsteps, splashes */
  burst(when, { freq, q, dur, gain, type = "bandpass", sweep = 0 }) {
    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, when);
    filter.Q.value = q;

    if (sweep) {
      filter.frequency.exponentialRampToValueAtTime(
        Math.max(40, freq * sweep),
        when + dur
      );
    }

    const amp = this.ctx.createGain();
    amp.gain.setValueAtTime(0.0001, when);
    amp.gain.exponentialRampToValueAtTime(gain, when + 0.006);
    amp.gain.exponentialRampToValueAtTime(0.0001, when + dur);

    source.connect(filter);
    filter.connect(amp);
    amp.connect(this.master);

    source.start(when);
    source.stop(when + dur + 0.02);
  },

  /* a pitched tone: pickups, warnings, stings */
  tone(when, { freq, dur, gain, type = "sine", slideTo = 0, delay = 0 }) {
    const start = when + delay;

    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);

    if (slideTo) {
      osc.frequency.exponentialRampToValueAtTime(slideTo, start + dur);
    }

    const amp = this.ctx.createGain();
    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.exponentialRampToValueAtTime(gain, start + 0.012);
    amp.gain.exponentialRampToValueAtTime(0.0001, start + dur);

    osc.connect(amp);
    amp.connect(this.master);

    osc.start(start);
    osc.stop(start + dur + 0.02);
  },

  /* ---- the effects themselves ---- */

  play(name, options = {}) {
    if (!this.ready()) return false;

    const t = this.ctx.currentTime;

    try {
      switch (name) {
        case "footstep": {
          const surface =
            SFX_SURFACES[options.surface] || SFX_SURFACES.concrete;

          /* each step varies slightly so a corridor never sounds looped */
          const vary = 0.88 + Math.random() * 0.24;
          const loud = options.running ? 1.35 : 1;

          this.burst(t, {
            freq: surface.freq * vary,
            q: surface.q,
            dur: surface.dur,
            gain: surface.gain * loud,
            sweep: 0.55
          });

          if (surface.thump) {
            this.tone(t, {
              freq: surface.thump * vary,
              dur: 0.09,
              gain: 0.10 * loud,
              type: "sine",
              slideTo: surface.thump * 0.6
            });
          }
          break;
        }

        case "card":
          /* two-note rise: unmistakably a pickup */
          this.tone(t, { freq: 880, dur: 0.13, gain: 0.16, type: "triangle" });
          this.tone(t, {
            freq: 1320, dur: 0.30, gain: 0.14, type: "triangle", delay: 0.09
          });
          this.burst(t + 0.09, {
            freq: 5200, q: 1.2, dur: 0.16, gain: 0.05, sweep: 0.5
          });
          break;

        case "allCards":
          /* the run just changed shape - say so */
          [660, 880, 1320].forEach((f, i) =>
            this.tone(t, {
              freq: f, dur: 0.5, gain: 0.13, type: "triangle", delay: i * 0.11
            })
          );
          break;

        case "catch": {
          /* low impact, then the drop out of the world */
          this.burst(t, { freq: 190, q: 0.7, dur: 0.5, gain: 0.42, sweep: 0.25 });
          this.tone(t, {
            freq: 150, dur: 0.7, gain: 0.30, type: "sawtooth", slideTo: 42
          });
          this.tone(t, {
            freq: 96, dur: 0.9, gain: 0.20, type: "square", slideTo: 34, delay: 0.05
          });
          break;
        }

        case "torchOn":
          this.burst(t, { freq: 3400, q: 6, dur: 0.05, gain: 0.16 });
          this.tone(t, { freq: 1500, dur: 0.05, gain: 0.07, type: "square" });
          break;

        case "torchOff":
          this.burst(t, { freq: 2400, q: 6, dur: 0.05, gain: 0.14 });
          this.tone(t, { freq: 900, dur: 0.06, gain: 0.06, type: "square" });
          break;

        case "batteryLow":
          /* two dry ticks, easy to miss and easy to regret missing */
          [0, 0.17].forEach((d) =>
            this.tone(t, {
              freq: 620, dur: 0.10, gain: 0.10, type: "square", delay: d
            })
          );
          break;

        case "falseExit":
          this.tone(t, {
            freq: 210, dur: 0.42, gain: 0.16, type: "sawtooth", slideTo: 130
          });
          this.burst(t, { freq: 380, q: 1.4, dur: 0.30, gain: 0.10 });
          break;

        case "win":
          [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
            this.tone(t, {
              freq: f, dur: 1.5, gain: 0.13, type: "triangle", delay: i * 0.16
            })
          );
          break;

        case "gameOver":
          [392, 311, 233, 174.6].forEach((f, i) =>
            this.tone(t, {
              freq: f, dur: 1.4, gain: 0.15, type: "sawtooth", delay: i * 0.22
            })
          );
          break;

        default:
          return false;
      }
    } catch (err) {
      /* a browser refusing a node must never take the frame down */
      return false;
    }

    return true;
  },

  surfaceFor(room) {
    return SFX_ROOM_SURFACE[room] || "concrete";
  },

  /* Deliberately does NOT suspend the AudioContext. A suspended context
     needs the audio thread - and sometimes fresh user activation - to come
     back, which can leave effects dead for the rest of the session. Muting
     the master gain and refusing to build nodes sounds identical and can
     never get stuck. */
  suspend() {
    this.muted = true;
    this.applyGain();
  },

  resume() {
    this.muted = false;

    /* best effort, for a context the browser suspended under its
       autoplay policy rather than one we muted ourselves */
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }

    this.applyGain();
  },

  setEnabled(on) {
    this.enabled = on;
    this.applyGain();
  }
};



const GRID_W = 56;
const GRID_H = 44;
const FOV = Math.PI / 3;

const TOTAL_CARDS = 7;
const EXIT_ROOM = 10;

const rooms = [
  { id: 1,  name: "Yellow Lobby",       x1: 1,  y1: 1,  x2: 13, y2: 10 },
  { id: 2,  name: "Office Maze",        x1: 16, y1: 1,  x2: 29, y2: 11 },
  { id: 3,  name: "Parking Garage",     x1: 32, y1: 1,  x2: 43, y2: 11 },
  { id: 4,  name: "Electrical Station", x1: 46, y1: 1,  x2: 54, y2: 12 },
  { id: 5,  name: "Poolrooms",          x1: 1,  y1: 14, x2: 13, y2: 26 },
  { id: 6,  name: "Pipe Tunnels",       x1: 16, y1: 14, x2: 28, y2: 26 },
  { id: 7,  name: "The Hub",            x1: 31, y1: 14, x2: 43, y2: 27 },
  { id: 8,  name: "Red Rooms",          x1: 46, y1: 15, x2: 54, y2: 27 },
  { id: 9,  name: "Carpet Halls",       x1: 1,  y1: 30, x2: 26, y2: 41 },
  { id: 10, name: "Endless Exit Signs", x1: 29, y1: 30, x2: 54, y2: 41 }
];

/* amb = how much light the room has on its own.
   Low amb rooms are where the flashlight becomes the whole game. */
const themes = {
  1:  { amb: 0.34, fog: [180, 170, 115], ceilScale: 0.5 },
  2:  { amb: 0.25, fog: [135, 137, 131], ceilScale: 0.5 },
  3:  { amb: 0.17, fog: [104, 106, 110], ceilScale: 0.5 },
  4:  { amb: 0.10, fog: [70, 78, 84],    ceilScale: 0.5 },
  5:  { amb: 0.29, fog: [135, 214, 222], ceilScale: 0.5 },
  6:  { amb: 0.12, fog: [95, 95, 88],    ceilScale: 0.5 },
  7:  { amb: 0.19, fog: [116, 114, 104], ceilScale: 0.5 },
  8:  { amb: 0.15, fog: [120, 35, 35],   ceilScale: 0.5 },
  9:  { amb: 0.23, fog: [168, 152, 116], ceilScale: 0.5 },
  10: { amb: 0.07, fog: [58, 74, 60],    ceilScale: 0.5 }
};

const cardHome = [
  { x: 26.5, y: 3.5 },
  { x: 10.5, y: 25.5 },
  { x: 25.5, y: 17.5 },
  { x: 41.5, y: 9.5 },
  { x: 51.5, y: 5.5 },
  { x: 34.5, y: 24.5 },
  { x: 12.5, y: 38.5 }
];

/* type indexes the art in drawMonster (0-11). Several creatures share a
   silhouette but behave differently, which is cheaper than 18 new sprites. */
const monsterHome = [
  { x: 8.5,  y: 7.5,  a: 2.4, type: 0,  name: "Tall Grinner",    speed: 1.02, range: 7.6 },
  { x: 11.5, y: 8.5,  a: 1.1, type: 1,  name: "Crawling Smile",  speed: 1.25, range: 5.8 },
  { x: 22.5, y: 8.5,  a: 0.3, type: 2,  name: "Hollow Eyes",     speed: 0.88, range: 9.2 },
  { x: 27.5, y: 4.5,  a: 3.8, type: 3,  name: "Red Mouth",       speed: 1.12, range: 7.0 },
  { x: 36.5, y: 4.5,  a: 5.9, type: 5,  name: "Concrete Hound",  speed: 1.34, range: 8.4 },
  { x: 41.5, y: 8.5,  a: 2.9, type: 8,  name: "Pillar Shade",    speed: 0.96, range: 7.8 },
  { x: 49.5, y: 4.5,  a: 1.7, type: 9,  name: "Live Wire",       speed: 1.30, range: 6.4 },
  { x: 52.5, y: 10.5, a: 4.2, type: 10, name: "Static Man",      speed: 0.90, range: 9.6 },
  { x: 4.5,  y: 21.5, a: 5.4, type: 4,  name: "Pool Lurker",     speed: 0.82, range: 8.2 },
  { x: 10.5, y: 16.5, a: 2.2, type: 5,  name: "Long Arms",       speed: 1.00, range: 7.4 },
  { x: 7.5,  y: 25.0, a: 4.7, type: 6,  name: "Pale Watcher",    speed: 0.74, range: 10.0 },
  { x: 23.5, y: 24.5, a: 3.1, type: 7,  name: "Pipe Stalker",    speed: 1.18, range: 6.6 },
  { x: 18.0, y: 16.5, a: 0.8, type: 8,  name: "Split Face",      speed: 1.08, range: 7.2 },
  { x: 34.5, y: 16.5, a: 0.6, type: 2,  name: "Hub Warden",      speed: 0.92, range: 10.4 },
  { x: 41.5, y: 25.5, a: 3.4, type: 7,  name: "Forklift Thing",  speed: 1.22, range: 7.0 },
  { x: 51.5, y: 19.5, a: 1.9, type: 9,  name: "Red Shadow",      speed: 1.28, range: 6.2 },
  { x: 48.5, y: 25.5, a: 4.4, type: 3,  name: "No-Eyes",         speed: 0.94, range: 8.8 },
  { x: 12.5, y: 33.5, a: 0.4, type: 1,  name: "Carpet Crawler",  speed: 1.26, range: 6.0 },
  { x: 22.5, y: 39.5, a: 2.7, type: 6,  name: "Hall Watcher",    speed: 0.78, range: 10.2 },
  { x: 36.5, y: 34.5, a: 5.1, type: 0,  name: "Sign Walker",     speed: 1.06, range: 8.0 },
  { x: 48.5, y: 36.5, a: 3.6, type: 11, name: "Exit Mimic",      speed: 1.16, range: 7.8 }
];

const exitPoint = { x: 52.5, y: 39.5 };

/* Every one of these lies. Only exitPoint is real. */
const decoySigns = [
  { x: 31.5, y: 32.5 }, { x: 31.5, y: 38.5 }, { x: 36.5, y: 31.5 },
  { x: 36.5, y: 35.5 }, { x: 36.5, y: 40.5 }, { x: 38.5, y: 33.5 },
  { x: 42.5, y: 31.5 }, { x: 42.5, y: 36.5 }, { x: 42.5, y: 40.5 },
  { x: 44.5, y: 34.5 }, { x: 48.5, y: 32.5 }, { x: 48.5, y: 38.5 },
  { x: 53.5, y: 31.5 }, { x: 53.5, y: 35.5 }
];

let grid;
let roomGrid;
let player;
let cards;
let monsters;
let collected = 0;
let lives = 3;
let won = false;
let gameOver = false;
let paused = false;
let currentRoom = 1;
let lastTime = performance.now();
let damagePulse = 0;
let hintTimer = 0;

/* flashlight */
let spawnGrace = 0;
let lastStepPhase = 0;

let flashOn = true;
let battery = 1;
let flashPower = 1;
let batteryWarned = false;

/* run state */
let started = false;

/* look state lives with the input layer below */

/* ---------------------------------------------------------------
   Texture engine
   Every surface is a 64x64 canvas painted once at boot. Walls are
   sampled with drawImage; floors and ceilings are sampled per pixel
   out of a Uint32Array, so each texture keeps both forms.
   --------------------------------------------------------------- */

const TEX = 64;
const TEXMASK = TEX - 1;

function makeTex(paint) {
  const c = document.createElement("canvas");
  c.width = TEX;
  c.height = TEX;

  const g = c.getContext("2d", { willReadFrequently: true });
  g.imageSmoothingEnabled = false;
  paint(g);

  const data = new Uint32Array(
    g.getImageData(0, 0, TEX, TEX).data.buffer.slice(0)
  );

  return { canvas: c, data };
}

function fill(g, color) {
  g.fillStyle = color;
  g.fillRect(0, 0, TEX, TEX);
}

function speckle(g, count, color, alpha, size) {
  for (let i = 0; i < count; i++) {
    g.fillStyle = color;
    g.globalAlpha = Math.random() * alpha;
    g.fillRect(
      Math.random() * TEX,
      Math.random() * TEX,
      1 + Math.random() * size,
      1 + Math.random() * size
    );
  }
  g.globalAlpha = 1;
}

function stains(g, count, color, maxR) {
  for (let i = 0; i < count; i++) {
    const x = Math.random() * TEX;
    const y = Math.random() * TEX;
    const r = 3 + Math.random() * maxR;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, color);
    grd.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

function tileGrid(g, step, grout, groutW) {
  g.fillStyle = grout;
  for (let i = 0; i <= TEX; i += step) {
    g.fillRect(i, 0, groutW, TEX);
    g.fillRect(0, i, TEX, groutW);
  }
}

/* ---- wall painters ---- */

const wallPaint = {
  /* chevron wood panelling, straight off the cover art */
  1: (g) => {
    fill(g, "#a89a55");

    for (let x = 0; x < TEX; x += 8) {
      g.fillStyle = "rgba(255,244,180,.06)";
      g.fillRect(x, 0, 4, TEX);
      g.fillStyle = "rgba(52,44,18,.42)";
      g.fillRect(x + 7, 0, 1, TEX);
    }

    /* the V grain that reads as panelling at distance */
    g.strokeStyle = "rgba(70,58,22,.30)";
    g.lineWidth = 1;

    for (let x = 0; x < TEX; x += 8) {
      for (let y = -8; y < TEX; y += 9) {
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + 4, y + 5);
        g.lineTo(x + 8, y);
        g.stroke();
      }
    }

    stains(g, 7, "rgba(92,74,30,.34)", 13);
    speckle(g, 220, "#6f6234", 0.26, 2);

    g.fillStyle = "rgba(40,34,14,.58)";
    g.fillRect(0, TEX - 6, TEX, 6);
    g.fillStyle = "rgba(255,248,200,.10)";
    g.fillRect(0, TEX - 7, TEX, 1);
  },
  /* office drywall with seams */
  2: (g) => {
    fill(g, "#6b6e67");
    stains(g, 5, "rgba(30,32,28,.30)", 12);
    speckle(g, 220, "#4e514b", 0.28, 2);
    g.fillStyle = "rgba(28,30,26,.45)";
    g.fillRect(0, 30, TEX, 1);
    g.fillRect(31, 0, 1, TEX);
    g.fillStyle = "rgba(20,22,18,.50)";
    g.fillRect(0, TEX - 5, TEX, 5);
  },
  /* garage concrete + painted stripe */
  3: (g) => {
    fill(g, "#5d6064");
    speckle(g, 420, "#43464a", 0.40, 3);
    stains(g, 6, "rgba(22,24,26,.34)", 14);
    g.fillStyle = "rgba(196,168,60,.42)";
    g.fillRect(0, 40, TEX, 5);
    g.fillStyle = "rgba(16,17,19,.55)";
    g.fillRect(0, TEX - 7, TEX, 7);
  },
  /* electrical bay: riveted metal panels */
  4: (g) => {
    fill(g, "#3d444a");
    g.fillStyle = "rgba(18,21,24,.60)";
    g.fillRect(0, 0, TEX, 2);
    g.fillRect(0, 32, TEX, 2);
    g.fillRect(0, 0, 2, TEX);
    g.fillRect(32, 0, 2, TEX);
    g.fillStyle = "rgba(150,162,172,.28)";
    for (let y = 8; y < TEX; y += 16) {
      for (let x = 8; x < TEX; x += 16) g.fillRect(x, y, 2, 2);
    }
    speckle(g, 180, "#2a2f34", 0.35, 2);
    stains(g, 4, "rgba(120,70,20,.26)", 10);
  },
  /* poolroom tile */
  5: (g) => {
    fill(g, "#7fc3cf");
    tileGrid(g, 16, "rgba(226,250,252,.55)", 2);
    for (let y = 0; y < TEX; y += 16) {
      for (let x = 0; x < TEX; x += 16) {
        g.fillStyle = `rgba(255,255,255,${0.04 + Math.random() * 0.09})`;
        g.fillRect(x + 2, y + 2, 12, 12);
      }
    }
    stains(g, 4, "rgba(30,90,105,.24)", 11);
  },
  /* pipe tunnel: rusted plate */
  6: (g) => {
    fill(g, "#4a463e");
    speckle(g, 380, "#33302a", 0.42, 3);
    stains(g, 8, "rgba(126,66,24,.32)", 12);
    g.fillStyle = "rgba(18,17,14,.55)";
    g.fillRect(0, 21, TEX, 2);
    g.fillRect(0, 43, TEX, 2);
  },
  /* hub warehouse block wall */
  7: (g) => {
    fill(g, "#6a675d");
    g.fillStyle = "rgba(30,29,25,.42)";
    for (let y = 0; y < TEX; y += 11) {
      g.fillRect(0, y, TEX, 1);
      const off = (y / 11) % 2 ? 0 : 16;
      for (let x = off; x < TEX; x += 32) g.fillRect(x, y, 1, 11);
    }
    speckle(g, 200, "#54514a", 0.30, 2);
    stains(g, 4, "rgba(24,22,18,.26)", 12);
  },
  /* red rooms */
  8: (g) => {
    fill(g, "#5a1a1a");
    for (let x = 0; x < TEX; x += 6) {
      g.fillStyle = "rgba(140,40,40,.10)";
      g.fillRect(x, 0, 3, TEX);
    }
    stains(g, 8, "rgba(24,4,4,.42)", 14);
    speckle(g, 200, "#3a0f0f", 0.35, 2);
    g.fillStyle = "rgba(14,3,3,.60)";
    g.fillRect(0, TEX - 6, TEX, 6);
  },
  /* carpet halls: beige panelling */
  9: (g) => {
    fill(g, "#a3925f");
    g.fillStyle = "rgba(70,60,34,.30)";
    for (let x = 0; x < TEX; x += 16) g.fillRect(x, 0, 1, TEX);
    g.fillStyle = "rgba(255,246,208,.09)";
    for (let x = 4; x < TEX; x += 16) g.fillRect(x, 0, 6, TEX);
    stains(g, 6, "rgba(76,60,28,.28)", 12);
    g.fillStyle = "rgba(52,42,20,.55)";
    g.fillRect(0, TEX - 6, TEX, 6);
  },
  /* exit-sign level: near-black painted block */
  10: (g) => {
    fill(g, "#20281f");
    speckle(g, 300, "#141a13", 0.45, 3);
    g.fillStyle = "rgba(8,12,8,.50)";
    for (let y = 0; y < TEX; y += 13) g.fillRect(0, y, TEX, 1);
    stains(g, 4, "rgba(60,120,70,.12)", 12);
  }
};

/* ---- floor painters ---- */

const floorPaint = {
  1: (g) => {
    fill(g, "#4a4430");
    speckle(g, 900, "#3a351f", 0.5, 3);
    speckle(g, 300, "#5e5740", 0.4, 2);
  },
  2: (g) => {
    fill(g, "#33352f");
    speckle(g, 800, "#282a25", 0.5, 3);
    g.fillStyle = "rgba(20,22,18,.40)";
    g.fillRect(0, 0, TEX, 1);
    g.fillRect(0, 0, 1, TEX);
  },
  3: (g) => {
    fill(g, "#3c3f42");
    speckle(g, 700, "#2c2f31", 0.5, 4);
    stains(g, 6, "rgba(10,10,12,.45)", 14);
    g.fillStyle = "rgba(190,166,64,.30)";
    g.fillRect(30, 0, 4, TEX);
  },
  4: (g) => {
    fill(g, "#26292c");
    g.fillStyle = "rgba(120,130,138,.20)";
    for (let x = 0; x < TEX; x += 8) g.fillRect(x, 0, 3, TEX);
    g.fillStyle = "rgba(10,11,12,.55)";
    for (let y = 0; y < TEX; y += 16) g.fillRect(0, y, TEX, 2);
  },
  5: (g) => {
    fill(g, "#2a7d92");
    tileGrid(g, 16, "rgba(210,246,250,.42)", 2);
    stains(g, 5, "rgba(12,50,64,.34)", 13);
    speckle(g, 200, "#3d97ad", 0.3, 2);
  },
  6: (g) => {
    fill(g, "#232320");
    speckle(g, 700, "#171715", 0.5, 3);
    stains(g, 7, "rgba(90,50,18,.24)", 12);
  },
  7: (g) => {
    fill(g, "#43413a");
    speckle(g, 600, "#333129", 0.45, 4);
    g.fillStyle = "rgba(180,150,50,.22)";
    g.fillRect(0, 28, TEX, 3);
  },
  8: (g) => {
    fill(g, "#2a0a0a");
    speckle(g, 800, "#1b0505", 0.5, 3);
    speckle(g, 200, "#3d1010", 0.4, 2);
  },
  9: (g) => {
    fill(g, "#5b4c2c");
    speckle(g, 900, "#463a20", 0.5, 3);
    g.fillStyle = "rgba(120,102,58,.18)";
    for (let y = 0; y < TEX; y += 8) {
      for (let x = (y / 8) % 2 ? 0 : 4; x < TEX; x += 8) g.fillRect(x, y, 4, 4);
    }
  },
  10: (g) => {
    fill(g, "#0c100c");
    speckle(g, 500, "#060906", 0.5, 3);
    speckle(g, 90, "#1d2a1e", 0.35, 2);
  }
};

/* ---- ceiling painters. Light panels are baked in so they recede
        with perspective instead of floating on the screen. ---- */

function ceilingTiles(g, base, grout, panel, glow) {
  fill(g, base);
  tileGrid(g, 32, grout, 2);
  speckle(g, 220, grout, 0.22, 3);
  if (panel) {
    g.fillStyle = panel;
    g.fillRect(6, 6, 20, 20);
    if (glow) {
      const grd = g.createRadialGradient(16, 16, 1, 16, 16, 18);
      grd.addColorStop(0, glow);
      grd.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grd;
      g.fillRect(0, 0, 34, 34);
    }
  }
}

const ceilPaint = {
  1:  (g) => ceilingTiles(g, "#8e854f", "rgba(56,50,26,.55)", "#efe9c4", "rgba(255,250,215,.42)"),
  2:  (g) => ceilingTiles(g, "#63665f", "rgba(32,34,30,.55)", "#dfe3dd", "rgba(238,244,236,.36)"),
  3:  (g) => ceilingTiles(g, "#3a3d40", "rgba(18,20,22,.60)", "#cfd8dd", "rgba(190,206,214,.45)"),
  4:  (g) => ceilingTiles(g, "#23272b", "rgba(10,12,14,.60)", "#7fd4e6", "rgba(110,200,220,.40)"),
  5:  (g) => ceilingTiles(g, "#a9dbe2", "rgba(70,130,140,.40)", "#eaf6f8", "rgba(255,255,255,.38)"),
  6:  (g) => {
    fill(g, "#2c2c28");
    g.fillStyle = "rgba(70,66,56,.55)";
    for (let x = 4; x < TEX; x += 18) g.fillRect(x, 0, 7, TEX);
    speckle(g, 200, "#191916", 0.4, 3);
  },
  7:  (g) => ceilingTiles(g, "#35342e", "rgba(16,16,13,.60)", "#e8e2c8", "rgba(226,216,176,.50)"),
  8:  (g) => ceilingTiles(g, "#2b0d0d", "rgba(12,3,3,.60)", "#ff8f8f", "rgba(255,90,90,.42)"),
  9:  (g) => ceilingTiles(g, "#7d7048", "rgba(48,42,22,.55)", "#e9dfb6", "rgba(255,246,208,.34)"),
  10: (g) => ceilingTiles(g, "#0d110d", "rgba(4,6,4,.60)", "#3fbf68", "rgba(70,230,120,.30)")
};

const wallTex = {};
const floorTex = {};
const ceilTex = {};

function buildTextures() {
  for (const room of rooms) {
    wallTex[room.id] = makeTex(wallPaint[room.id]);
    floorTex[room.id] = makeTex(floorPaint[room.id]);
    ceilTex[room.id] = makeTex(ceilPaint[room.id]);
  }
}

/* film grain tiles, cycled per frame */
const GRAIN_TILE = 128;
const grainTiles = [];

function buildGrain() {
  for (let n = 0; n < 4; n++) {
    const c = document.createElement("canvas");
    c.width = GRAIN_TILE;
    c.height = GRAIN_TILE;

    const g = c.getContext("2d");
    const img = g.createImageData(GRAIN_TILE, GRAIN_TILE);
    const d = img.data;

    for (let i = 0; i < d.length; i += 4) {
      const v = 118 + (Math.random() * 74 - 37);
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }

    g.putImageData(img, 0, 0);
    grainTiles.push(c);
  }
}

/* ---------------------------------------------------------------
   Map
   --------------------------------------------------------------- */

function buildMap() {
  grid = Array.from({ length: GRID_H }, () => Array(GRID_W).fill(1));
  roomGrid = Array.from({ length: GRID_H }, () => Array(GRID_W).fill(0));

  const carve = (x1, y1, x2, y2, id) => {
    for (let y = y1; y <= y2; y++) {
      for (let x = x1; x <= x2; x++) {
        if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H) continue;
        grid[y][x] = 0;
        roomGrid[y][x] = id;
      }
    }
  };

  rooms.forEach((room) => carve(room.x1, room.y1, room.x2, room.y2, room.id));

  /* connecting corridors, each tagged with the room it reads as */
  carve(13, 5, 16, 6, 1);
  carve(29, 5, 32, 6, 2);
  carve(43, 6, 46, 7, 3);
  carve(5, 10, 6, 14, 1);
  carve(21, 11, 22, 14, 2);
  carve(36, 11, 37, 14, 3);
  carve(49, 12, 50, 15, 4);
  carve(13, 20, 16, 21, 5);
  carve(28, 20, 31, 21, 6);
  carve(43, 20, 46, 21, 7);
  carve(6, 26, 7, 30, 5);
  carve(21, 26, 22, 30, 6);
  carve(37, 27, 38, 31, 7);
  carve(49, 27, 50, 31, 8);
  carve(26, 35, 29, 36, 9);

  const wallV = (x, y1, y2, gaps = []) => {
    for (let y = y1; y <= y2; y++) if (!gaps.includes(y)) grid[y][x] = 1;
  };

  const wallH = (y, x1, x2, gaps = []) => {
    for (let x = x1; x <= x2; x++) if (!gaps.includes(x)) grid[y][x] = 1;
  };

  /* 1 - Yellow Lobby */
  wallV(5, 2, 8, [4, 7]);
  wallH(4, 2, 11, [4, 9]);
  wallV(10, 6, 9, [8]);

  /* 2 - Office Maze */
  wallV(19, 2, 9, [3, 7]);
  wallV(24, 2, 9, [5]);
  wallH(7, 17, 27, [20, 25]);
  wallV(27, 8, 11, [10]);

  /* 3 - Parking Garage: pillar field */
  for (let py = 3; py <= 9; py += 3) {
    for (let px = 34; px <= 42; px += 3) grid[py][px] = 1;
  }
  wallH(8, 32, 39, [35, 38]);

  /* 4 - Electrical Station */
  wallV(50, 2, 6, [4]);
  wallH(9, 47, 53, [48, 52]);
  wallV(52, 3, 8, [5, 7]);

  /* 5 - Poolrooms */
  wallV(6, 15, 24, [17, 22]);
  wallH(19, 2, 11, [4, 9]);
  wallH(24, 2, 11, [6]);

  /* 6 - Pipe Tunnels */
  wallV(20, 15, 25, [18, 23]);
  wallH(18, 17, 26, [19, 24]);
  wallH(23, 17, 26, [21]);

  /* 7 - The Hub: sparse crates so it stays open */
  wallH(18, 33, 41, [35, 39]);
  wallH(23, 33, 41, [36, 40]);
  wallV(38, 24, 26, []);

  /* 8 - Red Rooms */
  wallV(49, 17, 25, [19, 23]);
  wallV(52, 17, 25, [18, 22, 24]);

  /* 9 - Carpet Halls */
  wallV(8, 31, 39, [33, 37]);
  wallV(15, 32, 40, [34, 38]);
  wallV(21, 31, 39, [33, 36]);
  wallH(36, 2, 7, [4]);

  /* 10 - Endless Exit Signs */
  wallV(34, 31, 39, [33, 37]);
  wallV(40, 32, 40, [35, 38]);
  wallV(46, 31, 39, [34, 37]);
  wallV(51, 32, 40, [36]);
}

function cellAt(x, y) {
  const X = x | 0;
  const Y = y | 0;

  if (X < 0 || X >= GRID_W || Y < 0 || Y >= GRID_H) return 1;

  return grid[Y][X];
}

function blocked(x, y) {
  return cellAt(x, y) === 1;
}

function roomAt(x, y) {
  const X = x | 0;
  const Y = y | 0;

  if (X < 0 || X >= GRID_W || Y < 0 || Y >= GRID_H) return currentRoom || 1;

  return roomGrid[Y][X] || currentRoom || 1;
}

function moveEntity(entity, dx, dy) {
  const radius = 0.20;
  const nx = entity.x + dx;
  const ny = entity.y + dy;

  if (!blocked(nx + Math.sign(dx || 1) * radius, entity.y)) entity.x = nx;
  if (!blocked(entity.x, ny + Math.sign(dy || 1) * radius)) entity.y = ny;
}

function hasLineOfSight(monster) {
  const dx = player.x - monster.x;
  const dy = player.y - monster.y;
  const distance = Math.hypot(dx, dy);
  const steps = Math.ceil(distance / 0.14);

  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (blocked(monster.x + dx * t, monster.y + dy * t)) return false;
  }

  return true;
}

function setStatus(text, seconds = 0) {
  statusEl.textContent = text;
  hintTimer = seconds;
}

const roomMessages = {
  1: "The fluorescent hum feels wrong.",
  2: "The office maze hides movement behind the cubicles.",
  3: "Cold concrete. Something breathes between the pillars.",
  4: "Transformers tick. Your flashlight browns out near them.",
  5: "Cold blue water reflects lights that are not there.",
  6: "Metal knocks somewhere inside the walls.",
  7: "The ceiling is too far away to see.",
  8: "The red hallways feel warmer the deeper you go.",
  9: "The carpet pattern repeats. You have been here before.",
  10: "Every EXIT sign points somewhere different."
};

const roomHints = {
  1: "The fluorescent hum feels wrong.",
  2: "The office maze hides movement.",
  3: "Watch the gaps between pillars.",
  4: "The current makes your light stutter.",
  5: "The water echoes back at you.",
  6: "Metal groans inside the tunnels.",
  7: "Open ground. Nowhere to hide.",
  8: "The red hallways feel warmer.",
  9: "The pattern repeats. Keep moving.",
  10: "Every EXIT sign might be lying."
};

const SPAWN = { x: 2.5, y: 2.5 };
const SPAWN_SAFE = 7;
const GRACE_SECONDS = 3;

function spawnPlayer() {
  return { x: SPAWN.x, y: SPAWN.y, a: 0.35, bob: 0, pitch: 0 };
}

/* Send anything loitering near the spawn back where it came from, so a
   respawn cannot drop you straight back into the jaws of the thing that
   just got you. */
function clearSpawnArea() {
  monsters.forEach((monster, i) => {
    if (Math.hypot(monster.x - SPAWN.x, monster.y - SPAWN.y) < SPAWN_SAFE) {
      monster.x = monsterHome[i].x;
      monster.y = monsterHome[i].y;
      monster.aware = false;
      monster.dist = Infinity;
    }
  });
}

function resetGame() {
  buildMap();

  player = spawnPlayer();

  cards = cardHome.map((card) => ({ ...card, taken: false }));

  monsters = monsterHome.map((monster, index) => ({
    ...monster,
    id: index,
    pause: 0,
    aware: false,
    dist: Infinity,
    phase: Math.random() * Math.PI * 2
  }));

  collected = 0;
  lives = 3;
  won = false;
  gameOver = false;
  paused = false;
  currentRoom = 1;
  damagePulse = 0;
  hintTimer = 0;

  flashOn = true;
  battery = 1;
  flashPower = 1;
  batteryWarned = false;
  spawnGrace = GRACE_SECONDS;
  lastStepPhase = 0;

  clearSpawnArea();

  roomStat.textContent = "1";
  cardStat.textContent = `0/${TOTAL_CARDS}`;
  lifeStat.textContent = "3";
  pauseBtn.textContent = "Pause";

  setStatus(
    `Find all ${TOTAL_CARDS} access cards, survive the creatures, and find the true exit.`
  );

  canvas.focus();
}

function catchPlayer(monster) {
  if (won || gameOver) return;

  lives--;
  lifeStat.textContent = String(lives);
  damagePulse = 1;

  Sfx.play("catch");

  if (lives <= 0) {
    gameOver = true;
    Sfx.play("gameOver");
    setStatus(`${monster.name} caught you.`);
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    return;
  }

  player = spawnPlayer();
  currentRoom = 1;
  roomStat.textContent = "1";
  battery = Math.min(1, battery + 0.35);
  spawnGrace = GRACE_SECONDS;

  clearSpawnArea();

  setStatus(
    `${monster.name} caught you - no jump scare. Back to the Yellow Lobby, ` +
      `${GRACE_SECONDS}s to move.`,
    3
  );
}

function nearestMonster() {
  let nearest = Infinity;

  for (const monster of monsters) {
    nearest = Math.min(
      nearest,
      Math.hypot(player.x - monster.x, player.y - monster.y)
    );
  }

  return nearest;
}

/* distance to the closest creature that has actually noticed you.
   Proximity alone is meaningless with 21 of them on the map. */
function nearestHunter() {
  let nearest = Infinity;

  for (const monster of monsters) {
    if (monster.aware) nearest = Math.min(nearest, monster.dist);
  }

  return nearest;
}

function updateMonsters(dt) {
  if (spawnGrace > 0) spawnGrace -= dt;

  const safe = spawnGrace > 0;

  for (const monster of monsters) {
    if (monster.pause > 0) {
      monster.pause -= dt;
      continue;
    }

    const dx = player.x - monster.x;
    const dy = player.y - monster.y;
    const distance = Math.hypot(dx, dy);

    const sameRoom = roomAt(monster.x, monster.y) === currentRoom;

    /* the flashlight gives you away: lit creatures notice you sooner */
    const litBonus = flashOn && flashPower > 0.2 ? 1.0 : 0;

    const chasing =
      !safe &&
      sameRoom &&
      distance < monster.range + litBonus &&
      hasLineOfSight(monster);

    monster.aware = chasing;
    monster.dist = distance;

    if (chasing) {
      monster.a = Math.atan2(dy, dx);

      if (monster.type === 1) monster.a += Math.sin(performance.now() / 120) * 0.08;
      if (monster.type === 4) monster.a += Math.sin(performance.now() / 220) * 0.04;
      if (monster.type === 6 && distance < 2.4) monster.a += Math.PI;
      if (monster.type === 11 && distance < 3.2) {
        monster.a += Math.sin(performance.now() / 90) * 0.12;
      }
    } else {
      monster.a +=
        Math.sin(performance.now() / 800 + monster.phase + monster.id * 1.2) * 0.0018;
    }

    let speed = chasing ? monster.speed : 0.42;

    if (monster.type === 9 && chasing) speed *= 1.05;
    if (monster.type === 2 && chasing && distance < 3.5) speed *= 0.78;

    const oldX = monster.x;
    const oldY = monster.y;

    moveEntity(
      monster,
      Math.cos(monster.a) * speed * dt,
      Math.sin(monster.a) * speed * dt
    );

    if (Math.hypot(monster.x - oldX, monster.y - oldY) < 0.003) {
      monster.a += 1.0 + Math.random() * 2.3;
      monster.pause = 0.08 + Math.random() * 0.16;
    }

    if (
      !safe &&
      Math.hypot(player.x - monster.x, player.y - monster.y) < 0.47
    ) {
      catchPlayer(monster);
    }
  }
}

function updateFlashlight(dt) {
  if (flashOn && battery > 0) {
    battery = Math.max(0, battery - dt * 0.0055);

    if (battery === 0) {
      flashOn = false;
      setStatus("The flashlight dies. Let it rest.", 3);
    } else if (battery < 0.2 && !batteryWarned) {
      batteryWarned = true;
      Sfx.play("batteryLow");
      setStatus("Battery low. Switch it off to let the cell recover [F].", 3);
    }
  } else if (!flashOn) {
    /* the cell recovers while it is off - the whole tension of the game */
    battery = Math.min(1, battery + dt * 0.0042);
    if (battery > 0.35) batteryWarned = false;
  }

  const t = performance.now();

  if (!flashOn || battery <= 0) {
    flashPower += (0 - flashPower) * Math.min(1, dt * 12);
    return;
  }

  let target = 1;

  /* the electrical station bullies your light */
  if (currentRoom === 4) target *= 0.62 + Math.sin(t / 70) * 0.22;

  if (battery < 0.25) {
    const stutter = Math.sin(t / 55) * Math.sin(t / 23);
    target *= 0.45 + (battery / 0.25) * 0.4 + stutter * 0.22;
  }

  flashPower += (Math.max(0, target) - flashPower) * Math.min(1, dt * 9);
}

function update(dt) {
  if (!started || paused || won || gameOver) return;

  /* FUTURE NINTENDO SWITCH PORT PREPARATION:
     every value below comes from the abstract input layer, so a native
     pad, a browser gamepad, a keyboard and a touchscreen all drive the
     same code path. Nothing here knows what a key is. */
  const pad = Input.player(0);

  const running = pad.run;
  const speed = (running ? 3.05 : 2.05) * dt;

  /* camera: stick rate, plus any drained pointer / touch delta */
  player.a += pad.lookX * Input.TURN_RATE * dt;

  const look = Input.consumeLook(pad);
  player.a += look.x;

  const pitchLimit = canvas.height * 0.26;

  player.pitch = Math.max(
    -pitchLimit,
    Math.min(
      pitchLimit,
      player.pitch -
        look.y * canvas.height * 0.6 -
        pad.lookY * Input.PITCH_RATE * Display.ui * dt
    )
  );

  const dx = Math.cos(player.a);
  const dy = Math.sin(player.a);

  /* normalise so diagonals are not faster than straight lines */
  let mx = pad.moveX;
  let my = pad.moveY;

  const mag = Math.hypot(mx, my);

  if (mag > 1) {
    mx /= mag;
    my /= mag;
  }

  const moving = mag > 0.001;

  if (my) moveEntity(player, dx * my * speed, dy * my * speed);
  if (mx) moveEntity(player, -dy * mx * speed, dx * mx * speed);

  if (moving) {
    player.bob += dt * (running ? 12 : 8);

    /* one footfall per half bob cycle, so steps match the camera */
    const phase = Math.floor(player.bob / Math.PI);

    if (phase !== lastStepPhase) {
      lastStepPhase = phase;
      Sfx.play("footstep", {
        surface: Sfx.surfaceFor(currentRoom),
        running
      });
    }
  } else {
    player.bob *= 0.92;
    lastStepPhase = Math.floor(player.bob / Math.PI);
  }

  const newRoom = roomAt(player.x, player.y);

  if (newRoom !== currentRoom) {
    currentRoom = newRoom;
    roomStat.textContent = String(newRoom);
    setStatus(roomMessages[newRoom], 3);
  }

  for (const card of cards) {
    if (!card.taken && Math.hypot(player.x - card.x, player.y - card.y) < 0.55) {
      card.taken = true;
      collected++;

      cardStat.textContent = `${collected}/${TOTAL_CARDS}`;

      if (collected === TOTAL_CARDS) {
        Sfx.play("allCards");
        setStatus(
          `All ${TOTAL_CARDS} cards found. Find the TRUE EXIT in the endless exit-sign room.`,
          4
        );
      } else {
        Sfx.play("card");
        setStatus(
          `Access card found. ${TOTAL_CARDS - collected} remain.`,
          2.5
        );
      }
    }
  }

  updateMonsters(dt);
  updateFlashlight(dt);

  if (Math.hypot(player.x - exitPoint.x, player.y - exitPoint.y) < 0.75) {
    if (collected === TOTAL_CARDS) {
      won = true;
      Sfx.play("win");
      setStatus("You escaped Ultra Elliot.");
      if (document.pointerLockElement === canvas) document.exitPointerLock();
    } else {
      Sfx.play("falseExit");
      setStatus(
        `FALSE EXIT - ${TOTAL_CARDS - collected} access card(s) still missing.`,
        2.5
      );
    }
  }

  if (hintTimer > 0) {
    hintTimer -= dt;

    if (hintTimer <= 0 && !won && !gameOver) {
      setStatus(
        `Find all ${TOTAL_CARDS} access cards and locate the true exit.`
      );
    }
  }

  damagePulse = Math.max(0, damagePulse - dt * 1.7);
}

/* ---------------------------------------------------------------
   Raycasting: DDA. Returns euclidean distance (unit ray direction),
   which wall face was hit, and where along that face - the texture
   coordinate the wall renderer needs.
   --------------------------------------------------------------- */

function castRay(angle) {
  const rdx = Math.cos(angle);
  const rdy = Math.sin(angle);

  let mapX = player.x | 0;
  let mapY = player.y | 0;

  const deltaX = rdx === 0 ? 1e30 : Math.abs(1 / rdx);
  const deltaY = rdy === 0 ? 1e30 : Math.abs(1 / rdy);

  let stepX;
  let stepY;
  let sideDistX;
  let sideDistY;

  if (rdx < 0) {
    stepX = -1;
    sideDistX = (player.x - mapX) * deltaX;
  } else {
    stepX = 1;
    sideDistX = (mapX + 1 - player.x) * deltaX;
  }

  if (rdy < 0) {
    stepY = -1;
    sideDistY = (player.y - mapY) * deltaY;
  } else {
    stepY = 1;
    sideDistY = (mapY + 1 - player.y) * deltaY;
  }

  let side = 0;
  let distance = 0;

  for (let guard = 0; guard < 256; guard++) {
    if (sideDistX < sideDistY) {
      distance = sideDistX;
      sideDistX += deltaX;
      mapX += stepX;
      side = 0;
    } else {
      distance = sideDistY;
      sideDistY += deltaY;
      mapY += stepY;
      side = 1;
    }

    if (mapX < 0 || mapX >= GRID_W || mapY < 0 || mapY >= GRID_H) {
      return { d: 40, x: player.x, y: player.y, room: currentRoom, side, u: 0 };
    }

    if (grid[mapY][mapX] === 1) {
      const hx = player.x + rdx * distance;
      const hy = player.y + rdy * distance;
      const u = side === 0 ? hy - Math.floor(hy) : hx - Math.floor(hx);

      return {
        d: distance,
        x: hx,
        y: hy,
        room: roomGrid[mapY][mapX] || roomAt(hx, hy),
        side,
        u: side === 0 ? (stepX > 0 ? u : 1 - u) : stepY > 0 ? 1 - u : u
      };
    }
  }

  return { d: 40, x: player.x, y: player.y, room: currentRoom, side: 0, u: 0 };
}

/* how strongly the flashlight beam hits a point at this screen angle */
function beamAt(relAngle, distance) {
  if (flashPower <= 0.001) return 0;

  const cone = 1 - Math.abs(relAngle) / (FOV * 0.40);

  if (cone <= 0) return 0;

  const falloff = 1 / (1 + distance * distance * 0.040);

  return cone * cone * falloff * flashPower;
}

function drawMonster(x, y, size, distance, monster, light = 1) {
  ctx.save();
  /* light is how much of the torch/ambient actually reaches it */
  ctx.globalAlpha =
    Math.max(0.04, (1 - distance / 22)) * Math.max(0.05, Math.min(1, light));

  const bodyWidths = [
    0.30, 0.38, 0.26, 0.31, 0.30, 0.34,
    0.24, 0.34, 0.30, 0.28, 0.26, 0.32
  ];

  const bodyHeights = [
    0.58, 0.25, 0.62, 0.46, 0.50, 0.56,
    0.68, 0.60, 0.52, 0.65, 0.48, 0.57
  ];

  const headYs = [
    -0.28, -0.14, -0.31, -0.24, -0.22, -0.27,
    -0.34, -0.30, -0.26, -0.33, -0.22, -0.27
  ];

  const bodyWidth = bodyWidths[monster.type];
  const bodyHeight = bodyHeights[monster.type];
  const headY = headYs[monster.type];

  const gradient = ctx.createLinearGradient(
    x,
    y - size * 0.65,
    x,
    y + size * 0.65
  );

  if (monster.type === 3 || monster.type === 9) {
    gradient.addColorStop(0, "#2c0707");
    gradient.addColorStop(0.55, "#100202");
    gradient.addColorStop(1, "#020101");
  } else if (monster.type === 4) {
    gradient.addColorStop(0, "#122629");
    gradient.addColorStop(0.55, "#071011");
    gradient.addColorStop(1, "#020303");
  } else if (monster.type === 6) {
    gradient.addColorStop(0, "#4b4a44");
    gradient.addColorStop(0.55, "#1b1b18");
    gradient.addColorStop(1, "#050505");
  } else {
    gradient.addColorStop(0, "#151515");
    gradient.addColorStop(0.55, "#070707");
    gradient.addColorStop(1, "#020202");
  }

  ctx.fillStyle = gradient;

  ctx.beginPath();
  ctx.ellipse(
    x,
    y + size * 0.04,
    size * bodyWidth,
    size * bodyHeight,
    0,
    0,
    Math.PI * 2
  );
  ctx.fill();

  if (monster.type === 1) {
    ctx.beginPath();
    ctx.ellipse(
      x,
      y + size * 0.08,
      size * 0.42,
      size * 0.16,
      0,
      0,
      Math.PI * 2
    );
    ctx.fill();

    ctx.strokeStyle = "#111";
    ctx.lineWidth = Math.max(2, size * 0.02);

    for (const side of [-1, 1]) {
      for (let n = 0; n < 3; n++) {
        ctx.beginPath();
        ctx.moveTo(
          x + side * size * 0.22,
          y + size * (0.03 + n * 0.07)
        );
        ctx.lineTo(
          x + side * size * (0.46 + n * 0.025),
          y + size * (0.10 + n * 0.05)
        );
        ctx.stroke();
      }
    }
  } else {
    ctx.beginPath();
    ctx.ellipse(
      x,
      y + size * headY,
      size * 0.24,
      size * 0.22,
      0,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }

  if (monster.type === 5) {
    ctx.strokeStyle = "rgba(220,220,205,.20)";
    ctx.lineWidth = Math.max(2, size * 0.024);

    ctx.beginPath();
    ctx.moveTo(x - size * 0.25, y - size * 0.05);
    ctx.lineTo(x - size * 0.47, y + size * 0.28);
    ctx.moveTo(x + size * 0.25, y - size * 0.05);
    ctx.lineTo(x + size * 0.47, y + size * 0.28);
    ctx.stroke();
  }

  let eyeColor = "#ece8cc";

  if (monster.type === 3 || monster.type === 9) {
    eyeColor = "#ffb1b1";
  }

  if (monster.type === 4) {
    eyeColor = "#d6ffff";
  }

  if (monster.type === 6) {
    eyeColor = "#fff7df";
  }

  ctx.shadowBlur = 8;
  ctx.shadowColor = eyeColor;
  ctx.fillStyle = eyeColor;

  if (monster.type === 10) {
    // No-Eyes intentionally has no eyes.
  } else if (monster.type === 8) {
    ctx.fillRect(
      x - size * 0.16,
      y - size * 0.31,
      size * 0.10,
      size * 0.03
    );

    ctx.fillRect(
      x + size * 0.06,
      y - size * 0.29,
      size * 0.10,
      size * 0.03
    );
  } else if (monster.type === 1) {
    ctx.beginPath();
    ctx.arc(
      x - size * 0.12,
      y - size * 0.015,
      size * 0.03,
      0,
      Math.PI * 2
    );
    ctx.arc(
      x + size * 0.12,
      y - size * 0.015,
      size * 0.03,
      0,
      Math.PI * 2
    );
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.ellipse(
      x - size * 0.09,
      y - size * 0.30,
      size * 0.038,
      size * 0.055,
      0,
      0,
      Math.PI * 2
    );
    ctx.ellipse(
      x + size * 0.09,
      y - size * 0.30,
      size * 0.038,
      size * 0.055,
      0,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }

  ctx.shadowBlur = 0;

  ctx.fillStyle = "#050505";

  if (monster.type !== 10) {
    if (monster.type === 1) {
      ctx.beginPath();
      ctx.arc(
        x - size * 0.12,
        y - size * 0.012,
        size * 0.010,
        0,
        Math.PI * 2
      );
      ctx.arc(
        x + size * 0.12,
        y - size * 0.012,
        size * 0.010,
        0,
        Math.PI * 2
      );
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(
        x - size * 0.09,
        y - size * 0.295,
        size * 0.012,
        0,
        Math.PI * 2
      );
      ctx.arc(
        x + size * 0.09,
        y - size * 0.295,
        size * 0.012,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
  }

  ctx.fillStyle =
    monster.type === 3 || monster.type === 9
      ? "#ffd4d4"
      : "#ece8cd";

  ctx.beginPath();

  if (monster.type === 2) {
    ctx.moveTo(x - size * 0.12, y - size * 0.10);
    ctx.quadraticCurveTo(
      x,
      y + size * 0.02,
      x + size * 0.12,
      y - size * 0.10
    );
    ctx.quadraticCurveTo(
      x,
      y - size * 0.01,
      x - size * 0.12,
      y - size * 0.10
    );
  } else if (monster.type === 1) {
    ctx.moveTo(x - size * 0.22, y + size * 0.02);
    ctx.quadraticCurveTo(
      x,
      y + size * 0.17,
      x + size * 0.22,
      y + size * 0.02
    );
    ctx.quadraticCurveTo(
      x,
      y + size * 0.07,
      x - size * 0.22,
      y + size * 0.02
    );
  } else if (monster.type === 11) {
    ctx.moveTo(x - size * 0.22, y - size * 0.12);
    ctx.quadraticCurveTo(
      x,
      y + size * 0.20,
      x + size * 0.22,
      y - size * 0.12
    );
    ctx.quadraticCurveTo(
      x,
      y + size * 0.03,
      x - size * 0.22,
      y - size * 0.12
    );
  } else if (monster.type === 10) {
    ctx.moveTo(x - size * 0.15, y - size * 0.04);
    ctx.quadraticCurveTo(
      x,
      y + size * 0.12,
      x + size * 0.15,
      y - size * 0.04
    );
    ctx.quadraticCurveTo(
      x,
      y + size * 0.02,
      x - size * 0.15,
      y - size * 0.04
    );
  } else {
    ctx.moveTo(x - size * 0.20, y - size * 0.09);
    ctx.quadraticCurveTo(
      x,
      y + size * 0.16,
      x + size * 0.20,
      y - size * 0.09
    );
    ctx.quadraticCurveTo(
      x,
      y + size * 0.025,
      x - size * 0.20,
      y - size * 0.09
    );
  }

  ctx.fill();

  ctx.strokeStyle = "#070707";
  ctx.lineWidth = Math.max(1, size * 0.012);

  const teeth =
    monster.type === 2
      ? 3
      : monster.type === 11
        ? 9
        : 6;

  for (
    let j = -Math.floor(teeth / 2);
    j <= Math.floor(teeth / 2);
    j++
  ) {
    ctx.beginPath();
    ctx.moveTo(
      x + j * size * 0.04,
      y - size * 0.03
    );
    ctx.lineTo(
      x + j * size * 0.035,
      y + size * 0.08
    );
    ctx.stroke();
  }

  if (monster.type === 8) {
    ctx.strokeStyle = "rgba(245,235,215,.5)";
    ctx.lineWidth = Math.max(1, size * 0.015);
    ctx.beginPath();
    ctx.moveTo(
      x - size * 0.02,
      y - size * 0.47
    );
    ctx.lineTo(
      x + size * 0.02,
      y + size * 0.02
    );
    ctx.stroke();
  }

  if (monster.type === 11) {
    ctx.fillStyle = "rgba(25,130,55,.55)";
    ctx.fillRect(
      x - size * 0.13,
      y + size * 0.18,
      size * 0.26,
      size * 0.10
    );

    ctx.fillStyle = "#eaffee";
    ctx.font = `bold ${Math.max(7, size * 0.06)}px Arial`;
    ctx.textAlign = "center";
    ctx.fillText("EXIT", x, y + size * 0.255);
  }

  ctx.restore();
}

function drawCard(x, y, size, distance, light = 1) {
  ctx.save();
  ctx.globalAlpha =
    Math.max(0.10, (1 - distance / 22)) * Math.max(0.12, Math.min(1, light));

  const gradient = ctx.createLinearGradient(
    x - size * 0.4,
    y,
    x + size * 0.4,
    y
  );

  gradient.addColorStop(0, "#8e8643");
  gradient.addColorStop(0.5, "#f0e48a");
  gradient.addColorStop(1, "#756e33");

  ctx.fillStyle = gradient;
  ctx.fillRect(
    x - size * 0.42,
    y - size * 0.23,
    size * 0.84,
    size * 0.46
  );

  ctx.strokeStyle = "#28251a";
  ctx.lineWidth = Math.max(2, size * 0.025);
  ctx.strokeRect(
    x - size * 0.42,
    y - size * 0.23,
    size * 0.84,
    size * 0.46
  );

  ctx.fillStyle = "#28251a";
  ctx.font = `bold ${Math.max(9, size * 0.14)}px Arial`;
  ctx.textAlign = "center";
  ctx.fillText("ACCESS", x, y + 4);

  ctx.restore();
}

/* ---------------------------------------------------------------
   Floor and ceiling casting.
   Rendered at half resolution into an offscreen buffer, then
   upscaled with smoothing off. The chunky result suits the look
   and keeps the per-pixel loop cheap.
   --------------------------------------------------------------- */

/* Sized from the active display tier rather than hard-coded, so the
   renderer follows the dynamic resolution system. */
let FC_W = 640;
let FC_H = 360;
let WALL_COLUMNS = 480;

const fcCanvas = document.createElement("canvas");
const fcCtx = fcCanvas.getContext("2d");

let fcImage = null;
let fcBuf = null;

/* per-column constants, rebuilt each frame */
let colFX = null;
let colFY = null;
let colCone = null;
let colInvCos = null;

/* Called by Display whenever the render tier or the viewport changes. */
function onDisplayResize(width, height) {
  FC_W = Math.max(240, Math.round(width / 2));
  FC_H = Math.max(135, Math.round(height / 2));

  fcCanvas.width = FC_W;
  fcCanvas.height = FC_H;

  fcImage = fcCtx.createImageData(FC_W, FC_H);
  fcBuf = new Uint32Array(fcImage.data.buffer);

  colFX = new Float32Array(FC_W);
  colFY = new Float32Array(FC_W);
  colCone = new Float32Array(FC_W);
  colInvCos = new Float32Array(FC_W);

  /* one wall column per ~2.6 device pixels keeps cost flat across tiers */
  WALL_COLUMNS = Math.max(200, Math.round(width / 2.6));

  fxCanvas.width = width;
  fxCanvas.height = height;

  frameCached = false;
}

/* wall projection: wallHeight = PROJ / distance. The floor caster
   has to use the same constant or floors and walls will not meet. */
const PROJ_K = 1 / 0.76;

function renderFloorCeiling(horizon) {
  const dirX = Math.cos(player.a);
  const dirY = Math.sin(player.a);

  for (let x = 0; x < FC_W; x++) {
    const rel = (x / FC_W - 0.5) * FOV;
    const c = Math.cos(rel);

    colInvCos[x] = 1 / c;
    colFX[x] = Math.cos(player.a + rel) / c;
    colFY[x] = Math.sin(player.a + rel) / c;

    const cone = 1 - Math.abs(rel) / (FOV * 0.40);
    colCone[x] = cone > 0 ? cone * cone : 0;
  }

  const horizonFC = horizon * (FC_H / canvas.height);
  const posZ = FC_H * PROJ_K * 0.5;

  /* focal length in buffer pixels, for the beam's vertical spread */
  const focal = FC_W / (2 * Math.tan(FOV / 2));

  const px = player.x;
  const py = player.y;

  const fallbackFloor = floorTex[currentRoom];
  const fallbackCeil = ceilTex[currentRoom];
  const theme = themes[currentRoom];
  const ambBase = theme.amb;
  const cScale = theme.ceilScale;

  const fogR = theme.fog[0];
  const fogG = theme.fog[1];
  const fogB = theme.fog[2];

  for (let y = 0; y < FC_H; y++) {
    const isFloor = y > horizonFC;
    const p = isFloor ? y - horizonFC : horizonFC - y;

    if (p < 0.6) {
      const row = y * FC_W;
      for (let x = 0; x < FC_W; x++) fcBuf[row + x] = 0xff000000;
      continue;
    }

    const rowDistance = posZ / p;

    /* how far off the beam axis this row sits, vertically */
    const vCone = 1 - Math.atan(p / focal) / (FOV * 0.50);
    const vFactor = vCone > 0 ? vCone * vCone : 0;

    if (rowDistance > 34) {
      const row = y * FC_W;
      for (let x = 0; x < FC_W; x++) fcBuf[row + x] = 0xff000000;
      continue;
    }

    /* distance terms are constant across a row, so hoist them */
    const amb = ambBase * Math.max(0.16, 1 - rowDistance * 0.045);
    const beamFall =
      flashPower > 0.001
        ? (1 / (1 + rowDistance * rowDistance * 0.040)) *
          flashPower *
          vFactor *
          2.15
        : 0;

    const fog = Math.min(0.72, rowDistance / 26);
    const invFog = 1 - fog;
    const fR = fogR * fog * 0.5;
    const fG = fogG * fog * 0.5;
    const fB = fogB * fog * 0.5;

    const scale = isFloor ? 1 : cScale;
    const surface = isFloor ? 1 : 0.78;
    const row = y * FC_W;

    for (let bx = 0; bx < FC_W; bx += 16) {
      /* room is sampled per 16px block: cheap, and doorway seams
         land inside the block instead of on every pixel */
      const wx = px + colFX[bx] * rowDistance;
      const wy = py + colFY[bx] * rowDistance;

      const rid = roomAt(wx, wy);
      const tex = isFloor
        ? floorTex[rid] || fallbackFloor
        : ceilTex[rid] || fallbackCeil;
      const tdata = tex.data;

      const end = Math.min(bx + 16, FC_W);

      for (let x = bx; x < end; x++) {
        const fx = px + colFX[x] * rowDistance;
        const fy = py + colFY[x] * rowDistance;

        const tx = ((fx * scale * TEX) | 0) & TEXMASK;
        const ty = ((fy * scale * TEX) | 0) & TEXMASK;

        const texel = tdata[(ty << 6) + tx];

        const light = Math.min(1.08, (amb + colCone[x] * beamFall) * surface);

        const r = (texel & 255) * light;
        const g = ((texel >> 8) & 255) * light;
        const b = ((texel >> 16) & 255) * light;

        const rr = (r * invFog + fR) | 0;
        const gg = (g * invFog + fG) | 0;
        const bb = (b * invFog + fB) | 0;

        fcBuf[row + x] =
          0xff000000 |
          ((bb > 255 ? 255 : bb) << 16) |
          ((gg > 255 ? 255 : gg) << 8) |
          (rr > 255 ? 255 : rr);
      }
    }
  }

  fcCtx.putImageData(fcImage, 0, 0);
}

/* ---------------------------------------------------------------
   Per-room atmosphere drawn over the cast surfaces
   --------------------------------------------------------------- */

function drawRoomAtmosphere(width, height, horizon) {
  const t = performance.now();

  if (currentRoom === 5) {
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = "rgba(225,255,255,.55)";
    ctx.lineWidth = 1.2;

    for (let y = horizon + 14; y < height; y += 16) {
      ctx.beginPath();
      for (let x = 0; x <= width; x += 14) {
        const yy = y + Math.sin(x * 0.045 + t * 0.002 + y * 0.025) * 3.2;
        if (x === 0) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }

    ctx.restore();
  }

  if (currentRoom === 6) {
    ctx.strokeStyle = "rgba(195,193,168,.10)";
    ctx.lineWidth = 9;

    for (let x = 70; x < width; x += 190) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, horizon * 0.7);
      ctx.stroke();
    }
  }

  if (currentRoom === 4) {
    /* arcing current: brief cold flashes that light nothing */
    if (Math.sin(t / 90) > 0.986) {
      ctx.fillStyle = "rgba(150,220,255,.09)";
      ctx.fillRect(0, 0, width, height);
    }
  }

  if (currentRoom === 3) {
    ctx.fillStyle = "rgba(200,210,220,.03)";
    for (let x = 40; x < width; x += 240) {
      ctx.fillRect(x, 0, 30, height);
    }
  }
}

/* ---------------------------------------------------------------
   Post processing
   --------------------------------------------------------------- */

const fxCanvas = document.createElement("canvas");
const fxCtx = fxCanvas.getContext("2d");

/* set true once a full frame is on screen, so a paused or unchanged
   frame can be re-presented instead of re-rendered (req: avoid
   unnecessary rendering work) */
let frameCached = false;

const grainPatterns = [];
let scanPattern = null;
let bloomOn = true;

function buildPostFX() {
  grainTiles.forEach((tile) => {
    grainPatterns.push(ctx.createPattern(tile, "repeat"));
  });

  const sc = document.createElement("canvas");
  sc.width = 1;
  sc.height = 3;

  const sg = sc.getContext("2d");
  sg.fillStyle = "rgba(0,0,0,.14)";
  sg.fillRect(0, 0, 1, 1);

  scanPattern = ctx.createPattern(sc, "repeat");
}

function postProcess(width, height) {
  if (bloomOn) {
    fxCtx.clearRect(0, 0, width, height);
    fxCtx.drawImage(canvas, 0, 0);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.11;
    ctx.filter = `blur(${(5 * Display.ui).toFixed(2)}px)`;
    ctx.drawImage(fxCanvas, 0, 0);
    ctx.filter = "none";
    ctx.restore();
  }

  /* chromatic fringe: warm on one edge, cold on the other */
  const left = ctx.createLinearGradient(0, 0, width * 0.16, 0);
  left.addColorStop(0, "rgba(255,60,60,.085)");
  left.addColorStop(1, "rgba(255,60,60,0)");

  const right = ctx.createLinearGradient(width, 0, width * 0.84, 0);
  right.addColorStop(0, "rgba(60,190,255,.085)");
  right.addColorStop(1, "rgba(60,190,255,0)");

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.fillStyle = left;
  ctx.fillRect(0, 0, width * 0.16, height);
  ctx.fillStyle = right;
  ctx.fillRect(width * 0.84, 0, width * 0.16, height);
  ctx.restore();

  /* scanlines */
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = scanPattern;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();

  /* film grain */
  ctx.save();
  ctx.globalCompositeOperation = "overlay";
  ctx.globalAlpha = 0.20;
  ctx.translate(
    -((Math.random() * GRAIN_TILE) | 0),
    -((Math.random() * GRAIN_TILE) | 0)
  );
  ctx.fillStyle =
    grainPatterns[(Math.random() * grainPatterns.length) | 0];
  ctx.fillRect(0, 0, width + GRAIN_TILE, height + GRAIN_TILE);
  ctx.restore();
}

/* ---------------------------------------------------------------
   HUD
   --------------------------------------------------------------- */

function drawHUD(width, height) {
  /* FUTURE NINTENDO SWITCH PORT PREPARATION:
     the HUD is authored in a fixed 1280x720 space and scaled by
     Display.ui, so it stays legible and correctly proportioned from a
     phone in landscape up to a docked 1080p TV. */
  const U = Display.ui;
  const px = (v) => v * U;

  ctx.save();

  const boxW = px(360);
  const boxH = px(112);
  const boxX = px(18);
  const boxY = px(18);

  ctx.fillStyle = "rgba(4,4,4,.60)";
  ctx.fillRect(boxX, boxY, boxW, boxH);

  ctx.strokeStyle = "rgba(255,255,255,.10)";
  ctx.lineWidth = Math.max(1, px(1));
  ctx.strokeRect(boxX, boxY, boxW, boxH);

  const padX = boxX + px(15);

  ctx.fillStyle = "#fff";
  ctx.textAlign = "left";
  ctx.font = `bold ${px(21).toFixed(1)}px Arial`;
  ctx.fillText("ULTRA ELLIOT", padX, boxY + px(30));

  ctx.font = `${px(14.5).toFixed(1)}px Arial`;
  ctx.fillText(
    `Room ${currentRoom}/${rooms.length} - ${rooms[currentRoom - 1].name}`,
    padX,
    boxY + px(54)
  );

  ctx.font = `${px(12.5).toFixed(1)}px Arial`;
  ctx.fillStyle = "rgba(255,255,255,.74)";
  ctx.fillText(roomHints[currentRoom], padX, boxY + px(74));

  /* battery */
  const by = boxY + px(84);
  const barH = px(9);
  const labelW = px(70);
  const barX = padX + labelW;
  const barW = boxW - labelW - px(30);

  ctx.fillStyle = "rgba(255,255,255,.55)";
  ctx.font = `bold ${px(11).toFixed(1)}px Arial`;
  ctx.fillText(flashOn ? "TORCH" : "TORCH OFF", padX, by + px(8));

  ctx.fillStyle = "rgba(255,255,255,.14)";
  ctx.fillRect(barX, by, barW, barH);

  const level = battery;
  const col =
    level > 0.5
      ? "rgba(120,225,140,.92)"
      : level > 0.2
        ? "rgba(240,206,90,.92)"
        : "rgba(240,90,80,.95)";

  ctx.fillStyle = col;
  ctx.fillRect(barX, by, barW * level, barH);

  ctx.strokeStyle = "rgba(255,255,255,.28)";
  ctx.strokeRect(barX, by, barW, barH);

  if (!flashOn && battery < 1) {
    ctx.fillStyle = "rgba(140,230,160,.75)";
    ctx.font = `${px(10).toFixed(1)}px Arial`;
    ctx.textAlign = "right";
    ctx.fillText("recharging", barX + barW, by - px(2));
    ctx.textAlign = "left";
  }

  ctx.restore();

  if (spawnGrace > 0) {
    ctx.save();
    ctx.textAlign = "center";
    ctx.fillStyle = `rgba(150,235,175,${
      0.55 + Math.sin(performance.now() / 130) * 0.25
    })`;
    ctx.font = `bold ${px(15).toFixed(1)}px Arial`;
    ctx.fillText(
      `SAFE - ${spawnGrace.toFixed(1)}s   move`,
      width / 2,
      height - px(30)
    );
    ctx.restore();
  }
}

/* Pause overlay lives on its own so a paused frame can be re-presented
   over the cached image instead of re-rendering the whole world. */
function drawPauseOverlay(width, height) {
  const px = (v) => v * Display.ui;

  ctx.fillStyle = "rgba(0,0,0,.66)";
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.font = `bold ${px(48).toFixed(1)}px Arial`;
  ctx.fillText("PAUSED", width / 2, height / 2);

  ctx.font = `${px(17).toFixed(1)}px Arial`;
  ctx.fillText(
    Input.anyPad()
      ? "Press Start or A to resume"
      : "Click the game to resume",
    width / 2,
    height / 2 + px(38)
  );
}

/* ---------------------------------------------------------------
   Title / end screens built on the cover art
   --------------------------------------------------------------- */

const cover = new Image();
let coverReady = false;

cover.onload = () => {
  coverReady = true;
};

cover.src = "public/Ultra-Elliot-cover.jpg";

function drawCoverBackdrop(width, height, dim) {
  if (!coverReady) {
    ctx.fillStyle = "#0a0c0a";
    ctx.fillRect(0, 0, width, height);
    return;
  }

  /* blurred fill behind, crisp square art in front */
  ctx.save();
  ctx.filter = "blur(26px) brightness(0.45)";

  const fillScale = Math.max(width / cover.width, height / cover.height);
  const fw = cover.width * fillScale;
  const fh = cover.height * fillScale;

  ctx.drawImage(cover, (width - fw) / 2, (height - fh) / 2, fw, fh);
  ctx.filter = "none";
  ctx.restore();

  ctx.fillStyle = `rgba(0,0,0,${dim})`;
  ctx.fillRect(0, 0, width, height);
}

function drawCoverArt(width, height, size, cy, alpha) {
  if (!coverReady) return;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.shadowColor = "rgba(0,0,0,.9)";
  ctx.shadowBlur = 40;
  ctx.drawImage(cover, (width - size) / 2, cy, size, size);
  ctx.restore();

  ctx.strokeStyle = "rgba(240,230,180,.28)";
  ctx.lineWidth = 2;
  ctx.strokeRect((width - size) / 2, cy, size, size);
}

function drawTitleScreen(width, height) {
  drawCoverBackdrop(width, height, 0.34);

  const size = Math.min(height * 0.74, 560 * Display.ui);
  drawCoverArt(width, height, size, (height - size) / 2 - 30 * Display.ui, 1);

  const t = performance.now();
  const pulse = 0.62 + Math.sin(t / 380) * 0.28;

  const px = (v) => v * Display.ui;

  ctx.textAlign = "center";
  ctx.fillStyle = `rgba(255,255,255,${pulse})`;
  ctx.font = `bold ${px(22).toFixed(1)}px Arial`;
  ctx.fillText(
    Input.anyPad() ? "PRESS A TO ENTER" : "CLICK OR TAP TO ENTER",
    width / 2,
    height - px(52)
  );

  ctx.fillStyle = "rgba(255,255,255,.58)";
  ctx.font = `${px(13).toFixed(1)}px Arial`;
  ctx.fillText(
    "Left Stick / WASD move  -  Right Stick / Mouse look  -  Arrows or Q/E turn  -  L3 or Shift run  -  F torch  -  Start or Esc pause",
    width / 2,
    height - px(26)
  );

  /* side panels use the space the square art leaves over */
  const panel = (width - size) / 2;

  if (panel > 150 * Display.ui) {
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(255,255,255,.80)";
    ctx.font = `bold ${px(13).toFixed(1)}px Arial`;
    ctx.fillText("OBJECTIVE", px(26), px(66));

    ctx.fillStyle = "rgba(255,255,255,.60)";
    ctx.font = `${px(12).toFixed(1)}px Arial`;

    const lines = [
      `Collect all ${TOTAL_CARDS}`,
      "access cards",
      "across 10 levels,",
      "then find the",
      "true exit.",
      "",
      "Your torch drains.",
      "Switch it off to",
      "let it recover.",
      "",
      "Light makes you",
      "easier to see."
    ];

    lines.forEach((line, i) => {
      ctx.fillText(line, px(26), px(90) + i * px(17));
    });

    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(255,255,255,.80)";
    ctx.font = `bold ${px(13).toFixed(1)}px Arial`;
    ctx.fillText("LEVELS", width - px(26), px(66));

    ctx.fillStyle = "rgba(255,255,255,.60)";
    ctx.font = `${px(12).toFixed(1)}px Arial`;

    rooms.forEach((room, i) => {
      ctx.fillText(`${room.id}. ${room.name}`, width - px(26), px(90) + i * px(17));
    });
  }
}

function drawEndScreen(width, height) {
  drawCoverBackdrop(width, height, 0.62);

  const px = (v) => v * Display.ui;

  const size = Math.min(height * 0.46, 320 * Display.ui);
  drawCoverArt(width, height, size, height / 2 - size - px(10), 0.55);

  ctx.textAlign = "center";
  ctx.fillStyle = "#fff";
  ctx.font = `bold ${px(52).toFixed(1)}px Arial`;
  ctx.fillText(
    won ? "YOU ESCAPED" : "GAME OVER",
    width / 2,
    height / 2 + px(50)
  );

  ctx.font = `${px(20).toFixed(1)}px Arial`;
  ctx.fillText(
    won ? "You survived Ultra Elliot." : "The creatures found you.",
    width / 2,
    height / 2 + px(88)
  );

  ctx.font = `${px(15).toFixed(1)}px Arial`;
  ctx.fillStyle = "rgba(255,255,255,.75)";
  ctx.fillText(
    Input.anyPad()
      ? "Press A to try again."
      : "Press Enter or Restart to try again.",
    width / 2,
    height / 2 + px(118)
  );
}

/* ---------------------------------------------------------------
   Frame
   --------------------------------------------------------------- */

function draw() {
  const width = canvas.width;
  const height = canvas.height;

  if (!started) {
    drawTitleScreen(width, height);
    return;
  }

  const bob = Math.sin(player.bob) * 2.2;
  const horizon = height / 2 + bob + player.pitch;

  renderFloorCeiling(horizon);

  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(fcCanvas, 0, 0, width, height);
  ctx.imageSmoothingEnabled = false;

  /* ---- walls ---- */

  const columns = WALL_COLUMNS;
  const columnWidth = width / columns;
  const theme = themes[currentRoom];

  for (let i = 0; i < columns; i++) {
    const relativeAngle = (i / columns - 0.5) * FOV;
    const ray = castRay(player.a + relativeAngle);

    const distance = Math.max(0.02, ray.d * Math.cos(relativeAngle));
    const wallHeight = Math.min(height * 6, (height * PROJ_K) / distance);
    const top = horizon - wallHeight / 2;

    const rid = ray.room;
    const base = themes[rid] || theme;
    const tex = wallTex[rid] || wallTex[currentRoom];

    const texX = Math.min(TEXMASK, (ray.u * TEX) | 0);
    const x = i * columnWidth;

    ctx.drawImage(
      tex.canvas,
      texX,
      0,
      1,
      TEX,
      x,
      top,
      columnWidth + 1,
      wallHeight
    );

    /* lighting: room ambient plus the torch, minus a face bias so
       corners read as corners */
    const amb = base.amb * Math.max(0.16, 1 - distance * 0.045);
    const beam = beamAt(relativeAngle, distance) * 2.05;

    let light = Math.min(1, amb + beam);
    if (ray.side === 1) light *= 0.74;

    if (light < 1) {
      ctx.fillStyle = `rgba(0,0,0,${1 - light})`;
      ctx.fillRect(x, top, columnWidth + 1, wallHeight);
    }

    const fog = Math.min(0.72, distance / 26);

    if (fog > 0.02) {
      ctx.fillStyle = `rgba(${base.fog[0] | 0},${base.fog[1] | 0},${
        base.fog[2] | 0
      },${fog * 0.5})`;
      ctx.fillRect(x, top, columnWidth + 1, wallHeight);
    }
  }

  ctx.imageSmoothingEnabled = true;

  drawRoomAtmosphere(width, height, horizon);

  /* ---- sprites ---- */

  const sprites = [];

  cards
    .filter((card) => !card.taken)
    .forEach((card) => sprites.push({ ...card, type: "card" }));

  monsters.forEach((monster) => sprites.push({ ...monster, type: "monster" }));

  sprites.push({ ...exitPoint, type: "exit" });

  if (currentRoom === EXIT_ROOM) {
    decoySigns.forEach((sign, i) =>
      sprites.push({ ...sign, type: "sign", seed: i })
    );
  }

  sprites.sort(
    (a, b) =>
      Math.hypot(player.x - b.x, player.y - b.y) -
      Math.hypot(player.x - a.x, player.y - a.y)
  );

  for (const sprite of sprites) {
    const dx = sprite.x - player.x;
    const dy = sprite.y - player.y;
    const distance = Math.hypot(dx, dy);

    let angle = Math.atan2(dy, dx) - player.a;

    while (angle > Math.PI) angle -= Math.PI * 2;
    while (angle < -Math.PI) angle += Math.PI * 2;

    if (Math.abs(angle) >= FOV / 2 || distance < 0.2) continue;

    const wallDistance = castRay(player.a + angle).d;

    if (distance > wallDistance + 0.18) continue;

    const screenX = (angle / FOV + 0.5) * width;
    const size = Math.min(360, 190 / distance);

    /* creatures are only as visible as the light falling on them */
    const amb = themes[currentRoom].amb * Math.max(0.2, 1 - distance * 0.045);
    const lit = Math.min(1, amb * 0.85 + beamAt(angle, distance) * 1.7);

    if (sprite.type === "monster") {
      drawMonster(screenX, horizon, size, distance, sprite, lit);
    } else if (sprite.type === "card") {
      drawCard(screenX, horizon, size, distance, Math.max(lit, 0.30));
    } else if (sprite.type === "sign") {
      const w = size * 0.95;
      const h = size * 0.40;
      const top = horizon - h / 2 - size * 0.18;

      /* they never quite agree with each other */
      const flick =
        0.72 +
        Math.sin(performance.now() / (420 + sprite.seed * 90) + sprite.seed) *
          0.22;

      ctx.save();
      ctx.globalAlpha = Math.max(0.2, Math.min(1, 1 - distance / 20));
      ctx.shadowColor = "#3fd46e";
      ctx.shadowBlur = 16;
      ctx.fillStyle = `rgba(16,88,40,${flick})`;
      ctx.fillRect(screenX - w / 2, top, w, h);

      ctx.shadowBlur = 0;
      ctx.strokeStyle = `rgba(190,232,198,${flick * 0.7})`;
      ctx.lineWidth = Math.max(1, size * 0.012);
      ctx.strokeRect(screenX - w / 2, top, w, h);

      ctx.fillStyle = `rgba(235,255,240,${flick})`;
      ctx.font = `bold ${Math.max(8, h * 0.5)}px Arial`;
      ctx.textAlign = "center";
      ctx.fillText(
        sprite.seed % 2 ? "\u2190 EXIT" : "EXIT \u2192",
        screenX,
        top + h * 0.68
      );

      ctx.restore();
    } else if (sprite.type === "exit" && currentRoom === EXIT_ROOM) {
      ctx.save();

      const ready = collected === TOTAL_CARDS;
      const signWidth = size * 1.2;
      const signHeight = size * 0.52;

      ctx.shadowColor = ready ? "#4df279" : "#777";
      ctx.shadowBlur = 22;
      ctx.fillStyle = ready ? "#177d3c" : "#4b4b43";
      ctx.fillRect(
        screenX - signWidth / 2,
        horizon - signHeight / 2,
        signWidth,
        signHeight
      );

      ctx.shadowBlur = 0;
      ctx.strokeStyle = "#e6f7e9";
      ctx.strokeRect(
        screenX - signWidth / 2,
        horizon - signHeight / 2,
        signWidth,
        signHeight
      );

      ctx.fillStyle = "#fff";
      ctx.font = `bold ${Math.max(11, size * 0.17)}px Arial`;
      ctx.textAlign = "center";
      ctx.fillText(ready ? "TRUE EXIT" : "LOCKED", screenX, horizon + 5);

      ctx.restore();
    }
  }

  /* ---- proximity dread ---- */

  const near = nearestHunter();

  if (near < 5.5 && spawnGrace <= 0 && !won && !gameOver) {
    const danger = ctx.createRadialGradient(
      width / 2,
      height / 2,
      80,
      width / 2,
      height / 2,
      width * 0.68
    );

    danger.addColorStop(0, "rgba(0,0,0,0)");
    danger.addColorStop(
      1,
      `rgba(75,0,0,${Math.min(0.34, Math.max(0.08, 0.36 - near * 0.05))})`
    );

    ctx.fillStyle = danger;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = "rgba(255,255,255,.88)";
    ctx.textAlign = "center";
    ctx.font = "bold 13px Arial";
    ctx.fillText(
      near < 2.6 ? "IT IS GETTING CLOSER" : "SOMETHING HAS SEEN YOU",
      width / 2,
      26
    );
  }

  /* ---- vignette, breathing with proximity ---- */

  const tension = near < 7 ? (7 - near) / 7 : 0;
  const breathe =
    0.52 - tension * 0.14 + Math.sin(performance.now() / 700) * 0.015;

  const dark = ctx.createRadialGradient(
    width / 2,
    height / 2,
    90,
    width / 2,
    height / 2,
    width * (0.72 - tension * 0.12)
  );

  dark.addColorStop(breathe, "rgba(0,0,0,0)");
  dark.addColorStop(1, `rgba(0,0,0,${0.72 + tension * 0.16})`);

  ctx.fillStyle = dark;
  ctx.fillRect(0, 0, width, height);

  if (damagePulse > 0) {
    ctx.fillStyle = `rgba(120,0,0,${damagePulse * 0.24})`;
    ctx.fillRect(0, 0, width, height);
  }

  postProcess(width, height);

  drawHUD(width, height);

  if (paused && !won && !gameOver) drawPauseOverlay(width, height);

  if (won || gameOver) drawEndScreen(width, height);
}

/* keeps the last finished frame so a paused screen costs nothing */
function capturePauseFrame() {
  if (!started || won || gameOver) return;

  fxCtx.clearRect(0, 0, canvas.width, canvas.height);
  fxCtx.drawImage(canvas, 0, 0);
  frameCached = true;
}

function gameLoop(now) {
  const dt = Math.min(0.04, (now - lastTime) / 1000 || 0);
  lastTime = now;

  const frameStart = performance.now();

  Input.update();
  applySystemInput();
  update(dt);

  /* the drone leans in when something has actually noticed you */
  const hunted =
    started && !paused && !won && !gameOver && nearestHunter() < 6;

  Music.update(dt, hunted);

  /* Nothing in the world moves while paused, so re-present the cached
     frame rather than rebuilding it 60 times a second. */
  if (paused && started && !won && !gameOver && frameCached) {
    ctx.drawImage(fxCanvas, 0, 0);
    drawPauseOverlay(canvas.width, canvas.height);
  } else {
    draw();
  }

  Display.sample(performance.now() - frameStart);

  requestAnimationFrame(gameLoop);
}

/* =====================================================================
   FUTURE NINTENDO SWITCH PORT PREPARATION - SYSTEM INPUT
   ---------------------------------------------------------------------
   Menu, pause and restart intent, resolved from the abstract input
   layer rather than from raw keys. A Switch build swaps the source of
   these intents (HID / native pad) and leaves this logic untouched.
   ===================================================================== */

function applySystemInput() {
  const p = Input.player(0);

  /* title screen: A / Enter / tap enters the game */
  if (!started) {
    if (p.pressed.music) Music.toggle();
    if (p.pressed.confirm) startGame(!Input.anyPad());
    return;
  }

  if (won || gameOver) {
    if (p.pressed.music) Music.toggle();
    if (p.pressed.confirm) {
      resetGame();
      started = true;
    }
    return;
  }

  if (p.pressed.pause || p.pressed.back) togglePause();

  if (p.pressed.music) Music.toggle();

  if (p.pressed.torch) {
    if (!flashOn && battery <= 0.02) {
      setStatus("The cell is flat. Give it a moment.", 2);
    } else {
      flashOn = !flashOn;
      Sfx.play(flashOn ? "torchOn" : "torchOff");
      setStatus(flashOn ? "Torch on." : "Torch off. Cell recovering.", 1.5);
    }
  }
}

/* ---------------------------------------------------------------
   Pointer lock (mouse look). Optional - gamepad and touch players
   never need it, and the game is fully playable without it.
   --------------------------------------------------------------- */

let pointerLocked = false;

document.addEventListener("pointerlockchange", () => {
  pointerLocked = document.pointerLockElement === canvas;
  Input.clearLook();

  /* losing the cursor mid-run should not mean walking blind */
  if (!pointerLocked && started && !won && !gameOver && !paused && !Input.anyPad()) {
    paused = true;
    pauseBtn.textContent = "Resume";
    capturePauseFrame();
  }
});

function requestLook() {
  /* pointer lock is a mouse convenience; never force it on touch */
  if (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) return;
  if (!canvas.requestPointerLock) return;

  const result = canvas.requestPointerLock();
  if (result && typeof result.catch === "function") result.catch(() => {});
}

function startGame(withLook = true) {
  started = true;
  resetGame();
  if (withLook) requestLook();
}

/* One place for every involuntary pause: focus loss, tab suspend, a
   controller vanishing. Safe to call at any time. */
function systemPause(reason) {
  if (!started || won || gameOver || paused) return;

  paused = true;
  pauseBtn.textContent = "Resume";
  Input.clearLook();
  capturePauseFrame();
  Music.suspend();

  if (document.pointerLockElement === canvas) document.exitPointerLock();

  if (reason) setStatus(reason, 4);
}

function togglePause() {
  if (won || gameOver || !started) return;

  paused = !paused;
  pauseBtn.textContent = paused ? "Resume" : "Pause";
  Input.clearLook();

  if (paused) {
    capturePauseFrame();
    /* no Music.suspend() here: a menu pause ducks the score rather
       than stopping it. update() eases it down to VOL_PAUSED. */
    if (document.pointerLockElement === canvas) document.exitPointerLock();
  } else {
    frameCached = false;
    Music.resume();
    requestLook();
  }
}

canvas.addEventListener("mousedown", (event) => {
  event.preventDefault();
  canvas.focus();
  Music.unlock();
      Sfx.unlock();

  if (!started) {
    startGame();
    return;
  }

  if (won || gameOver) {
    resetGame();
    started = true;
    return;
  }

  if (paused) {
    paused = false;
    frameCached = false;
    pauseBtn.textContent = "Pause";
  }

  requestLook();
});

/* touch: tapping the cover enters the game */
canvas.addEventListener("pointerdown", (event) => {
  if (event.pointerType !== "touch") return;
  canvas.focus();
  Music.unlock();
      Sfx.unlock();

  if (!started) {
    startGame(false);
  } else if (won || gameOver) {
    resetGame();
    started = true;
  }
});

canvas.addEventListener("contextmenu", (event) => event.preventDefault());

restartBtn.addEventListener("click", () => {
  Music.unlock();
      Sfx.unlock();
  resetGame();
  started = true;
  canvas.focus();
});

pauseBtn.addEventListener("click", () => {
  Music.unlock();
      Sfx.unlock();
  togglePause();
  canvas.focus();
});

/* ---------------------------------------------------------------
   Boot
   --------------------------------------------------------------- */

buildTextures();
buildGrain();
Input.init();
Music.init();
Display.init();
buildPostFX();
resetGame();

started = false;
lastTime = performance.now();
requestAnimationFrame(gameLoop);
