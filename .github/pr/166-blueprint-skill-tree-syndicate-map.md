### Summary of Changes

Implements **PR 7: "Branching Blueprint Skill Tree & District Syndicate Map"** of Afterglow 2.0 based on the master roadmap in `AFTERGLOW_2.0_PLAN.md`.

#### Key Deliverables:
1. **Branching Blueprint Skill Tree (`catalogs.js`, `game.js`)**:
   - Added `BLUEPRINTS` catalog with 4 specialized progression branches across 3 tiers (12 nodes total):
     - **Audio Engine (`audio`)**: `sub_bass_acoustics` (+20% DJ Booth Hype), `drop_synchronizer` (Beat-sync frenzy x1.50), `acoustic_overdrive` (+25% Stage Hype, +10% Cash Flow).
     - **Mixology Lab (`mixology`)**: `craft_infusions` (+25% Bar cash), `automated_pourers` (+30% stock yield/throughput), `master_distillery` (+15% Bar Revenue).
     - **Crowd Psychology (`crowd`)**: `velvet_allure` (+25% VIP regular conversion), `hype_viral_loop` (+40% Buzz conversion, +20% Regular retention), `whale_syndicate` (+50% Whale cash grant).
     - **Underground Syndicate (`syndicate`)**: `shadow_patrols` (-25% Heat generation), `bribe_networks` (-40% Bribe cost), `black_market_logistics` (-50% Restocking cost).
   - Added `unlockBlueprint(bpId)` method enforcing prerequisite node chains and Legacy point costs.
2. **City District Syndicate Map & Logistics Links (`catalogs.js`, `game.js`)**:
   - Added `DISTRICTS` catalog:
     - `downtown` (Downtown Neon Strip, venue `main`): Neon Promenade (+10% Buzz Generation).
     - `industrial` (Warehouse Underground, venue `annex`): Bass Cavern (+20% Hype Generation).
     - `uptown` (Sky Tower Promenade, venue `rooftop`): Skyline Penthouse (+25% VIP Cash Flow).
   - Added `DISTRICT_LINKS` catalog:
     - `vip_shuttles` (Downtown $\leftrightarrow$ Uptown, Cost \$500): +20% VIP Cash Flow in connected clubs.
     - `touring_djs` (Downtown $\leftrightarrow$ Industrial, Cost \$450): +25% Stage Hype & DJ Hype in connected clubs.
     - `supply_corridor` (Industrial $\leftrightarrow$ Uptown, Cost \$600): 30% discount on bar restocking across all venues.
   - Added `toggleDistrictLink(linkId)` with multi-venue prerequisite validation and cash activation.
3. **Save System & UI View Model Integration (`game.js`)**:
   - Bumped `SAVE_VER` from 14 to 15 with fail-closed `MIGRATIONS[14]` (backfills `g.blueprints = {}`, `g.districtLinks = {}`).
   - Bumped `VERSION` to `0.14.0` (build 280, codename `Blueprints & Syndicate`).
   - Integrated blueprints and district links into `renderVals()`, `renderTemplate()`, and `updateDom()`.
   - Updated `confirmPrestige()` (preserves blueprints and districtLinks) and `confirmFranchiseSale()` (resets both to `{}`).
4. **Test Suite Coverage & Documentation (`economy.test.mjs`, `DESIGN.md`, `PRESTIGE.md`, `SECOND_LOCATION.md`)**:
   - Comprehensive test cases covering `SAVE_VER 15` migration, blueprint prerequisites, discounts, district links, and reset matrices.
   - Updated design architecture, prestige persist/reset tables, and account field listings.

#### Verification Gates:
- `node --check game.js`: PASS
- `node --check catalogs.js`: PASS
- `node --check src/core/audio.js`: PASS
- `node --check src/ui/floorboard.js`: PASS
- `node --check src/core/reactive.js`: PASS
- `node economy.test.mjs`: 353 passed, 0 skipped, 0 failed
- `node pacing.mjs --fast`: 100% PASS across all benchmark scenarios (bit-identical).
