### Summary of Changes

Implements **PR 4: "4-Phase Operational Shifts & Police Heat Engine"** of Afterglow 2.0 based on the master roadmap in `AFTERGLOW_2.0_PLAN.md`.

#### Key Deliverables:
1. **Police Heat & Security Mitigation Engine (`catalogs.js`, `game.js`)**:
   - Added `HEAT` configuration and `INCIDENTS` catalog to `catalogs.js`.
   - Shift-dependent heat rate calculation: Early Doors (`+0.02/s`), Peak Hours (`+0.08/s`), Last Call (`+0.05/s`), After Hours (`+0.12/s`).
   - Door Staff security score mitigation: each `door` building reduces heat generation by `-0.015/s`.
   - Natural heat decay when security suppression exceeds base shift generation (`\text{HeatRate} = \max(-0.04, \text{BaseHeat} - 0.015 \times \text{DoorStaff})`).
   - Heat bounds preserved within $[0, 100]$.
2. **Interactive Bribe & Live Raid Incident Loops (`game.js`)**:
   - "Grease the Chief" / `bribePolice()` action: Pay $\$30 + 4 \times \text{night}$ (min $\$25$) to instantly reduce $-35$ Heat.
   - Police Raid: Reaching $100\%$ Heat in live play triggers an automatic raid, fining cash and cooling Heat back down to $45\%$.
   - Dynamic live incident rolls (Bar Fights, Noise Complaints, Fire Marshal checks) with reactive log feedback.
3. **Reactive UI Integration (`game.js`)**:
   - Added `#header-heat-meter` and `#header-heat-val` badge in the header with color-coded alerts (`#4ade80` < 40%, `#ffc94a` < 70%, `#ff2d78` >= 70%).
   - One-tap Bribe Chief action directly wired to the header heat meter.
   - Updated `FLAT_RUN_FIELDS`, `STRAY_FIELDS`, `freshClubState()`, and `sanitizeG()`.
   - Bumped `VERSION` to `0.12.3` (build 259, channel `alpha`, codename `Neon Syndicate`). `SAVE_VER` stays 13.
4. **Test Suite Coverage (`economy.test.mjs`)**:
   - Unit tests for shift heat rate calculations and door security mitigation.
   - Unit tests for heat accrual during `step()` simulation and `bribePolice()` cash / heat reduction.
   - Unit tests for header heat meter and value rendering.

#### Verification Gates:
- `node --check game.js`: PASS
- `node --check catalogs.js`: PASS
- `node --check src/core/audio.js`: PASS
- `node --check src/ui/floorboard.js`: PASS
- `node --check src/core/reactive.js`: PASS
- `node economy.test.mjs`: 337 passed, 0 skipped, 0 failed
- `node pacing.mjs`: 100% PASS across all milestone and replay scenarios (bit-identical).
