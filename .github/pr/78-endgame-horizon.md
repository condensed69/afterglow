# PR 8 — Endgame horizon + pacing guard

Completes `REPLAY_ROADMAP.md` §10 — the last roadmap PR: a visible long-term
goal line, and the §10 same-achievements pacing guard that locks the whole
replay pass behind a regression check.

## What ships

**Endgame horizon — "Vision — the long game" (readout only)**
- The Owner's List panel gains a **Vision** block under the active goal:
  `Clubs n/3 · Net worth $X / $1T` with a blended progress bar (clubs leg +
  net-worth leg averaged, so 3/3 clubs alone reads 50% and one leg can't hide
  the other), a ★ reached state, and a "sell it, and build again" line.
- Net worth = sum of `cash` across every club in `g.clubs` (no cross-club
  transfer, so total till is the franchise value). Computed at render time in
  `renderVals().horizon` from existing state only.
- **No new mechanic, no save-shape change** (SAVE_VER stays 10), zero pacing
  impact — the bot never renders.

**Pacing guard — `renownRun()` §10 same-achievements control**
- `renownRun()` already shipped the §8 sale/reset assertions and the §9
  rooftop scenario (lease → open → extras verified live via `rates()`
  toggles). PR 8 adds the control the roadmap deferred: it snapshots the
  post-sale account and measures the rooftop's first LED **twice** on
  byte-identical state (same achievements — a no-achievement fresh control
  would pass on achievement carryover alone, which §10 forbids):
  - **Control:** the standard bot plays the rooftop (location extras are not
    in the shared catalog, so it never buys them).
  - **Extras:** the same account with Helipad Lounge + Panorama Deck seeded
    (the player bought them).
  - Asserts the extras run wins by **≥15%** (`t3Extras < t3Control * 0.85` —
    deterministic, so a plain strict `<` would pass a regression that merely
    narrows the advantage): the third club's location content must clearly
    beat a same-achievements account without it.

## Gates (all run locally, same as CI)

| Gate | Result |
|------|--------|
| `node --check game.js` | ✅ |
| `node economy.test.mjs` | ✅ 280 passed (new: `renderVals().horizon` math test — worth = sum of club cash, `done` needs both legs, blended pct 50/100) |
| `node pacing.mjs` | ✅ all 7 milestone bands **bit-identical** to the PR 6/7 baseline + prestige + second-room + renown scenario with the new §10 control (rooftop control vs extras-seeded, same achievements; margin assert) |

## Docs touched

- `DESIGN.md` §23 (new: endgame horizon + §10 pacing guard description).
- `REPLAY_ROADMAP.md` §12 — PR 8 ticked; §13 doc-history row (roadmap
  complete — all 8 PRs merged).
- `README.md` — new "Vision — the long game (0.11.11)" section.
- `VERSION` 0.11.10/223 → **0.11.11/224**; in-file `CHANGELOG` entry added
  (newest first, per repo convention).
- Review round 1: added `renderVals().horizon` math tests (worth sum,
  both-legs `done`, blended pct) and tightened the §10 guard to a ≥15% margin
  assert (`t3Extras < t3Control * 0.85`). DESIGN.md §23 updated to match.

## SAVE_VER

**Unchanged (stays 10).** The horizon is a render-time computation over
existing state (`g.clubs` + per-club `cash`); nothing is persisted.
