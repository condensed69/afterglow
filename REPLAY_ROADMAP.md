# REPLAY_ROADMAP.md — Deepening & Replay Design

**Status:** design lock for a multi-PR roadmap. No code shipped yet.
**Scope:** this doc specs the replay/deepening pass — the second prestige layer (core) plus the supporting systems that make the base game worth replaying.
**Depends on:** everything shipped through v0.11.3 (SAVE_VER 9, `g.clubs` map, second room, pacing.mjs).
**Save format:** SAVE_VER 9 → **10** (only in the second-prestige PR; earlier PRs are additive-field or derived, no bump).

This doc is intentionally complete enough that each PR below can be implemented by a fresh session with no prior context.

**Execution companion:** `.hermes/plans/2026-08-15_replay-roadmap-execution.md` — the runbook with the exact branch/PR flow, sub-agent orchestration, and the checkpoint/resume protocol (breaks for context compression). It is gitignored under `.hermes/` and lives only in the originating workspace, so treat it as a convenience, not a dependency: **this doc is self-contained** and complete enough to implement every PR with no prior context.

---

## 1. The problem (why this exists)

The game dead-ends. The current meta-progression is a single prestige layer:

- **8 buildings, 6 upgrades, 4 research, 6 perks, 8 managers, 38 achievements, 4 jobs, ~10 goals, 4 shifts + 3 specials, 2 clubs.**
- To buy *everything* (max 6 perks + 8 managers) is ~105 Legacy ≈ 15–20 prestiges — then the meta-progression **ends**. There is no "prestige the prestige."
- Research is 4 flat one-time purchases — no tree, no prerequisites, nothing unlocks a *mechanic*.
- Achievements are badges (rewards 1–10 Clout/Legacy, none change gameplay).
- No challenges, no resource-transformation layer, no location identity, no endgame horizon.

The reference games this doc borrows from:

| Driver | Kittens Game | Antimatter Dimensions |
|---|---|---|
| Layered prestige | Paragon → Chronos → Burned Paragon → Transcendence | Infinity → Eternity → Reality → Celestials |
| Deep research | Science → Metaphysics (tiers + prereqs) | Time Studies / Time Dimensions |
| Resource web | 50+ resources, crafting chains | Per-layer currencies |
| Challenges | — | Challenge runs w/ permanent rewards |
| Automation as reward | Gradual (observe → craft → trade) | Autobuyers w/ levels + priorities |
| Achievements that matter | — | Real multipliers, not badges |

The single highest-leverage fix is a **second prestige layer** — it is the structural reason the game runs out of runway. Everything else widens the base game so the second prestige resets *into* something worth replaying.

---

## 2. The roadmap (PR sequence)

Ordered so each PR lands on a green, shippable game. The "more to do" PRs (1–5) come first; the second prestige (6–8) resets into a deeper game.

| PR | Tier | Title | Save shape | Depends on |
|----|------|-------|------------|------------|
| **1** | 1 | Achievement multipliers (milk-style) | derived (no bump) | — |
| **2** | 1 | Flavor layer: news ticker + named regulars | none | — |
| **3** | 2 | Deep research tree (tiers + prereqs, mechanic unlocks) | additive (no bump) | — |
| **4** | 2 | Challenge runs (replay modifiers + permanent rewards) | additive `g.challenge`/`g.challengesDone` | — |
| **5** | 2 | Upgradeable managers (levels: buy faster/smarter) | additive `g.managerLevels` | — |
| **6** | 3 | **Second prestige layer — "Franchise Empire" → Renown** | **SAVE_VER 10** | 1–5 (or at least 3) |
| **7** | 3 | Renown unlocks: Brand perks + third club + location identity | additive on 10 | 6 |
| **8** | 3 | Endgame horizon + second-prestige pacing guard | none | 6–7 |

**Why this order:** PRs 1–5 are each independently shippable and widen the base game. PR 6 (the spine) must reset into a game that already has "enough to do," so it lands after at least the research tree (PR 3) and challenges (PR 4). PR 7–8 are the payoff and the regression guard.

Each PR is a **checkpoint** (see the runbook §"Checkpoint / resume protocol"). A fresh session resumes from the highest merged PR.

---

## 3. PR 1 — Achievement multipliers

