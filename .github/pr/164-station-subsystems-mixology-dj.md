### Summary of Changes

Implements **PR 5: "Station Subsystems (Mixology Bar Inventory & DJ Beat-Sync)"** of Afterglow 2.0 based on the master roadmap in `AFTERGLOW_2.0_PLAN.md`.

#### Key Deliverables:
1. **Mixology Bar Stocking & Beverage Tiers (`catalogs.js`, `game.js`)**:
   - Added `BEVERAGES` catalog with 3 distinct tiers: Well Spirits (Tier 1, Cost $15, Size 50, +20% bar rev), Craft Cocktails (Tier 2, Cost $45, Size 40, +35% bar rev), Top-Shelf Champagne (Tier 3, Cost $120, Size 30, +60% bar rev).
   - Bar drinks consume inventory dynamically during active service ($0.05 \times \text{bar} \times \text{dt}$).
   - Added `restockBar()` and `setBarTier(idx)` station methods to `Game`.
2. **DJ Beat-Sync Frenzy Engine (`catalogs.js`, `game.js`)**:
   - Added `DJ_TRACKS` catalog: Neon Pulse (120 BPM), Acid Rain (128 BPM), Midnight Laser Storm (140 BPM).
   - Tapping `djBeatSync()` during live sessions (`_live = true`) triggers a 6-second Beat Sync Frenzy ($+25\%$ Hype gain, $+15\%$ Total Cash multiplier) with a 15-second cooldown.
   - Synchronized audio chime (`audio.playChime()`) and floorboard canvas particle bursts (`floorboard.triggerPulse()`).
3. **Reactive UI & Station Controls (`game.js`)**:
   - Added `#cta-restock-bar` and `#cta-dj-beatsync` quick action buttons in `stage-cta`.
   - Granular in-place DOM updates in `updateDom(v)` preserving button focus and eliminating re-bind leaks.
   - Bumped `VERSION` to `0.12.4` (build 260, channel `alpha`, codename `Station Subsystems`). `SAVE_VER` stays 13.
4. **Test Suite Coverage (`economy.test.mjs`)**:
   - Unit tests for bar stocking revenue multipliers and stock consumption during `step()` simulation.
   - Unit tests for `restockBar()` batch additions and cash deduction.
   - Unit tests for DJ Beat-Sync Frenzy multipliers and cooldown timing.
   - Unit tests for station buttons in DOM template.

#### Verification Gates:
- `node --check game.js`: PASS
- `node --check catalogs.js`: PASS
- `node --check src/core/audio.js`: PASS
- `node --check src/ui/floorboard.js`: PASS
- `node --check src/core/reactive.js`: PASS
- `node economy.test.mjs`: 342 passed, 0 skipped, 0 failed
- `node pacing.mjs`: 100% PASS across all milestone and replay scenarios (bit-identical).
