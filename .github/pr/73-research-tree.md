## feat: deep research tree — tiers, prerequisites, mechanic unlocks (PR 3)

Turns the 4 flat research items into a 12-node, 3-tier tree where later nodes
unlock *mechanics*, not just multipliers (REPLAY_ROADMAP.md §5).

### What changed

- **`RESEARCH` grows to 12 items across 3 tiers**, each with `tier` and an
  optional `req` (existence-based prerequisite research id):
  - **Tier 1 (cheap multipliers, no req):** loop (12), latemenu (12), promo (20),
    cover (24 — new), payroll (32). The cheapest item stays `loop` @ 12 Clout,
    so the "first research" anchor is untouched.
  - **Tier 2 (mechanic unlocks + stacking, req-gated):** host (45, req promo —
    **unlocks the Floor Host job**), scheduling (50, req payroll), concierge (55,
    req cover), playbook (60, req loop).
  - **Tier 3 (expensive account-wide):** brand (90), school (100), network (110).
- **Prerequisites are an action invariant:** `buyResearch()` rejects a node
  whose `req` isn't owned; the research card reports the same state via
  `reqLocked`/`reqName` ("requires X"); `pacing.mjs`'s `tryBuyCheapestResearch()`
  filters unmet prerequisites.
- **Job catalog becomes the source of truth for the shared roster.** `JOBS`
  entries gain `unlock` + `prio`; `fresh()`, `sanitizeG()`, save validation,
  `moveJob()`, and `setActiveClub()` all iterate the catalog instead of a
  hardcoded four-id list. The new **Floor Host** job holds zero crew until its
  research is owned, is evicted to Off Shift if a load/reset drops the unlock,
  and can't receive crew via `moveJob()` while locked.
- **New research effects** (all in `rates()`): cover +50% door cover; concierge
  +50% VIP income; scheduling −25% wages (stacks with payroll); playbook +25%
  regulars; brand +10% cash; school +15% crew output; network +25% Clout; host
  +0.04 patrons/s each.

### Gates (all run locally)

| Gate | Result |
|------|--------|
| `node --check game.js` | pass |
| `node economy.test.mjs` | **244 passed** (236 prior + 8 new) |
| `node pacing.mjs` | all in band — 1.53 / 7.70 / 5.70 / 14.35 / 19.85 / 32.00 m (bit-identical to PR 2 baseline) + **all research 105.18m** |

New tests: tree well-formedness (tier/req/3 tiers), `min(researchCosts) === loop.cost`
anchor pin, locked-node rejection + prereq unlock, card `reqLocked` state,
job lifecycle (fresh/moveJob), `sanitizeG` locked-job eviction (no crew loss),
import validation of the host job, prestige reset catalog shape.

### Pacing

New `allResearch` milestone at **~105 min ±30%** (re-baselined from the measured
105.18m). Every pre-existing band is **bit-identical** to the PR 2 baseline —
the cheapest research anchor is unchanged and the bot's crew policy never
assigns the new job, so the research tree is a strict extension of the curve.

### Versioning

`VERSION` 0.11.6 / build 219 · `CHANGELOG` entry added · **`SAVE_VER` unchanged
(9)** — research stays a boolean map on `g.r` and jobs stay a count map on
`g.jobs`; no migration.

### Docs touched

`DESIGN.md` §19 (research tree, catalog-driven jobs, effects, pacing) — appended
at the end (no § renumbering), supersedes the flat §5 list.
