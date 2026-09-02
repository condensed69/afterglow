# PR 8: Pluggable Content Pack Engine & Season 1: Miami Vice '86

Part of the **Afterglow 2.0: Master Redesign & Re-architecture** roadmap (`AFTERGLOW_2.0_PLAN.md`).

## Summary

Implements the pluggable seasonal content pack engine and ships the inaugural seasonal release: **Season 1: Miami Vice '86**.

### 1. Pluggable Content Pack Engine (`src/core/packs.js`)
- Modular registry (`ContentPackEngine`, `AfterglowPacks`) supporting dynamic pack registration, querying, and lifecycle activation.
- Content packs can be loaded, enabled, disabled, or removed cleanly without modifying core simulation equations or hardcoding seasonal data into `game.js`.
- Universal UMD wrapper supporting browser (`window.AfterglowPacks`), CommonJS (`require`), AMD, and Node test environments.
- XP progression system (`addXp`, `claimReward`) handling seasonal XP accumulation, automatic tier advancement (up to 30 tiers), and reward distribution (cash, clout, legacy, and permanent relics).

### 2. Season 1: Miami Vice '86 (`src/catalogs/packs/season1-miami.js`)
- **Theme & Aesthetic:** 1986 pastel synthwave palette (hot pink `#ff71ce`, cyan `#01cdfe`, sunset gold `#fffb96`, dark indigo `#0a0614`) with retro CRT scanline styling.
- **Venue:** South Beach Dayclub & Pool (`dayclub`) featuring oceanfront cabana bottle service and open-air sound stage.
- **Soundtrack:** 80s synthwave tracks (`Synthwave Sunset`, `Ocean Drive Groove`).
- **30-Tier Seasonal Battle Pass:**
  - Earn seasonal XP (100 XP per tier) across club actions: restock bar (+10 XP), work the room (+1 XP), DJ beat sync (+15 XP), grease the Chief (+20 XP), and buy a round (+25 XP).
  - Rewards spanning cash bundles, clout caches, and Legacy point grants across milestone tiers.
- **Capstone Relic (Tier 30):**
  - **Golden Flamingo Relic** (`golden_flamingo`): Gleaming 24k art deco flamingo relic.
  - Grants permanent +15% VIP cash flow and +10% prestige Legacy point yield.

### 3. Save Migration & Relic Persistence
- Bumps `SAVE_VER` from 15 to 16 with fail-closed `MIGRATIONS[15]`.
- Bumps `VERSION` to `0.15.0` (build 290, `Content Packs & Miami Vice`).
- **Core Invariant:** Permanent relics (`g.relics`) and seasonal progress (`g.packs`) persist across standard prestige (`confirmPrestige`), challenge runs (`startChallenge`), and franchise sales (`confirmFranchiseSale`).

### 4. Verification Gates
- `node --check game.js && node --check catalogs.js` PASS
- `node --check src/core/packs.js && node --check src/catalogs/packs/season1-miami.js` PASS
- `node economy.test.mjs` (359 passed, 0 skipped, 0 failed)
- `node pacing.mjs --fast` (all milestone scenarios within band, 100% bit-identical pacing)
