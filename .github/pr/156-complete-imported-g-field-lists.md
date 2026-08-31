## Summary

`completeImportedG` rebuilt two 11–13 element field-name arrays on every
import/load. This extracts them to module-level `Object.freeze` constants
(`FLAT_RUN_FIELDS`, `STRAY_FIELDS`) and replaces the hybrid-shape stray
check's `.filter(...).length` with `.some(...)`.

Semantics are unchanged: a v9 body that also carries flat leftovers still
fail-closes.

## Why

Not a hot path — this runs once per import/load, not per 10 Hz tick.
N is fixed at 11–13, so this is churn reduction (one small alloc per
import), not an algorithmic win. Earlier drafts of this PR claimed O(1)
lookups, O(N²), and a 10k-iteration ~4% hot-path gain; those claims were
wrong and are not repeated here.

## Gates

- `node --check game.js` — pass
- `node economy.test.mjs` — 323 passed, 0 skipped, 0 failed
- `node pacing.mjs` (full five-scenario) — pass, bit-identical milestones
  (rail 1.53m, crew 7.70m, LED 14.35m, research 19.85m, all-upgrades 32.00m,
  all-research 105.18m, franchise gate 311.70m, lifetime $5.45M / 54.5% of ★1)

## Documentation and save compatibility

- Docs touched: this PR body only. No constant, count, or system change.
- `SAVE_VER` unchanged (13): no persisted field or save-shape change.
- `VERSION`/`CHANGELOG` unchanged: no behavior change.

## Cleanup

Rebased onto current `origin/main` (`285bf39`). Four duplicate Jules
commits on a stale `0a6380e` base collapsed to one commit. Three-dot
diff vs `main` is `game.js` plus this body file.
