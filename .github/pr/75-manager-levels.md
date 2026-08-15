## feat: upgradeable managers — auto-buy levels (PR 5)

Automation becomes a progression, not a binary hire (REPLAY_ROADMAP.md §7):
each hired manager can be leveled up with Legacy from the Perks panel.

### What changed

- **`g.managerLevels`** (additive map, `buildingId → 0–3`) on top of the
  existing `g.managers` boolean — no migration, no `SAVE_VER` bump.
- **`buyManagerLevel(def)`** — Legacy purchase; requires the manager hired;
  caps at 3. Cost scales with level: **10 / 20 / 30 Legacy** for levels
  0→1→2→3 (`managerLevelCost = 10 × (level + 1)`).
- **`autoBuyManagers()` reads the level** for the per-tick quantity cap:
  **level 0–1 buys 1, level 2 buys 5, level 3 buys max affordable** (respecting
  building cap + cash). `managerPaused` still applies at every level, and
  challenge-locked buildings stay skipped at any level. Level ≥ 2 logs one
  line per fire ("×N") instead of one per building.
- **Perks-panel manager cards** now show `Lv N/3` in the owned badge, the
  per-tick quantity in the meta line ("auto-buys X ×5/tick"), and a gold
  **Level up N Legacy** sub-button beside Pause/Resume (`Maxed` at 3).
- **Ordinary prestige preserves levels** — `confirmPrestige` snapshots and
  restores `g.managerLevels` alongside the manager/pause whitelist (the spec's
  required regression test covers hired + pause + level all surviving).
  Only the future PR 6 franchise sale wipes them.
- **Fail-closed sanitize/import** — unknown ids → 0, values clamped to 0–3.

### Gates (all run locally)

| Gate | Result |
|------|--------|
| `node --check game.js` | pass |
| `node economy.test.mjs` | **260 passed** (253 prior + 7 new) |
| `node pacing.mjs` | all in band, **bit-identical to PR 4** — 1.53 / 7.70 / 5.70 / 14.35 / 19.85 / 32.00 / 105.18 m |

New tests: zero-seeded levels + cost curve, buyManagerLevel invariants
(hired-only, Legacy deduction, cap, short-reject), quantity scaling
(1 / 5 / max with the max stopping only when unaffordable), the prestige
reset regression, malformed-level sanitize/import clamping, pause + challenge
lock at level 3, and the card's level/Level-up sub-button.

### Pacing

**Bit-identical** — the bot only ever hires a level-0 manager (unchanged
quantity), and the second-room scenario pauses it anyway. Verified.

### Versioning

`VERSION` 0.11.8 / build 221 · `CHANGELOG` entry · **`SAVE_VER` unchanged (9)**
— `g.managerLevels` is additive (same pattern as `managerPaused`).

### Docs touched

`DESIGN.md` §21 (upgradeable managers), `SECOND_LOCATION.md` §4 (account-level
field table + code block), PR body.
