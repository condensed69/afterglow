# PR 94: Test-suite liveness — progress output, wall-clock budget, `--fast` mode

Closes #92.

## Summary

Issue #92 reported that `economy.test.mjs` and `pacing.mjs` "hang with zero
output." The issue thread's later comments corrected the diagnosis with CI
evidence: the suites **complete** (economy ~2m, pacing ~6m on the CI runner) —
they are slow, not deadlocked — and the wrong artifact was the `gates.yml`
comment claiming "~10s." But the deeper problem stands: a *real* regression
would be indistinguishable from this slowness on a runner with a timeout, and
`pacing.mjs` printed literally nothing until its first full sim returned.

This PR implements the three fixes the issue's review comment (`#5360999809`)
recommended, in that priority order:

1. **Progress output** — both harnesses now flush every line to stdout
   synchronously (`writeSync(1, …)` via a `console.log` override), because on
   POSIX `console.log` to a pipe is asynchronous and can buffer — exactly how a
   slow sim reads as "zero output" in CI. `pacing.mjs` additionally prints each
   milestone **as it lands** inside `simulate()` (not only in
   `reportMilestones()` after the sim returns), on top of the existing per-run
   banners and per-simulated-hour heartbeat. `economy.test.mjs` keeps its
   per-night heartbeat in the 10-night §3 sim, now actually flushed.

2. **Wall-clock budget** — a shared `withBudget(name, ms, fn)` helper wraps each
   scenario; the deadline is checked with `Date.now()` inside the sim loop (per
   simulated second, ~free next to the `step(1)` it guards), and an overrun
   exits `2` with a clear, attributable message instead of sitting silent until
   the job's own timeout. Default 5 min/scenario, `PACING_BUDGET_MS` overrides.

3. **`--fast` mode** — `node pacing.mjs --fast` (or `PACING_FAST=1`) skips the
   two full-cap scenarios, `endgameProbe()` (unconditional 8h cap) and
   `renownRun()` (franchise gate, ~5.6h sim). `run()` / `prestigeRun()` /
   `secondRoomRun()` early-exit at their milestones and stay. `gates.yml` now
   runs the pacing step in `--fast` mode (~2m vs ~6m); the full five-scenario
   suite remains the local gate.

## Approach

All three changes are **output- and process-control only** — no sim-loop logic,
no game state, no balance, no save shape. `simulate()` still runs `botSecond()`
+ `game.step(1)` per simulated second, unchanged; the new milestone lines and
the budget check are pure reads (a `Date.now()` vdso call). Pacing stays
deterministic and bit-identical to 0.11.14 — the milestone *hit values* and exit
codes are unchanged, only the surrounding log lines differ.

Deliberately **not** done (per the review):

- **`SIM_HOURS` is untouched.** Lowering it would weaken `endgameProbe()`'s
  "full 8h cap lifetime < ★1" assertion and `renownRun()`'s 2h–8h band.
- **The whole-second `step(1)` optimization is deferred** — it is a `game.js`
  sim-loop change needing its own equivalence argument and PR, not this issue.

## Verification

All three gates run locally on this branch:

- `node --check game.js` ✅ (also `node --check` on both harnesses)
- `node economy.test.mjs` → **301 passed, 0 skipped, 0 failed**, exit 0 ✅
- `node pacing.mjs` (full, all five scenarios) → exit 0; reference bot, prestige,
  second-room, renown (franchise sold at ~312m, within the 2h–8h band), and
  endgame probe all pass ✅
- `node pacing.mjs --fast` → exit 0, ~2m ✅
- Budget bites: `PACING_BUDGET_MS=1 node pacing.mjs --fast` → exit **2** with
  `❌ reference bot: wall-clock budget … exceeded` ✅

New output is visible mid-run: per-milestone `✓ … @ X (band lo–hi)` lines and
per-hour `… wall X/480 (night N)` heartbeats during every long sim, and the
economy §3 stretch prints `… night N/10`.

## Save version

**Unchanged (SAVE_VER 13).** This is CI/infra and test-harness observability
only — no persisted state, no behavior, no balance, no `VERSION`/`CHANGELOG`
bump.

## Docs updated

- `AGENTS.md` — noted that CI's `pacing` step runs `--fast` (skipping the two
  full-cap scenarios), that the full five-scenario suite remains the local
  gate, and that each scenario has a wall-clock budget (default 5 min,
  `PACING_BUDGET_MS`) with exit `2` on overrun.
- `.github/workflows/gates.yml` — corrected the "~10s" comment to measured
  figures and switched the pacing step to `--fast`.
- No other doc references the changed constants (grep of `DESIGN.md` /
  `PLAN.md` / `PRESTIGE.md` / `README.md` / `SECOND_LOCATION.md` /
  `REPLAY_ROADMAP.md` / `IMPLEMENTATION_PLAN.md` for `--fast`, wall-clock budget,
  heartbeat interval, and runtime figures returned only pre-existing `pacing.mjs`
  scenario references).

## Files

- `.github/workflows/gates.yml`
- `.github/pr/94-suite-progress.md` (this body)
- `AGENTS.md`
- `pacing.mjs`
- `economy.test.mjs`
