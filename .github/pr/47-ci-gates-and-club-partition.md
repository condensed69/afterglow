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

### 3. Fixed a pre-existing ~5% flake that CI found on its first run

Not caused by this PR — CI surfaced it, which is the argument for having CI.

`offline65 increases catchUp earnings over the same window` compares two `catchUp(g, 60)`
arms. That window crosses a shift boundary, and `advanceShift` (`game.js:1451`) rolls
`SPECIAL_CHANCE` there. Unstubbed, the two arms draw different shift schedules; when a
low-multiplier special lands on the *boosted* arm it earns **less** than the base arm and the
assertion fails. Instrumented over 40 runs, 5 rolled a special and one inverted the result:

```
35×  base 32.138  boosted 41.166  baseSpecial=null  boostSpecial=null
 2×  base 32.138  boosted 37.158  baseSpecial=null  boostSpecial=1
 1×  base 32.138  boosted 27.136  baseSpecial=null  boostSpecial=2   ← fails
 1×  base 28.991  boosted 41.166  baseSpecial=1     boostSpecial=null
 1×  base 21.123  boosted 41.166  baseSpecial=2     boostSpecial=null
```

The fix uses `withRandom`, already in the file and already documented as existing "to make
the special-shift trigger deterministic" — this test just never used it. With no special on
either arm, the comparison isolates the 0.5 → 0.65 offline rate, which is what it claims to
measure.

### 4. And a second, CI-only flake — `init backfills achievements`

This one recurred on a second CI run after never failing in 110+ local runs, which is what
promoted it from noise to a defect.

The test writes a save with `ts: Date.now()` and immediately calls `init()`. `init` computes
`offline = (now - g.ts) / 1000` with **no minimum threshold** (`game.js:1068`), so the gap is
however long the harness happened to take. Sub-millisecond locally; on a loaded runner it is
long enough to run a real `catchUp` and move `clout` off its exact expected value. Injecting a
3s gap reproduces the CI failure on the first try.

Fixed with a new `withFrozenNow` helper: the test picks its own gap by writing `ts: t - 1000`
against a frozen clock, so the window is exactly 1s every run regardless of runner load.

**A finding along the way, worth recording:** the first attempt froze the clock with the gap
at 0 and the test failed *100% of the time* — because the load-time achievement backfill lives
inside `init`'s `if (offline > 0 && claimed)` branch. A save loaded with no measurable gap
never gets backfilled at all. The test was silently relying on real elapsed time to reach the
code it was testing. The 1s gap is deliberate for that reason, and it is now commented.

Whether the backfill *should* depend on `offline > 0` is a real question about `game.js`, not
about this test — left alone here rather than widened into a behavior change.

### Flake measurements

| Tree | Runs | Failures |
|------|------|----------|
| `main` @ `cb3073c`, unmodified | 60 | 3 — all `offline65` |
| this branch, after both fixes | 60 | 0 |

This mattered enough to fix here rather than defer: a required check that fails ~5% of the
time teaches everyone to hit re-run, and `AGENTS.md` "When a gate fails" explicitly forbids
re-running an unchanged gate. A flaky required check makes that rule unfollowable.

### Verified the partition test actually fires

Added an unassigned `vipLounge: 0` to `fresh()`, the way a developer would add a field
without deciding which side it belongs on:

```
FAIL  SECOND_LOCATION field lists partition fresh() with nothing unassigned
      fresh() field not assigned club-level or account-level in SECOND_LOCATION.md §4: vipLounge
Results: 200 passed, 1 skipped, 1 failed
```

`game.js` was restored; it is unchanged in this PR.

### What this still does not cover

- **`_specialShift` and `_whaleCooldown` are enforced by nothing.** The coverage test asserts
  every key `fresh()` produces is assigned to a side; it does not assert every *listed* field
  exists. `freshClub()`'s key-set check filters `_`-prefixed names out on purpose, since they
  are lazily created. So those two entries in `CLUB_FIELDS` can go stale silently. Accepted:
  the alternative is asserting on fields that legitimately may not exist yet.
- **This stops broken code reaching `main`. It does not stop an agent thrashing on a branch.**
  The reverted attempt's other failure mode was looping on failures until a guardrail tripped.
  Nothing here addresses that; `AGENTS.md` "When a gate fails" is still the only thing aimed
  at it, and it is still a document.
- **Other tests may share the `offline > 0` dependency.** Only the two tests that actually
  failed were audited. A sweep for tests that write `ts: Date.now()` and then call `init()`
  would likely find more latent clock coupling; not done here.

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
