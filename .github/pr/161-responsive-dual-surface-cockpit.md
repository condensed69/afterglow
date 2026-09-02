### Summary of Changes

Implements **PR 2: "Responsive Dual-Surface Layout & Mobile Bottom-Cockpit"** of Afterglow 2.0 based on the master roadmap in `AFTERGLOW_2.0_PLAN.md`.

#### Key Deliverables:
1. **Mobile Bottom Thumb Cockpit (`.thumb-cockpit`)**:
   - Pinned above the safe area / footer on mobile screens (`<=900px`).
   - Houses the primary interaction CTAs (`Work the Room` and `Buy a round`) plus horizontal thumb tab selector (`#thumb-tabs-container`), enabling seamless single-thumb mobile operation.
   - Padded with `calc(6px + env(safe-area-inset-bottom, 0px))` for notched/home-bar mobile devices.
2. **Slide-Up Bottom Drawers (`.modal-overlay` / `.modal-dialog`)**:
   - Replaces desktop modals with bottom-sheet drawers that slide up smoothly on mobile (`@keyframes slideUpDrawer`).
   - Retains centered desktop modal presentation on `>=901px` viewports.
3. **Touch Latency & Target Sizing**:
   - Enforced `touch-action: manipulation` globally across buttons and inputs to eliminate the 300ms mobile tap delay.
   - Guaranteed minimum touch hitboxes of `>= 44x44px` on all interactive controls.
4. **Dynamic Viewport Unit**:
   - Standardized on `100dvh` in `.app-root` and added `viewport-fit=cover` in `index.html`.
5. **Version Bump & CHANGELOG**:
   - Bumped `VERSION` to `0.12.1` (build 257, channel `alpha`, codename `Neon Syndicate`). `SAVE_VER` stays 13.
6. **Test Coverage**:
   - Added unit tests in `economy.test.mjs` verifying thumb-cockpit DOM mounting, modal overlay/dialog classes, and CSS containment invariants.

#### Verification Gates:
- `node --check game.js`: PASS
- `node --check src/core/reactive.js`: PASS
- `node economy.test.mjs`: 331 passed, 0 skipped, 0 failed
- `node pacing.mjs`: 100% PASS across all milestone and replay scenarios (bit-identical).
