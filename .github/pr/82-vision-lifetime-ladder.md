# PR 82: Vision Retarget — Lifetime-Value Ladder with a Real Payoff

## Summary
Replaces the impossible endgame goal (3 clubs + $1e12 net worth — probe-measured ~3.6 sim-years past a decked account) with a cumulative **lifetime-value ladder**: gross cash earned across all time, $10M / $100M / $1B rungs, each granting a **permanent all-cash bonus** (+1% / +1% / +2%, **+4% total**). The goal line the whole game points at is now reachable by playing, survives every reset (prestige, challenge starts, and the franchise sale), and pays real money — not a dead readout.

## Changes

- **game.js**:
  - New `g.lifetimeEarned` — monotonic account-level accumulator of gross cash earned (net cash + wages per sim slice, the away-report semantics). Credited **exactly once per slice** in `step()` and once per slice in `catchUp()` (offline accrues at its scaled rate). Deliberately NOT crediting active clicks/whale/golden — the ladder measures the business's sim-driven earning power.
  - New `VISION_TIERS` (1e7 / 1e8 / 1e9) + derived `visionBonus(g)` / `lifetimeEarned(g)` — the bonus is computed from the accumulator on every read at the single `totalCashMult` composition point, so **no per-tier state exists to re-fire or desync**.
  - `totalCashMult(g)` now folds in `(1 + visionBonus(g))` — ×1.0 on the pacing bot's path (probe-pinned, below).
  - Reset survival: `lifetimeEarned` snapshot/restored in `confirmPrestige`, `startChallenge`, and `confirmFranchiseSale` — lifetime is the brand's cumulative footprint, not run state.
  - Save shape: **SAVE_VER 12 → 13**, `MIGRATIONS[12]` (no-clobber; missing/malformed → 0 — history cannot be reconstructed, the ladder starts measuring now). Fail-closed reads in `sanitizeG` / `completeImportedG` / `lifetimeEarned(g)`.
  - Owner's List "Vision — the long game" block: `Lifetime value $X / $1B`, three star markers (gold when crossed), `next ★ at $Y (+N% all cash)`, progress bar vs the top target.
  - **Sim-loop FP-residue guard** (exposed by the new accrual test): a whole-second `step(1)` with `SIM = 0.1` left a ~1.4e-16 remainder that ran a phantom extra slice (full `rates()`/`autoBuyManagers`/`noteGoals`/`checkAchievements` pass at 1e-16s of time). Sub-1e-9s residue is now clamped, keeping per-slice crediting exactly 1:1 with `rates()` calls.
  - VERSION 0.11.15 / build 228 + CHANGELOG entry.

- **economy.test.mjs** (+244): SAVE_VER-13/migration map, the reworked horizon readout test (stars / next tier / pct / bonus; net worth no longer feeds the Vision), step() single-credit accrual, catchUp() at the away-report rate, reset survival (prestige/challenge/sale), sanitize/import fail-close parity, v12→v13 migration no-clobber, tier boundaries through `totalCashMult` (derived, never re-fires, writes no state), `visionBonus` folding into `rates()`, and a bot-path silence test (1 simulated hour stays under ★1). `lifetimeEarned` added to `ACCOUNT_FIELDS`.

- **pacing.mjs**:
  - New **`endgameProbe()`**: plays the plain reference bot for the FULL 8h wall cap (run() stops at ~105 min — the honest bound is the most the bot could ever earn) and asserts lifetime earned stays **strictly below ★1 ($10M)** and `visionBonus` is exactly 0 — so the ×1.0 factor holds at every instant of every scenario and every band is bit-identical to 0.11.14.
  - `renownRun()` now asserts the prestige-loop lifetime stays below ★1 at the gate (the sale loop's bound, asserted separately from the plain-bot bound) and logs the gate lifetime.

- **Docs** (same PR, per repo convention):
  - `DESIGN.md` §23 rewritten (Vision lifetime-value ladder + the still-valid §10 pacing guard), §13.1 shape block + §13.4 migration table (incl. the previously-missing 10→11 / 11→12 rows).
  - `README.md` Vision section (0.11.11 → 0.11.15).
  - `REPLAY_ROADMAP.md` §12 PR-8 supersede note + §13 history row.
  - `PRESTIGE.md` §3/§10.1/§10.3 persist tables + internal ids for `lifetimeEarned`.

## Verification
All three gates pass (re-run after the last change — the tree moved):
- `node --check game.js` ✅
- `node economy.test.mjs` → **300 passed, 0 failed** ✅
- `node pacing.mjs` → all milestones within band, Renown scenario passes, `endgameProbe` passes ✅

## Save Version
**SAVE_VER 12 → 13** — new persisted field `g.lifetimeEarned`. `MIGRATIONS[12]` no-clobber: v12 saves default it to 0 (history before 0.11.15 cannot be reconstructed — the ladder starts measuring now, which is the documented migration semantics). Backward compatible: existing v12 localStorage saves load, migrate, and keep playing.

## Docs Updated
- DESIGN.md §23, §13.1, §13.4
- README.md (Vision section)
- REPLAY_ROADMAP.md §12, §13
- PRESTIGE.md §3, §10.1, §10.3
- game.js CHANGELOG + VERSION

## Spine Invariant
**The prestige loop is the spine — this deepens the run.** Lifetime value accumulates *through* the sale loop (survives every reset), so each new franchise cycle moves the ladder forward and the +4% all-cash payoff rewards the "build, sell, build again" rhythm that the post-§9 game is built around. Bonus is cash%, not Renown — a Renown grant on crossing would cannibalize the sale loop (documented rejection). No pacing bands shift: the deterministic bot's full-8h lifetime stays strictly below ★1 (probe-pinned), so the bonus factor is exactly ×1.0 on every bot path.