### Summary of Changes

Implements **PR 3: "Canvas Floorboard & Web Audio Synthesizer"** of Afterglow 2.0 based on the master roadmap in `AFTERGLOW_2.0_PLAN.md`.

#### Key Deliverables:
1. **HTML5 Canvas Floorboard (`src/ui/floorboard.js`)**:
   - High-performance 60 FPS Canvas 2D floorboard renderer mounted on `<canvas id="stage-canvas">`.
   - Perspective neon floor grid with dynamic depth lines and vanishing rays.
   - Crowd particles that scale with `patrons` and `regulars`, bobbing dynamically with `hype` and beat tempo.
   - Sweeping spotlights and laser beams with alpha modulation and screen compositing.
   - Interactive pulse ripples emitted on user clicks ("Work the room") and purchases ("Buy a round").
   - Automatically pauses rendering loop on `document.visibilityState === 'hidden'` or when unmounted.
2. **Procedural Web Audio Synthesizer (`src/core/audio.js`)**:
   - Zero-asset procedural synth & rhythm generator (<4KB) utilizing pure Web Audio API.
   - 4-on-the-floor sub-bass kick oscillator with pitch drop envelope (`140Hz -> 38Hz`).
   - Highpass-filtered white noise hi-hat on off-beats.
   - Resonant 24dB lowpass saw bassline synced to BPM and modulated by hype level.
   - Tactile pitch-dropping click SFX on room actions and ascending chime arpeggio on round purchases.
   - Muted by default for autoplay compliance; toggled via header button `#header-sound-btn` and Settings modal `#settings-sound-btn`, persisted to `localStorage['afterglow.sound']`.
   - Handles tab visibility state changes cleanly.
3. **Engine & Game Integration (`game.js`, `index.html`, `style.css`)**:
   - Added `#header-sound-btn` with icon status (`🔊` / `🔇`) and `#settings-sound-btn`.
   - Mounted `<canvas id="stage-canvas">` inside `#stage` with `.stage-canvas` CSS rules.
   - Bumped `VERSION` to `0.12.2` (build 258, channel `alpha`, codename `Neon Syndicate`). `SAVE_VER` stays 13.
4. **Test Suite Coverage (`economy.test.mjs`)**:
   - Added test verifying Web Audio Synthesizer instantiation, toggling, and sound generation.
   - Added test verifying Canvas Floorboard creation, particle management, pulse ripple triggering, and lifecycle.
   - Added test verifying Game integration with `#stage-canvas` and `#header-sound-btn`.

#### Verification Gates:
- `node --check game.js`: PASS
- `node --check src/core/audio.js`: PASS
- `node --check src/ui/floorboard.js`: PASS
- `node --check src/core/reactive.js`: PASS
- `node economy.test.mjs`: 334 passed, 0 skipped, 0 failed
- `node pacing.mjs`: 100% PASS across all milestone and replay scenarios (bit-identical).
