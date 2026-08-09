## docs: second-location design (PLAN deferred item)

Closes the `PLAN.md` "Deferred / out of scope → **Second location**" item's *design*
half. Documentation only — **no `game.js` change in this PR**.

### What this adds

`SECOND_LOCATION.md` — a design lock complete enough to hand to an implementation
PR with no open questions:

- **Fantasy & currency model** — second room; Cash stays per-club, Clout and Legacy
  stay shared. No new meta currency.
- **Gate** — `g.prestiges >= 1` **and** at least one manager hired. Account-level,
  not per-club. Unlocking is not a prestige.
- **Save shape** — `g.clubs` (map `clubId → Club`), `g.activeClub`, ids `'main'` /
  `'annex'`; v8 → v9 migration sketch, plus the `isValidSavePayload` relaxation a
  natively-exported v9 save will need.
- **Boundaries** — explicit tables for account-level, club-level, and shared-roster
  (`crew` / `jobs`) fields, and the prestige reset rule across all clubs.
- **Owner's List (§6)** — all 14 real `GOALS` ids mapped to their source in v1.
- **Non-goals** — no travel map, no cash transfer, no inactive-club offline earnings,
  no per-club crew, no location-specific buildings in v1.

### Docs touched

| File | Change |
|------|--------|
| `SECOND_LOCATION.md` | New — the design doc. |
| `PRESTIGE.md` | §8 non-goals: the `Second-location simulation` and `Multi-club map / travel` rows now point at `SECOND_LOCATION.md`, completing the supersession that `SECOND_LOCATION.md` §12 claims. |
| `PLAN.md` | Deferred item marked design-done with a pointer; implementation still deferred. |

`DESIGN.md` and `README.md` deliberately untouched — nothing player-visible or
numeric changed.

### Verification gates

| Gate | Result |
|------|--------|
| `node --check game.js` | pass |
| `node economy.test.mjs` | pass |
| `node pacing.mjs` | pass |

Gates are green by construction: no code changed. They are recorded here so the
docs-only claim is checkable rather than asserted.

### Version / save format

- `SAVE_VER` **does not move** — stays **8**. The doc *specifies* a future
  8 → 9 bump; it does not perform one. No persisted save shape changes here.
- `VERSION`, the visible build number, and `CHANGELOG` also do not move — this is a
  documentation change with no behavior change, so the "advance together for
  behavior changes" rule does not apply.

### Review-round note

This PR has accumulated a large number of automated review rounds because the
reviewer re-runs on every push and surfaces fresh prose nitpicks each time on a
~390-line design doc. Findings from rounds that predate the current head have been
checked against the file rather than re-fixed. Concrete defects addressed:

- §6 goal table rewritten against the real `GOALS` array — `bar` and `flyers` were
  never goal ids (the flyers goal is `word`), `regulars`' threshold is 3 (25 is
  `name`), and `house` / `backstage` / `roster` / `builtin` were missing entirely.
  `backstage` and `roster` are now flagged as straddling the club/shared-roster
  boundary, which is the case that actually bites an implementer.
- Brittle `game.js:NNN-NNN` line citations replaced with symbol references
  (`isValidSavePayload`, the `sanitizeG` jobs/crew rebalance pass) so they cannot
  drift.
- `PRESTIGE.md` / `PLAN.md` cross-references added.
