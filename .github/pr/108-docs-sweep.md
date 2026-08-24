## Summary

PR 8 of the post-polish roadmap (`.hermes/plans/2026-08-23_post-polish-roadmap.md`):
the closing docs sweep. After PRs 5–7 landed, a re-grep found the stale
references listed below. Doc-only — no behavior change, no `game.js`/
`catalogs.js` change, no `VERSION`/`SAVE_VER` move.

## Changes

**Genuine stale fixes (agent-discovered on re-grep):**

- `DESIGN.md` §header — "Spec target: … through 0.11.15 … (`game.js`
  v0.11.15)" was two minor versions stale. Bumped to 0.11.26 and added the two
  post-polish systems (ledger session strip, back-half flavor).
- `DESIGN.md` §12 header — the achievement-count lineage stopped at
  "density pass 0.11.23 (53)"; appended "challenge-tier pass 0.11.26 (57)".
- `pacing.mjs` `renownRun()` doc comment — said "gate at ~336 min / 13 cycles,
  renownGain ≈ 15" but the deterministic run is 311.70m / 12 cycles / +14 (the
  reference drifted in an earlier balance pass; PR #7 deferred this to the
  sweep). Corrected to 312m / 12 cycles / +14.

**Follow-on roadmap pointer:**

- `REPLAY_ROADMAP.md` §13 Doc history — added a self-contained row recording the
  post-polish roadmap (PRs #102–#108) as shipped. The `.hermes/plans/` file
  itself is git-ignored (local-only), so the note is in-tree rather than a
  broken link.

**Checked, no change needed:**

- `PRESTIGE.md` — the §7 apply-rules pin already reads `totalCashMult(g)`
  (with `cashIncomeMult(g) × achievementMult(g)` named as its inner factors), so
  there is no old-shape `cashIncomeMult` pin to fix.
- `PLAN.md` / `IMPLEMENTATION_PLAN.md` — these document earlier shipped work
  (the logic-fix plan and the stage-improvements plan). Neither references a
  constant/count changed by the post-polish roadmap, so a follow-on pointer
  there would be noise; the pointer lives in `REPLAY_ROADMAP.md` instead.

## Verification

- `node --check game.js && node --check catalogs.js && node --check pacing.mjs` PASS
- `node economy.test.mjs` — 307 passed, 0 failed (unchanged).
- `node pacing.mjs` (full local suite) — exit 0, all six milestone bands
  bit-identical (the only `pacing.mjs` change is a comment).

## Save version

**Unchanged (SAVE_VER 13).** No `VERSION`/`CHANGELOG` advance — doc-only.

## Files

- `DESIGN.md` (header + §12)
- `pacing.mjs` (comment)
- `REPLAY_ROADMAP.md` (§13 Doc history)
- `.github/pr/108-docs-sweep.md` (this body)
