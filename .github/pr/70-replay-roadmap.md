## docs: replay/deepening roadmap (design lock)

Documentation only — **no `game.js` change in this PR**.

### What this adds

`REPLAY_ROADMAP.md` — a design lock for the replay/deepening pass, complete enough
to hand to a sequence of implementation PRs with no open questions:

- **Diagnosis** — the game dead-ends on a single prestige layer (max 6 perks + 8
  managers ≈ 105 Legacy ≈ 15–20 prestiges, then the meta-progression ends). No
  "prestige the prestige," research is 4 flat one-time purchases, achievements are
  badges, no challenges / resource-transformation / location identity / horizon.
- **Roadmap** — 8 PRs, ordered so each lands on a green, shippable game. PRs 1–5
  widen the base game (achievement multipliers, flavor layer, deep research tree,
  challenge runs, upgradeable managers); PR 6 is the spine — a **second prestige
  layer** ("Franchise Empire" → Renown, `SAVE_VER` 9 → 10); PRs 7–8 are the payoff
  (Brand perks + third club + location identity) and the regression guard.
- **Per-PR spec** — each PR has its mechanism, locked decisions, save-shape impact,
  pacing impact, and non-goals spelled out so a fresh session can implement it
  without prior context.
- **Whole-roadmap non-goals** — no third prestige layer, no auto-prestige/sell, no
  leaderboards, no Renown→cash conversion, no per-club research/crew, ≤ 3 clubs,
  no cross-club cash transfer, no real-world timed events.

The execution companion (branch/PR flow, sub-agent orchestration, checkpoint/resume
protocol) lives in `.hermes/plans/2026-08-15_replay-roadmap-execution.md`, which is
**gitignored** — it is the agent's private runbook, not a repo artifact.

### Docs touched

| File | Change |
|------|--------|
| `REPLAY_ROADMAP.md` | New — the design doc. |
| `.gitignore` | New — ignores `.hermes/` (local agent plans/runbooks) and `.pr-body.md` (the scratch PR-body file that has been accidentally committed in past sessions; durable PR bodies live in `.github/pr/<n>-<slug>.md`). |

`DESIGN.md`, `PRESTIGE.md`, `SECOND_LOCATION.md`, `PLAN.md`, and `README.md` are
deliberately untouched — nothing player-visible or numeric changed, and the roadmap
explicitly defers its own doc-syncs to the implementation PRs that ship the code
(per the "docs land with the feature" rule).

### Verification gates

| Gate | Result |
|------|--------|
| `node --check game.js` | pass |
| `node economy.test.mjs` | pass |
| `node pacing.mjs` | pass |

Gates are green by construction: no code changed. They are recorded here so the
docs-only claim is checkable rather than asserted.

### Version / save format

- `SAVE_VER` **does not move** — stays **9**. The doc *specifies* a future 9 → 10
  bump (PR 6); it does not perform one.
- `VERSION`, the visible build number, and `CHANGELOG` also do not move — this is a
  documentation change with no behavior change, so the "advance together for
  behavior changes" rule does not apply.

### Review-round note

First review wave (14 findings) is addressed in `d4f2b8d`, reconciling the doc with
the actual codebase: `g.brand` added to the reset-persists scope (§8.4), the sale
gate now requires all managers hired (§8.2), the Tier-2 research node renamed to
avoid the PRESTIGE.md §8 "Franchise Binder" conflict (§5), an `allResearch` pacing
milestone specified for PR 3 (§5), the runbook marked optional (§0), the achievement
multiplier scoped to unique non-burst achievements (§3), challenge locks extended to
`autoBuyManagers()` + a `check` completion predicate + income-mod-on-clicks +
multi-club reset scope (§6), the Brand panel locked to `renownTotal > 0` (§8.6),
location-extras initialization specified (§9), and an achievement-matched rooftop
control (§10).
