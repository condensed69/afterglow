## docs: harden replay roadmap implementation contracts

Follow-up to #70. This remains documentation-only and closes the four high-priority
implementation gaps found in review before any replay-system code ships.

### What changed

- PR 3 now requires research prerequisites in `buyResearch()`, card availability,
  and pacing-bot candidate selection, with economy regressions for the locked and
  newly-unlocked states.
- PR 3 now requires every research-unlocked job to flow through catalog-driven
  initialization, sanitization, crew correction, assignment, club switching, and
  reset/import tests.
- PR 5 now explicitly preserves sanitized manager levels through ordinary prestige
  and tests manager, pause, and level persistence; only franchise sale wipes them.
- PR 6 now owns economy/save regressions for v9 migration, the full destructive
  reset matrix, Renown accrual, and persist-before-replace failure atomicity. The
  later pacing scenario is expressly additional rather than deferred coverage.

### Docs touched

| File | Change |
|------|--------|
| `REPLAY_ROADMAP.md` | Tightens PR 3, PR 5, and PR 6 implementation/test contracts. |
| `.github/pr/71-replay-roadmap-review-fixes.md` | Durable body for this follow-up PR. |

No other docs change because this follow-up only corrects the unshipped roadmap;
it does not change current systems, constants, player controls, or behavior.

### Verification gates

| Gate | Result |
|------|--------|
| `node --check game.js` | pass |
| `node economy.test.mjs` | pass |
| `node pacing.mjs` | pass |

### Version / save format

- `SAVE_VER` does not move; it remains 9. PR 6 still owns the future v10 bump.
- `VERSION`, visible build number, and `CHANGELOG` do not move because this is a
  documentation-only correction with no behavior change.
