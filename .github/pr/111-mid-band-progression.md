## Summary

Ultra-review fix plan PR 2/3 — the one real code change (W2). Gives the
105.18m→311.70m dead zone (all-research → franchise gate) a visible
progression hook. During this stretch the player prestige-cycles to ~105
Legacy (max perks + all managers); the gate itself is 311.70m/12 cycles on
the bot.

**Spine claim:** *deepen a run* — new collectible targets inside the
prestige grind, without shortening the franchise gate.

## Changes

- **catalogs.js** — 4 achievements after `endorse_50`:
  - `prestige_15` "Franchise Habit" `g.prestiges ≥ 15` → 3 Legacy
  - `prestige_25` "Dynasty" `g.prestiges ≥ 25` → 6 Legacy
  - `legacy_125` "Century Club" `g.legacyTotal ≥ 125` → 4 Legacy
  - `legacy_250` "Old Money" `g.legacyTotal ≥ 250` → 8 Legacy
  - All Legacy-only (Legacy-not-Clout rule); credit both `g.legacy` AND
    `g.legacyTotal` per 0.9.5 accounting. No save field → **SAVE_VER stays 13**.
    Keyed on monotonic account counters the plain pacing bot never advances
    (it never prestiges), so **main milestone bands stay bit-identical**.
  - `prestige_15` + `legacy_125` fire *inside* the 105m→311m dead zone (re-
    classified from 10/100 to 15/125 after 11-cycle renown at 287.70m breached
    mid-band ±5% band; at 15/125 the 11-cycle run stays clean);
    `prestige_25` + `legacy_250` extend past the first sale. Firing path:
    `confirmPrestige` sets `legacyTotal` before `checkAchievements(next)`.

- **game.js** — `VERSION 0.11.26/239 → 0.11.27/240`, `CHANGELOG` entry at top
  (milk ceiling +53%→+57%, SAVE_VER 13, main bands bit-identical,
  re-classified from 10/100 to 15/125 to keep 11-cycle renown green).

- **economy.test.mjs** — same commit (AGENTS.md):
  1. catalog-size `57 → 61` "catalog grew 57 → 61 (ultra-review mid-band pass)"
  2. milk `1.53x → 1.57x` "1.57x at all 61 (57 non-burst)"
  3. reachability sweep: `newIds` +4, fixture `g.prestiges=25; g.legacyTotal=250;`,
     Legacy totals `73 → 94` (+21 = 3+6+4+8, re-derived not hardcoded)
  4. no other pinned `57/53/1.53` counts found (reset-matrix is account-wide,
     already covered).

- **DESIGN.md §12** — header `…0.11.26 (57) → …0.11.26 (57), mid-band pass
  0.11.27 (61)`, new bullet for 0.11.27, milk ceiling +53%→+57% (53→57
  non-burst), prose "At the full 57 deterministic…".

- **README.md** — `## Achievements (0.11.27)` 57→61, +53%→+57%. Also picks up
  the N1 tagline fix ("A neon-noir…" already on PR #109) so the branch is
  self-consistent even before #109 merges; no conflict when both land.

- **pacing.mjs** — NOT touched in this PR. The `ENDGAME_BUDGET_MS` headroom
  fix landed in PR #110 (N9, merges first); #111 inherits it from `main` at
  rebase — no duplicate, no merge conflict. Wall-clock only, no band change.

## Pacing guard (mandatory)

Before: `node pacing.mjs` on `e677459` — rail 1.53m / patrons 5.70m / crew
7.70m / LED 14.35m / research 19.85m / all-upgrades 32.00m / all-research
105.18m, franchise 311.70m/12 cycles/ +14 Renown, mid-band 311.70m, exit 0.

After (this branch, run alone, no concurrent node):

- **Main milestones — bit-identical** (hard gate):
  `1.53 / 5.70 / 7.70 / 14.35 / 19.85 / 32.00 / 105.18m` ✅
  (reference bot section: all 7 milestones PASS, see `node pacing.mjs` log)

- **Renown scenario — green, bit-identical after re-classify** (at 15/125
  the 11-cycle run stays clean, no low-threshold milk bump):
  gate 311.70m/12 cycles, +14 Renown, lifetime ~$1.55M (< ★1 $10M), rooftop
  control ~11.58m → extras ~7.10m ✅ (re-classified from 10/100 which had
  accelerated to 287.70m/11 cycles and breached mid-band)

- **Mid-band / endgame — green** (mid-band ±5% around 311.70m, endgame
  `visionBonus +0%` and `★1 > lifetime` probe):
  mid-band ✅ at 311.70m; endgameProbe ✅. Note: with the default 5-min
  budget the probe flakes on wall-clock (~97% through the 8h cap) — the
  +4 catalog entries add per-slice CPU. This is the exact N9 flake PR #110
  already fixes (`ENDGAME_BUDGET_MS = max(PACING_BUDGET_MS || 5m, 7m)`);
  CI runs `--fast` and skips the probe, and #110 merges first, so #111
  inherits the 7m probe budget on `main`. Verified locally green under
  `PACING_BUDGET_MS=420000` (matching #110's headroom semantics).

If any main band had moved, the plan requires STOP + re-classify (raise
threshold). It didn't — `prestige_15/25` + `legacy_125/250` are bot-
unreachable on the plain run.

## Gates

Run sequentially (never concurrent; endgame probe budget is tight):

- `node --check game.js` — pass
- `node --check catalogs.js` — pass
- `node economy.test.mjs` — 307 passed
- `node pacing.mjs` — main bands bit-identical, renown/mid-band/endgame green

## Docs

`DESIGN.md`, `README.md` — same commit (docs ship with the feature).

## Versioning

`VERSION 0.11.27 / build 240`, `SAVE_VER stays 13` (no save-shape change).
`CHANGELOG` top entry describes the 4 achievements, Legacy-only, milk
+57%, and the pacing note.

## Plan

`.hermes/plans/2026-08-23_ultra-review-fixes.md` — PR 2/3 (PR 1 #109 and
PR 3 #110 already open and green; this is the pacing-sensitive PR, last).

## Re-classify fallback

If mid-band/renown breaks in review, raise thresholds (e.g. prestige_15)
or key only on legacyTotal at a level the 12-cycle renown run doesn't
reach. Measure, don't guess.
