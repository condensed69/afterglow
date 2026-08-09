# Brief: implement SECOND_LOCATION.md in two commits

**For:** the implementing agent (Hermes) · **Written by:** Claude · **Base:** `main` @ `9604b74`

The design is merged (`SECOND_LOCATION.md`, PR #42). The earlier WIP attempt at this was
reverted — it is not on `main` and must not be resurrected. Start from `main`.

Read `SECOND_LOCATION.md` in full before writing code, especially §3 (what is shared vs.
per-club), §4 (club shape), §5 (simulation), and §13 (checklist). This brief does not
restate the design; it states the sequencing and the traps.

---

## Split the work into two commits, in this order

### Commit 1 — save shape and routing only. No second club, no new UI.

Introduce `g.clubs`, `g.activeClub`, the `club(g)` accessor, and the `MIGRATIONS[8]` step.
Route every existing read and write of club-level state through `club(g)`. Ship exactly one
club, always active. Player-visible behavior must be **identical** before and after.

This commit moves `SAVE_VER` 8 → 9.

Done when: the whole existing suite passes unmodified, plus a new v8 → v9 migration test,
and `node pacing.mjs` produces the same milestones it does today. If pacing moves in commit
1, something that should have stayed shared got moved into the club.

### Commit 2 — the feature.

Unlock gate, second club, switcher UI, per-club Owner's List handling, achievements,
`pacing2.mjs` `second-room` scenario. Balance lives here, not in commit 1.

Splitting this way means that if the feature has to be reverted, the save migration does not
have to be, and a pacing regression is unambiguously attributable to one of the two.

---

## The trap that broke the last attempt

The reverted WIP had a **`clubFields` / `freshClub()` mismatch**: `freshClub()` created
fields that the migration's field list did not move (or the reverse). The two must be
derived from one another, or they will drift again.

Concretely, the boundary that got this wrong:

- **`crew` and `jobs` are shared roster.** They stay **top-level on `g`**. They are not in
  `clubFields` and `freshClub()` must not create them. See `SECOND_LOCATION.md` §3
  "Shared roster (top-level…)".
- `b` (buildings) and `u` (upgrades) **are** club-level.
- `r` (research), `perks`, `legacy`, `legacyTotal`, `prestiges`, `clicks`, `rounds` are
  account-level.

**This guard already exists — you inherit it, you do not write it.** `economy.test.mjs`
carries `CLUB_FIELDS` and `ACCOUNT_FIELDS` transcribed from §4, and three tests:

- the two lists must be disjoint and must account for **every** key `fresh()` produces, so
  adding a field without deciding which side it belongs on fails the suite;
- `crew`/`jobs` must be top-level and must never appear inside a club;
- the moment `g.clubs` exists, the third test arms itself — account fields must not leak
  into a club, club fields must not remain top-level shadowing the club copy, and
  `freshClub()`'s key set must equal `CLUB_FIELDS`.

That third test reports as **skipped** today. Your commit 1 is what turns it green. If it is
still skipping when you open the PR, `g.clubs` is not wired up the way the design says.

If you believe a field belongs on the other side of the split, change `SECOND_LOCATION.md`
§4 and the constants together, in the same commit, and say why in the PR body. Do not edit
the constants alone to make the suite quiet.

## Four more places this will bite

1. **`isValidSavePayload`** (`game.js:819`) hard-requires `cash`, `hype`, `buzz`, `patrons`,
   `regulars`, `crew` as finite numbers **on `g`**. Once those move into `g.clubs[id]`, a
   legitimate v9 payload fails validation and gets wiped. Relax it to accept either shape —
   validation runs *before* migration, so it must tolerate both v8 and v9. `crew` and `jobs`
   stay top-level in both, so leave those checks alone.

2. **`sanitizeG`** (`game.js:762`) must fail closed on `g.clubs`: reject arrays and non-objects,
   reconstruct a valid club rather than trusting the payload, and guarantee `g.activeClub`
   names a club that exists. Follow the existing `perks`/`managers` precedent in that method —
   they already do exactly this.

3. **`setActiveClub`** must rebalance crew **cap-aware**. Crew is shared, so switching clubs
   can leave assignments exceeding the new club's job caps. `sanitizeG` already has the
   over-assignment drain loop; reuse that logic rather than writing a second one.

4. **Owner's List goals `backstage` and `roster` straddle the boundary.** `backstage` reads
   `g.b.vip` (club) **and** `g.jobs.vipjob` (shared); `roster` reads `g.b.dress` (club) **and**
   `g.crew` (shared). A blanket `g.x` → `club(g).x` substitution silently breaks both. The
   full 14-goal source table is `SECOND_LOCATION.md` §6 — use it, do not re-derive.

---

## Gates and repo rules

All three must pass before opening the PR (`AGENTS.md`):

```
node --check game.js
node economy.test.mjs
node pacing.mjs
```

- `SAVE_VER` moves 8 → 9 **in commit 1**, and the PR body must say so and why.
- `VERSION`, the visible build number, and `CHANGELOG` advance together. Rebase onto `main`
  and renumber above whatever landed while you worked — never merge both `CHANGELOG` entries.
- Docs ship in the same PR: `DESIGN.md`, `PRESTIGE.md` (§8 already points here), `PLAN.md`
  (flip the deferred item). Grep, don't recall — a partial docs pass is this repo's most
  common review finding.
- PR body must be a **tracked, committed** file under `.github/pr/`.

## One thing you get for free

New interactive surfaces are swept automatically. The `every bound click handler is
invocable without a scope error` test discovers tabs from the view model and modals from the
boolean flags on `game.state`. **Build the club switcher as a `show*` boolean on
`game.state`** and it is covered with no test edit.

Related: templates in `render()` may read only `v`. A bare `g` in a template parses, renders,
and then throws `ReferenceError` on click — it has shipped twice (#30, #43). Two gates now
catch it; do not work around them.

## If a gate fails

Read the first failure only, fix that root cause, re-run once. If the same failure survives
two fixes, stop and report the assertion, got, expected, and what you tried. If a change
breaks a large share of the suite at once, you broke an invariant — revert to green and
re-approach smaller. This is `AGENTS.md` "When a gate fails", and it is what the previous
attempt tripped.
