# PR 6 — Second prestige layer: Franchise → Renown (SAVE_VER 10)

Implements `REPLAY_ROADMAP.md` §8: the second prestige layer, unlocked once the
first layer is exhausted. When **every prestige perk is maxed, every manager is
hired, and both clubs are unlocked**, the Perks panel gains a gate-aware
**"Sell the franchise"** control — a national conglomerate buys the whole
operation.

## What ships

**Mechanic**
- `renownGain(g)` = `floor(√lifetime Legacy + prestiges/3)` — mirrors
  `legacyGain`'s shape, account-wide (lifetime Legacy, not the active club's run).
- `franchiseGate(g)` — account-level gate: all `PRESTIGE_PERKS` at max rank
  **and** all `MANAGERS` hired **and** `g.clubs` owns both `main` and `annex`.
- `confirmFranchiseSale()` — **two-click armed** (`state.franchiseArmed`,
  mirroring the reset button), **persist-before-replace** like `confirmPrestige`
  (a `setItem` throw → `saveState: 'franchise failed'`, live state untouched).
- Reset scope (§8.4): wipes both clubs (annex re-locks, `activeClub` → `main`),
  Legacy/legacyTotal/perks/prestiges, Clout/research, managers/managerPaused/
  managerLevels, crew/jobs, challenges, goals/clicks/rounds, burst counters.
  Persists: `renown`/`renownTotal` (+= gain), achievements, `brand` ranks.
- Renown **never wipes** — verified by test across a second sale, and by the
  pacing scenario selling at +14.

**Save shape (SAVE_VER 9 → 10)**
- `fresh()`: `renown: 0, renownTotal: 0, brand: {}`.
- `MIGRATIONS[9]` — no-clobber defaults (identical to the §8.5 sketch).
- `sanitizeG` + `completeImportedG` fail-closed on malformed values (non-numeric
  → 0, clamped ≥ 0; non-object `brand` → `{}`); import/load never require the
  fields, so all pre-v10 saves upgrade in place — no data loss.
- `metaUnlocked` (Perks tab / Legacy ledger) also opens on `renownTotal > 0`.

**UI (Perks panel)**
- Renown readout card after the first sale (`N spare · M lifetime`).
- Cyan "Sell the franchise" card at gate, previewing `+N Renown`; modal shows
  the keep/reset scope, two-click confirm, disabled while `tabStale`.

## Gates (all run locally, same as CI)

| Gate | Result |
|------|--------|
| `node --check game.js` | ✅ |
| `node economy.test.mjs` | ✅ 271 passed, 0 failed (10 new PR-6 tests: gate, formula, migration no-clobber, v9-import upgrade, sanitize fail-closed, full §8.4 reset matrix, gate-as-invariant, setItem-throw atomicity, card visibility, modal bindings) |
| `node pacing.mjs` | ✅ all bands + prestige + second-room + **`renownRun()`** (new): gate at 311.7 m sim / 12 cycles (band 2h–8h), +14 Renown on sale, 30 achievements kept, annex re-locked |

## Docs touched

- `DESIGN.md` §9.2 (new spec), §13.1 heading + field list, §13.2 wording,
  §13.4 migration row, header "Spec target".
- `PRESTIGE.md` new §10 (full locked spec, mirrors the doc's structure);
  Challenge runs renumbered §10 → §11 (content untouched).
- `SECOND_LOCATION.md` §4 account-field list.
- `REPLAY_ROADMAP.md` §12 ticks PR 1 + PR 6 (`renownRun()` ships with the layer
  rather than waiting for PR 8).

## SAVE_VER

**Bumped 9 → 10** — new persisted fields (`renown`, `renownTotal`, `brand`)
with `MIGRATIONS[9]`, fail-closed normalize, and no-clobber upgrade for every
existing save. Verified by the v8→current and v9→v10 migration tests.