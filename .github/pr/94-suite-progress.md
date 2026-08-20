# PR 94: Test-suite liveness — progress heartbeats + honest gates.yml timing

Closes #92.

## Summary

Issue #92 reported that `economy.test.mjs` and `pacing.mjs` "hang with zero
output." The newest comment on the issue corrected the diagnosis with CI
evidence: the suites **complete** (economy ~2m, pacing ~6m on the CI runner),
they are just slow, and the genuinely wrong artifact is the `gates.yml` comment
claiming "~10s." A future real regression would look identical to this slowness,
and the "~10s" figure would mislead anyone tuning the budget.

This PR is the "sharpen the tool" fix, not an outage fix — no game behavior,
save shape, or balance changes:

1. **`gates.yml`** — replace the "~10s" comment with the measured figures
   (~2m economy / ~6m pacing, Node 22, PR91/PR93 CI runs), so the 10-minute
   budget is documented against reality.
2. **`pacing.mjs`** — add a per-simulated-hour progress heartbeat inside
   `simulate()`, and move the `run()` / `prestigeRun()` banners ahead of their
   long sims. Before this, the first ~minutes of the suite printed **zero
   output**; now every long sim logs liveness lines like
   `… wall 60.00m/480.00m (night 23)` and each scenario announces itself before
   running.
3. **`economy.test.mjs`** — add a per-night heartbeat in the 10-night
   simulation of §3 (the exact stretch the issue noted as "stalls past
   section 3"), so the slow spot prints `… night N/10` instead of sitting
   silent for ~2m.

## Approach

The heartbeat is deliberately output-only and **does not touch the sim loop's
logic**: `simulate()` still runs `botSecond(game)` + `game.step(1)` per
simulated second, unchanged. The only new state is a `lastBeat` counter and an
`opts.beatEvery` override (default 3600 simulated seconds), so no scenario's
timings, milestone hits, or stop conditions are affected. Pacing stays
deterministic — the heartbeat prints to stdout, never reads or writes game
state.

## Verification

All three gates run locally on this branch:

- `node --check game.js` ✅ (also `node --check` on both harnesses)
- `node economy.test.mjs` → **301 passed, 0 skipped, 0 failed** ✅
- `node pacing.mjs` → all milestones within band; Prestige, Second-room, Renown
  scenarios + Endgame probe all pass ✅

The new heartbeats are visible in the output: economy prints `… night 1/10 …
10/10`; pacing prints `… wall 60.00m/480.00m (night 23)`-style lines during each
long sim and the scenario banners now precede their work.

## Save version

**Unchanged (SAVE_VER 13).** This is a CI/infra and test-harness observability
change only — no persisted state, no behavior, no balance, no VERSION/CHANGELOG
bump.

## Docs updated

None. The changed constant (the heartbeat interval) is internal to the test
harness and the `gates.yml` timing comment is not referenced by any doc
(verified by grep — DESIGN.md / PLAN.md / PRESTIGE.md / README.md carry no
"~10s" or runtime figures). `AGENTS.md` gate commands are unchanged.

## Files

- `.github/workflows/gates.yml`
- `pacing.mjs`
- `economy.test.mjs`
- `.github/pr/94-suite-progress.md` (this body)