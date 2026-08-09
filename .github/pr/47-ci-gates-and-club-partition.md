## ci: run the three gates in CI + arm the second-location field partition

Two things that were documented as rules but enforced by nothing.

### 1. The gates never ran anywhere but on an agent's own machine

`AGENTS.md` has required `node --check game.js`, `node economy.test.mjs`, and
`node pacing.mjs` since it was written. Before this PR:

- no workflow ran any of them — `.github/workflows/` had only `claude-code-review`,
  `opencode`, and `pages`;
- `main` had **no** `required_status_checks`;
- `required_approving_review_count: 0` and `enforce_admins: false`.

So a PR that failed all three gates could be opened and merged, and every `gates: pass`
table in every prior PR body — including the ones I wrote — was an unverified self-report.

`gates.yml` runs all three on every PR and every push to `main`. No install step: the repo
is dependency-free by invariant, and if a gate ever needs npm that is a design decision, not
a CI fix.

### 2. The field-partition guard now ships before the implementation

The reverted multi-club WIP died on a `clubFields` / `freshClub()` mismatch — `crew` and
`jobs` are shared roster and stay top-level, but the two lists disagreed. The brief in
`.github/briefs/` asked the implementer to write a guard against that. Asking the
implementer to write their own guard is the honor-system pattern #46 removed, so the guard
is here instead:

`CLUB_FIELDS` and `ACCOUNT_FIELDS` are transcribed from `SECOND_LOCATION.md` §4, plus three
tests:

| Test | State today |
|------|-------------|
| lists are disjoint and cover every key `fresh()` produces | **active** |
| `crew`/`jobs` top-level, never inside a club | **active** |
| account/club split + `freshClub()` key-set equality | **skipped** — arms when `g.clubs` appears |

The third reports as `skip`, not `pass`, on purpose: counting unarmed coverage as green
misstates what the suite checks.

### Verified the partition test actually fires

Added an unassigned `vipLounge: 0` to `fresh()`, the way a developer would add a field
without deciding which side it belongs on:

```
FAIL  SECOND_LOCATION field lists partition fresh() with nothing unassigned
      fresh() field not assigned club-level or account-level in SECOND_LOCATION.md §4: vipLounge
Results: 200 passed, 1 skipped, 1 failed
```

`game.js` was restored; it is unchanged in this PR.

### Docs touched

| File | Change |
|------|--------|
| `AGENTS.md` | Verification gates: CI runs them, they are required checks, a body table is a claim and the check run is the evidence. |
| `.github/briefs/second-location-implementation.md` | The guard is inherited, not written; the skipped test going green is commit 1's definition of done; changing the constants requires changing §4 in the same commit. |

### Verification gates

| Gate | Result |
|------|--------|
| `node --check game.js` | pass |
| `node economy.test.mjs` | pass — 201 passed, 1 skipped, 0 failed (199 before; +2 active, +1 armed-later) |
| `node pacing.mjs` | pass — all milestones in band |

### Version / save format

No `VERSION` / build / `CHANGELOG` bump: CI, tests, and docs only. `game.js` is unchanged.
`SAVE_VER` stays 8 — it moves to 9 in the second-location work this PR prepares for.