**Goal:** make the 38 existing achievements a real progression path, not a checklist.

**Mechanic:** a global multiplier derived from achievement count (Cookie Clicker "milk" pattern):

```js
achievementMult(g) {
  const owned = new Set(g.achievements || []);
  const count = this.ACHIEVEMENTS.filter(a => !a.burst && owned.has(a.id)).length;
  return 1 + 0.01 * count;
}
```

Applied to **all** cash income — passive (`rates()`), active clicks (`workCrowd()`), **and** burst-event cash (`spawnWhale`/`takeGolden`) — alongside the existing `cashIncomeMult` (House cut). Excludes the 4 live-only burst achievements (`whale_1`, `whale_10`, `special_1`, `special_5`) and dedupes ids, so the max is +34% (34 unique non-burst achievements), not +38% — meaningful, not broken. **0.11.14 meta pass (next-roadmap PR 3):** catalog grew 38 → 48 — ten new non-burst achievements added covering the post-sale meta (franchise sales, Brand perks, Rooftop club, challenge tiers, Brand Endorsements), expanding the ceiling to +44% (44 non-burst of 48 total). The pacing bot's standard path never triggers these (it never sells, opens rooftop, starts challenges, or owns brand), so pacing bands remain bit-identical.

**No save-shape change** — derived from the unique non-burst achievement count (the `burst: true` flag is data-table-only, no new persisted fields).

**Pacing impact (must be handled in the same PR):** the pacing bot earns achievements deterministically as it plays, so this multiplier grows during the run and **shifts the pacing bands**. `pacing.mjs` must be re-baselined: re-measure the full milestone table (the bot's achievement count at each milestone is deterministic), and update the band anchors + the pinned assertions in `economy.test.mjs` that hardcode income values. This is the "re-measure the full milestone table, never assume monotonicity" rule from the incremental-game-design skill.

**Non-goals:** no new achievements in this PR (density pass is separate); no per-achievement unique bonuses (that's a later "achievement rewards" pass if wanted).

---

## 4. PR 2 — Flavor layer

**Goal:** add identity beyond numbers (news ticker + named regulars), non-blocking, no economy change.

**Mechanic:**
- **News ticker** — a small rotating line in the header/ledger area (Universal Paperclips-style activity log already exists as `g.log`; the ticker is a *curated* flavor line, not the raw log). Picks from a `FLAVOR` table keyed on state (e.g. "The DJ dropped a deep cut and the floor surged" when hype crosses a threshold; "A regular left a five-star review" on regulars gain).
- **Named regulars** — when `regulars` crosses thresholds, assign a name from a `REGULAR_NAMES` pool and surface it ("Margo is a regular now"). Pure flavor; no stat.

**No save-shape change** (names can be derived deterministically from `regulars` count, or stored in an additive `g.regularNames` map if persistence across reloads is wanted — prefer derived to avoid a field).

**Pacing impact:** none — flavor is `_live`-gated or pure display; the bot never renders it.

**Non-goals:** no dialogue trees, no narrative arc, no new currencies.

---

## 5. PR 3 — Deep research tree

**Goal:** turn 4 flat research items into a tree with tiers + prerequisites, where later nodes unlock *mechanics*, not just multipliers.

**Mechanic:**
- Restructure `RESEARCH` entries to gain `tier` and optional `req` (prerequisite research id, mirrors `UPGRADES.req` shape but existence-based like perk reqs).
- Expand 4 → ~12–16 items across 3 tiers:
  - **Tier 1 (cheap, multipliers):** existing 4 (loop, latemenu, promo, payroll) + a couple more.
  - **Tier 2 (mid, mechanic unlocks):** e.g. "Franchise Playbook" (unlocks a new job — a floor manager that boosts patron conversion), "Staff Scheduling" (unlocks a new job or automation), "VIP Concierge" (unlocks a new income channel).
  - **Tier 3 (expensive, account-wide):** e.g. "Brand Licensing" (cross-club synergy — see PR 7), "Night School" (permanent small stat bonus).
- Research stays **account-level** (`g.r`), so this is a data + UI change, not a save-shape change.

**Key decisions (locked):**
- `req` is existence-based (`g.r[reqId]` truthy), not rank-based — research has no ranks.
- The cheapest research still anchors the "first research" pacing milestone; keep the cheapest Tier-1 cost at its current anchor value (12 Clout) or re-baseline `pacing.mjs` if it moves. **Do not move the anchor without a pacing re-run.**
- Mechanic-unlock nodes must be gated so the pacing bot (which buys cheapest-first) doesn't unlock a mechanic that changes its path mid-run — or, if it does, the bot's path is deterministic and the bands are re-measured.
- Prerequisites are an action invariant, not just presentation metadata. `buyResearch()` must reject a node whose `req` is not owned; the research card must expose the same unavailable state; and `pacing.mjs`'s `tryBuyCheapestResearch()` must filter out unmet prerequisites before choosing the cheapest candidate. This prevents direct calls from bypassing the tree and prevents the bot from repeatedly selecting an affordable locked node instead of advancing toward `allResearch`. Add `economy.test.mjs` regressions proving a locked node cannot be bought directly, becomes available after its prerequisite, and is reported unavailable by the card/view model.
- Research-unlocked jobs must use the job catalog as the source of truth throughout the state lifecycle. PR 3 must replace the four-id assumptions in `fresh()`, `sanitizeG()`, crew-sum correction, `moveJob()`, and club-switch eviction/rebalance with catalog-driven initialization and iteration. A locked job has a numeric zero assignment, cannot receive crew before its research is owned, remains included in crew-total correction, and is deterministically evicted/rebalanced if a load or reset makes its unlock unavailable. Add save/import and ordinary-prestige reset regressions covering the new job, including malformed/missing assignments and no crew loss or duplication.

**Pacing impact:** `pacing.mjs` currently has **no "all research" milestone** — the reference bot stops at 3/4 research (only "first research" and "all upgrades owned" are tracked). PR 3 must therefore **add an `allResearch` milestone** (every `RESEARCH` entry owned) with a target band, alongside re-measuring "first research" (which shifts if a cheaper item is added). Re-baseline `pacing.mjs`; pin the cheapest-research anchor in a test (the `min(researchCosts) === loop.cost` pattern from the balance-pass skill reference).

**Non-goals:** no per-club research (stays account-level per SECOND_LOCATION.md); no research that costs Legacy/Renown (Clout only).

---

## 6. PR 4 — Challenge runs

**Goal:** add replay modifiers with permanent rewards (AD's #1 replay hook).

**Mechanic:**
- Add `g.challenge` (active challenge id or `null`) and `g.challengesDone` (array of completed ids) — **additive fields**, no SAVE_VER bump (same pattern as `goals`/`clicks`/`managerPaused`). **(Superseded 0.11.13:** next-roadmap PR 2 turns challenges into a 3-tier ladder — `g.challengeTier` + `g.challengeTiers`, SAVE_VER 12 with `MIGRATIONS[11]` backfilling tier 1 from `challengesDone`; the original two fields stay additive.)
- `CHALLENGES` data table, each entry `{ id, name, desc, mod, reward, check }` — `check(g)` is the completion predicate (e.g. reach N regulars, buy X building), evaluated against the same merged club view as achievements:
  - `mod` is a modifier applied to the run (e.g. `{ flyers: 'locked' }`, `{ incomeMult: 0.5 }`, `{ startCash: 0 }`). An `incomeMult` modifier must apply to **both** passive (`rates()`) and active (`workCrowd()`) cash — routing it through `rates()` alone leaves active clicking a bypass.
  - `reward` is a permanent account bonus granted on completion (e.g. `{ cashMult: +0.05 }`, `{ doorMax: +1 }`).
- **Start a challenge** = reset the run with the modifier active — since challenges are account-level, starting one **resets every club in `g.clubs`** to `freshClubState()` (not just the active club) and re-locks the annex/rooftop, so a developed annex can't satisfy the completion condition instantly; the challenge is "won" when its completion condition is met (e.g. reach N regulars, buy X building).
- **Challenge selection UI** in the Prestige/Perks panel (or a new "Challenges" tab): list, each shows done/undone + reward.

**Key decisions (locked):**
- Challenges are **opt-in and reset the run**, so the default pacing bot never starts one — **zero pacing impact** on the existing bands. Add a *separate* `challengeRun()` in `pacing.mjs` only if a challenge's pacing needs a guard (optional; not required for ship).
- Completion rewards are **permanent account bonuses** stored in `g.challengeRewards` (additive map) or derived from `g.challengesDone` + the `CHALLENGES` table (prefer derived — no extra field).
- Challenge modifiers must route through the same `club(g)`/`rates(g)` paths; a locked building must be enforced in `buyBuilding` AND in `autoBuyManagers()` (which bypasses `buyBuilding` and replicates purchase logic) AND greyed in the card — otherwise an owned manager auto-buys the locked structure during the challenge.
- A challenge must not be able to complete instantly or via a stale tab — `tabStale` guard on the start/claim actions (multi-tab convention from the skill).

**Non-goals:** no challenge that rewards Clout (random/run-variance must not feed the deterministic research currency — the Legacy-not-Clout rule); no timed real-world challenges (all in-game-clock).

---

## 7. PR 5 — Upgradeable managers

**Goal:** make automation a progression, not a binary hire (AD autobuyer levels).

**Mechanic:**
- Add `g.managerLevels` (additive map `buildingId → level`, default 0) — no SAVE_VER bump.
- Each manager level: **buys faster** (shorter auto-buy interval) and/or **buys smarter** (level 1 = buy 1, level 2 = buy 5, level 3 = buy max). Cost scales with level (Legacy).
- `autoBuyManagers()` reads the level to decide interval + quantity.

**Key decisions (locked):**
- Keep the existing `g.managers` boolean map as "hired" (don't migrate it); `g.managerLevels` is additive on top.
- Leveling a manager is a Legacy purchase from the Perks panel; `managerPaused` still applies at every level.
- The second-prestige reset (PR 6) wipes `g.managers` + `g.managerLevels` (managers are account-level but reset with the deeper layer).
- Ordinary prestige does **not** wipe manager levels. Because `confirmPrestige()` builds `next` from `fresh()`, it must snapshot and restore the sanitized `g.managerLevels` map alongside the existing manager and pause-state whitelist; reserving the wipe for `confirmFranchiseSale()` is intentional. Add an `economy.test.mjs` reset regression that levels a manager, performs ordinary prestige, and proves the hired state, pause state, and level all survive.

**Pacing impact:** the pacing bot hires a rail manager in the second-room scenario; if manager levels change auto-buy behavior, re-check `secondRoomRun()` (the manager is paused for that measurement anyway, so impact is minimal — but verify).

**Non-goals:** no auto-prestige, no auto-assign-crew, no auto-buy-rounds (those are separate future automation).

---

## 8. PR 6 — Second prestige layer: "Franchise Empire" → Renown (the core)

This is the structural fix. Full spec follows the PRESTIGE.md pattern.

### 8.1 Fantasy & name

**Fantasy.** After you've maxed every perk and built out both clubs, a national conglomerate offers to buy your entire operation. You **sell the franchise** — resetting *everything* (both clubs, Legacy, perks, research, Clout, managers, crew) — in exchange for **Renown**, a new permanent currency that measures your brand's national footprint. Renown buys **Brand** upgrades that no single club could afford, and eventually a **third location**.

**Pitch (in-world).** "The chain wants your name. Cash out, keep the brand, and build something bigger."

**Currency model (additive, locked):**

| Currency | Role |
|----------|------|
| **Cash / Clout / Legacy** | unchanged (per-club run / shared research / shared prestige). |
| **Renown** | New permanent meta currency. Earned only by selling the franchise. Spent on Brand perks (PR 7). Never wipes. |

**Internal ids (locked):**

| Concept | Id / field |
|---------|------------|
| Renown spendable | `g.renown` (number) |
| Renown lifetime | `g.renownTotal` (number) |
| Brand perk ranks | `g.brand` (object map `perkId → rank`) |
| Third club id | `'rooftop'` (unlock target, PR 7) |

### 8.2 Gate

**Condition (locked):** every prestige perk is maxed (`this.PRESTIGE_PERKS.every(p => this.perk(g, p.id) >= p.max)`) **and** every manager is hired (`this.MANAGERS.every(m => g.managers[m.id])`) **and** both clubs are unlocked (`g.clubs.main` and `g.clubs.annex` both present).

The gate is evaluated on the **account**, not the active club. This ties the second prestige to "you've exhausted the first layer and proven the multi-club model."

**UI affordance:** when the gate is met, a **"Sell the franchise"** control appears in the Perks/Prestige panel, styled distinctly (it is a *bigger* reset than prestige). Below the gate, absent. Clicking opens a confirmation modal with a preview of the Renown gain and an explicit "this resets EVERYTHING except Renown and achievements" warning. `tabStale` blocks it (same rule as prestige).

### 8.3 Renown gain formula

```js
renownGain(g) {
  return Math.floor(Math.sqrt(g.legacyTotal || 0) + (g.prestiges || 0) / 3);
}
```

Transparent, mirrors `legacyGain`'s shape (`sqrt` of lifetime + linear term). With ~105 lifetime Legacy and ~15 prestiges, the first sale yields ~15 Renown.

### 8.4 Reset scope (what wipes, what persists)

**Wipes (everything account-level except the three below):**

| Field | After |
|-------|-------|
| `g.clubs` | `{ main: freshClubState() }` — annex/rooftop re-lock |
| `g.activeClub` | `'main'` |
| `g.legacy` / `g.legacyTotal` | `0` |
| `g.perks` | `{}` |
| `g.prestiges` | `0` |
| `g.clout` | `0` |
| `g.research` (`g.r`) | `{}` |
| `g.managers` / `g.managerPaused` / `g.managerLevels` | `{}` / `{}` / `{}` |
| `g.crew` / `g.jobs` | `0` / fresh |
| `g.challengesDone` / `g.challengeRewards` / `g.challengeTiers` | `[]` / `{}` / `{}` (challenges re-lock; earned tiers wipe with the sale, consistent with `challengesDone`) |
| `g.goals` / `g.clicks` / `g.rounds` | fresh / `0` / `0` |
| `g.whalesCount` / `g.specialsCount` / `g.golden` | `0` / `0` / `null` |

**Persists (the permanent layers):**

| Field | Behavior |
|-------|----------|
| `g.renown` / `g.renownTotal` | Spendable + lifetime Renown. Never wipes. |
| `g.achievements` | Permanent unlocks, unchanged. |
| `g.brand` | Brand perk ranks (PR 7). Never wipes — the reason to sell again. |
| `g.brandLevel` | Brand Endorsement level (next-roadmap PR 1). Never wipes — the repeatable Renown sink is the reason the NEXT sale has a spend. |
| `g.lifetimeEarned` | Cumulative lifetime value (next-roadmap PR 4). Never wipes — the brand's footprint; the Vision ladder survives every reset. |

**Order of operations (locked, mirrors prestige):** build the post-sale candidate → `setItem` must succeed → replace live state. Never replace first.

### 8.5 Save format (SAVE_VER 10)

**Bump `SAVE_VER` to 10** in this PR only.

```js
// MIGRATIONS[9]: v9 → v10 — add Renown + Brand fields
9(g) {
  if (typeof g.renown !== 'number' || !Number.isFinite(g.renown)) g.renown = 0;
  if (typeof g.renownTotal !== 'number' || !Number.isFinite(g.renownTotal)) g.renownTotal = 0;
  if (!g.brand || typeof g.brand !== 'object' || Array.isArray(g.brand)) g.brand = {};
}
```

`fresh()` initializes `renown: 0, renownTotal: 0, brand: {}`. `sanitizeG` fail-closes these fields (non-numeric → 0; non-object brand → `{}`). `isValidSavePayload` does **not** require them (migration fills them).

### 8.6 UI

- **Perks/Prestige panel** gains a "Sell the franchise" block (gate-aware) and, after first sale, a **Renown readout** (`g.renown` / `g.renownTotal`).
- The **Brand panel** (PR 7) is gated on `g.renownTotal > 0` (lifetime Renown — permanent once unlocked, so the panel stays visible after Renown is spent), same pattern as the Perks tab gating on `prestiges > 0`.

### 8.7 Shipping regression guards

PR 6 changes the save version and a destructive reset path, so its regression coverage ships **in PR 6**, not in the later pacing PR. `economy.test.mjs` must cover:

- v9 → v10 migration defaults plus sanitization of malformed `renown`, `renownTotal`, and `brand` values;
- the complete §8.4 wipe/persistence matrix, including achievements and Brand ranks persisting while both clubs, first-layer currencies/progression, managers/levels, research, crew/jobs, challenges, and run counters reset;
- exact Renown gain and lifetime/spendable accrual across a successful sale; and
- persist-before-replace atomicity: when `localStorage.setItem` throws, the live state remains entirely unchanged and no success-side effects run.

Use explicit before/after fixtures so a newly added account field cannot silently escape the matrix. These tests are required for the shipping PR under the repository's economy/save/prestige gate; the pacing scenario below is additional coverage, not a substitute.

### 8.8 Pacing guard

Add a `renownRun()` scenario to `pacing.mjs` (in PR 8, or a minimal version here): bot plays to the gate (max perks + all managers + both clubs) → sells → asserts `renownTotal > 0` and that the reset produced a fresh `main` with `renown`/`achievements` intact. Named failures on gate miss or reset-shape violation.

### 8.9 Non-goals (second prestige v1)

- No third prestige layer (that's a future "Renown → Transcendence" if ever).
- No Renown → cash/Clout/Legacy conversion.
- No auto-sell (manual only).
- No per-club Renown.
- Brand perks (PR 7) are the only Renown sink in v1. **(Superseded 0.11.12:** the repeatable Brand Endorsement — +2% all cash per level at `floor(15 × 1.35^level)` Renown — extends the sink past ~58 Renown; still no Renown → resource conversion, the endorsement is a permanent multiplier like Nationwide Reach.)

---

## 9. PR 7 — Renown unlocks: Brand perks + third club + location identity

**Goal:** make Renown *do* something (the "more to do" payoff).

**Mechanic:**
- **Brand perks** — `BRAND_PERKS` data table (mirrors `PRESTIGE_PERKS`: `{ id, name, cost, max, desc, req? }`), bought with Renown. Effects are account-wide and powerful (e.g. "all clubs +10% cash", "start each run with 2 regulars", "research costs −20%", "offline rate +10%").
- **Third club** — `'rooftop'`, unlocked by a Brand perk (or `renownTotal >= N`). Uses the existing `g.clubs` map + `freshClubState()`; the id namespace already supports it (SECOND_LOCATION.md §1).
- **Location identity** — each club gains a small set of **location-specific buildings/upgrades** (data-driven `LOCATION_EXTRAS = { main: [...], annex: [...], rooftop: [...] }`), so the three rooms are no longer "same catalog, different room." This supersedes SECOND_LOCATION.md §11's "no location-specific buildings" non-goal.

**Key decisions (locked):**
- Brand perks are bought with Renown only; they persist through the second prestige (they're the reason to sell again).
- Location-specific content is **additive** — the shared catalog still applies everywhere; extras are appended per location. `freshClubState()` must initialize each location's extra building/upgrade ids in the club `b`/`u` maps (the shared initializer only covers `BUILDINGS`/`UPGRADES`), and import/sanitization must backfill extras for existing saves — otherwise an uninitialized extra reads `undefined`, prices as `NaN`, and can never be bought.
- The third club's unlock gate and its extras are data-driven; no new save-shape beyond what PR 6 added.

**Pacing impact:** Brand perks + location extras change the economy; re-baseline `pacing.mjs` and add the third-club scenario to `renownRun()`.

**Non-goals:** no more than 3 clubs in this pass; no cross-club cash transfer (still out); no per-club research (still out).

---

## 10. PR 8 — Endgame horizon + pacing guard

**Goal:** give the player a visible long-term goal and lock the whole pass behind a regression guard.

**Mechanic:**
- **Endgame horizon** — a visible goal line: "Build the franchise to 3 clubs and reach $1e12 (T)" or similar, surfaced in the Owner's List / a "Vision" panel. Purely a target + progress readout; no new mechanic.
- **Pacing guard** — extend `pacing.mjs` with `renownRun()` (full version): bot → gate (max perks + all managers + both clubs) → sell → assert reset shape + Renown accrual → buy a Brand perk → unlock rooftop → assert the third club plays faster than a control run carrying the **same achievements** (PR 1 makes achievements a cash multiplier, so a no-achievement fresh control would pass on achievement carryover alone); prefer directly toggling/asserting the Brand effect, as `secondRoomRun()` does for research and House cut (mirrors `secondRoomRun()`'s `t2 < t1`).

**Pacing impact:** this is the guard itself; it must be green before merge.

**Non-goals:** no leaderboards, no cloud ranks (PRESTIGE.md §8 still out).

---

## 11. Non-goals (whole roadmap)

- No third prestige layer, no auto-prestige, no auto-sell.
- No leaderboards / cloud ranks.
- No Renown → cash/Clout/Legacy conversion.
- No per-club research or crew (crew stays shared; research stays account-level).
- No more than 3 clubs.
- No cross-club cash transfer.
- No real-world timed events.
- No new meta currency beyond Renown.

---

## 12. Implementation checklist (ticked as PRs land)

- [x] PR 1 — achievement multipliers + pacing re-baseline.
- [x] PR 2 — flavor layer (news ticker + named regulars).
- [x] PR 3 — deep research tree (tiers + prereqs + mechanic unlocks) + pacing re-baseline.
- [x] PR 4 — challenge runs (modifiers + permanent rewards).
- [x] PR 5 — upgradeable managers (levels).
- [x] PR 6 — second prestige layer (SAVE_VER 10, Renown, reset scope, gate). `renownRun()` landed ahead of PR 8 — the pacing guard now ships with the layer.
- [x] PR 7 — Brand perks + third club + location identity. (`renownRun()` gained the §9 rooftop scenario — lease → open → extras verified live → third club plays; the full same-achievements control stays on PR 8.)
- [x] PR 8 — endgame horizon + `renownRun()` pacing guard. (0.11.11: "Vision — the long game" readout in the Owner's List — 3 clubs + $1e12 net worth, readout only. `renownRun()` gained the §10 guard: rooftop with location extras seeded beats a same-achievements control run on the identical post-sale account.) **(Superseded 0.11.15:** next-roadmap PR 4 retargets the Vision to a cumulative lifetime-value ladder — `g.lifetimeEarned`, $10M/$100M/$1B tiers with a +4% total all-cash bonus, SAVE_VER 13 with `MIGRATIONS[12]`; the §10 pacing guard stays. See DESIGN.md §23.)

---

## 13. Doc history

| Date | Note |
|------|------|
| 2026-08-15 | Initial design lock. Diagnoses the single-prestige dead-end; specs the second prestige layer ("Franchise Empire" → Renown, SAVE_VER 10) as the core, with 7 supporting PRs. Supersedes SECOND_LOCATION.md §11 "no location-specific buildings" (PR 7). |
| 2026-08-15 | PR 7 shipped (0.11.10): BRAND_PERKS (Renown sink, 5 perks), the Rooftop third club, and LOCATION_EXTRAS per-location buildings/upgrades. renownRun() gained the §9 rooftop scenario; the §10 full guard (same-achievements control) remains on PR 8. |
| 2026-08-16 | PR 8 shipped (0.11.11): the endgame horizon (Owner's List "Vision — the long game" readout: 3 clubs + $1e12 net worth, readout only) and the §10 pacing guard (renownRun() rooftop-with-extras beats a same-achievements control). Roadmap complete — all 8 PRs merged. |
| 2026-08-17 | Next-roadmap PR 4 shipped (0.11.15): the Vision retarget — the $1e12 net-worth target (probe-measured ~3.6 sim-years past a decked account) is replaced by a cumulative lifetime-value ladder (`g.lifetimeEarned`; $10M/$100M/$1B tiers, +1%/+1%/+2% all-cash bonuses, +4% total; SAVE_VER 13, MIGRATIONS[12]). pacing.mjs gains `endgameProbe()` pinning ★1 above the deterministic bot's full-8h lifetime. |
| 2026-08-23 | Post-polish roadmap shipped (0.11.23–0.11.26, PRs #102–#108): catalogs split to `catalogs.js`, achievement density (+5), ledger "this session" strip, back-half flavor (House strip + ticker lines), challenge-tier achievements (+4), a mid-band pacing anchor (`midBandRun()`), and a closing docs sweep. See DESIGN.md §12 (achievements) and §23 (mid-band anchor). |
