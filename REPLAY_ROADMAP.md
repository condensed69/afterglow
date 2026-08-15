# REPLAY_ROADMAP.md — Deepening & Replay Design

**Status:** design lock for a multi-PR roadmap. No code shipped yet.
**Scope:** this doc specs the replay/deepening pass — the second prestige layer (core) plus the supporting systems that make the base game worth replaying.
**Depends on:** everything shipped through v0.11.3 (SAVE_VER 9, `g.clubs` map, second room, pacing.mjs).
**Save format:** SAVE_VER 9 → **10** (only in the second-prestige PR; earlier PRs are additive-field or derived, no bump).

This doc is intentionally complete enough that each PR below can be implemented by a fresh session with no prior context.

**Execution companion:** `.hermes/plans/2026-08-15_replay-roadmap-execution.md` — the runbook with the exact branch/PR flow, sub-agent orchestration, and the checkpoint/resume protocol (breaks for context compression). Read it before implementing anything; it is the *how*, this doc is the *what*.

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
  return 1 + 0.01 * (g.achievements ? g.achievements.length : 0);
}
```

Applied to cash income (passive + active clicks) in `rates()`/`workCrowd()`, alongside the existing `cashIncomeMult` (House cut). With all 38 achievements that is +38% — meaningful, not broken.

**No save-shape change** — derived from `g.achievements.length`.

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
  - **Tier 2 (mid, mechanic unlocks):** e.g. "Franchise Binder" (unlocks the prestige gate — currently implicit), "Staff Scheduling" (unlocks a new job or automation), "VIP Concierge" (unlocks a new income channel).
  - **Tier 3 (expensive, account-wide):** e.g. "Brand Licensing" (cross-club synergy — see PR 7), "Night School" (permanent small stat bonus).
- Research stays **account-level** (`g.r`), so this is a data + UI change, not a save-shape change.

**Key decisions (locked):**
- `req` is existence-based (`g.r[reqId]` truthy), not rank-based — research has no ranks.
- The cheapest research still anchors the "first research" pacing milestone; keep the cheapest Tier-1 cost at its current anchor value (12 Clout) or re-baseline `pacing.mjs` if it moves. **Do not move the anchor without a pacing re-run.**
- Mechanic-unlock nodes must be gated so the pacing bot (which buys cheapest-first) doesn't unlock a mechanic that changes its path mid-run — or, if it does, the bot's path is deterministic and the bands are re-measured.

**Pacing impact:** adding research items changes the "all research" milestone and possibly "first research" (if a cheaper item is added). Re-baseline `pacing.mjs`; pin the cheapest-research anchor in a test (the `min(researchCosts) === loop.cost` pattern from the balance-pass skill reference).

**Non-goals:** no per-club research (stays account-level per SECOND_LOCATION.md); no research that costs Legacy/Renown (Clout only).

---

## 6. PR 4 — Challenge runs

**Goal:** add replay modifiers with permanent rewards (AD's #1 replay hook).

**Mechanic:**
- Add `g.challenge` (active challenge id or `null`) and `g.challengesDone` (array of completed ids) — **additive fields**, no SAVE_VER bump (same pattern as `goals`/`clicks`/`managerPaused`).
- `CHALLENGES` data table, each entry `{ id, name, desc, mod, reward }`:
  - `mod` is a modifier applied to the run (e.g. `{ flyers: 'locked' }`, `{ incomeMult: 0.5 }`, `{ startCash: 0 }`).
  - `reward` is a permanent account bonus granted on completion (e.g. `{ cashMult: +0.05 }`, `{ doorMax: +1 }`).
- **Start a challenge** = reset the run (fresh club) with the modifier active; the challenge is "won" when its completion condition is met (e.g. reach N regulars, buy X building).
- **Challenge selection UI** in the Prestige/Perks panel (or a new "Challenges" tab): list, each shows done/undone + reward.

**Key decisions (locked):**
- Challenges are **opt-in and reset the run**, so the default pacing bot never starts one — **zero pacing impact** on the existing bands. Add a *separate* `challengeRun()` in `pacing.mjs` only if a challenge's pacing needs a guard (optional; not required for ship).
- Completion rewards are **permanent account bonuses** stored in `g.challengeRewards` (additive map) or derived from `g.challengesDone` + the `CHALLENGES` table (prefer derived — no extra field).
- Challenge modifiers must route through the same `club(g)`/`rates(g)` paths; a locked building must be enforced in `buyBuilding` AND greyed in the card.
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

**Condition (locked):** every prestige perk is maxed (`this.PRESTIGE_PERKS.every(p => this.perk(g, p.id) >= p.max)`) **and** both clubs are unlocked (`g.clubs.main` and `g.clubs.annex` both present).

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

**Wipes (everything account-level except the two below):**

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
| `g.challengesDone` / `g.challengeRewards` | `[]` / `{}` (challenges re-lock) |
| `g.goals` / `g.clicks` / `g.rounds` | fresh / `0` / `0` |
| `g.whalesCount` / `g.specialsCount` / `g.golden` | `0` / `0` / `null` |

**Persists (the two permanent layers):**

| Field | Behavior |
|-------|----------|
| `g.renown` / `g.renownTotal` | Spendable + lifetime Renown. Never wipes. |
| `g.achievements` | Permanent unlocks, unchanged. |

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
- The **Brand panel** (PR 7) is gated on `g.renownTotal > 0` (or `g.renown > 0`), same pattern as the Perks tab gating on `prestiges > 0`.

### 8.7 Pacing guard

Add a `renownRun()` scenario to `pacing.mjs` (in PR 8, or a minimal version here): bot plays to max perks + both clubs → sells → asserts `renownTotal > 0` and that the reset produced a fresh `main` with `renown`/`achievements` intact. Named failures on gate miss or reset-shape violation.

### 8.8 Non-goals (second prestige v1)

- No third prestige layer (that's a future "Renown → Transcendence" if ever).
- No Renown → cash/Clout/Legacy conversion.
- No auto-sell (manual only).
- No per-club Renown.
- Brand perks (PR 7) are the only Renown sink in v1.

---

## 9. PR 7 — Renown unlocks: Brand perks + third club + location identity

**Goal:** make Renown *do* something (the "more to do" payoff).

**Mechanic:**
- **Brand perks** — `BRAND_PERKS` data table (mirrors `PRESTIGE_PERKS`: `{ id, name, cost, max, desc, req? }`), bought with Renown. Effects are account-wide and powerful (e.g. "all clubs +10% cash", "start each run with 2 regulars", "research costs −20%", "offline rate +10%").
- **Third club** — `'rooftop'`, unlocked by a Brand perk (or `renownTotal >= N`). Uses the existing `g.clubs` map + `freshClubState()`; the id namespace already supports it (SECOND_LOCATION.md §1).
- **Location identity** — each club gains a small set of **location-specific buildings/upgrades** (data-driven `LOCATION_EXTRAS = { main: [...], annex: [...], rooftop: [...] }`), so the three rooms are no longer "same catalog, different room." This supersedes SECOND_LOCATION.md §11's "no location-specific buildings" non-goal.

**Key decisions (locked):**
- Brand perks are bought with Renown only; they persist through the second prestige (they're the reason to sell again).
- Location-specific content is **additive** — the shared catalog still applies everywhere; extras are appended per location.
- The third club's unlock gate and its extras are data-driven; no new save-shape beyond what PR 6 added.

**Pacing impact:** Brand perks + location extras change the economy; re-baseline `pacing.mjs` and add the third-club scenario to `renownRun()`.

**Non-goals:** no more than 3 clubs in this pass; no cross-club cash transfer (still out); no per-club research (still out).

---

## 10. PR 8 — Endgame horizon + pacing guard

**Goal:** give the player a visible long-term goal and lock the whole pass behind a regression guard.

**Mechanic:**
- **Endgame horizon** — a visible goal line: "Build the franchise to 3 clubs and reach $1e12 (T)" or similar, surfaced in the Owner's List / a "Vision" panel. Purely a target + progress readout; no new mechanic.
- **Pacing guard** — extend `pacing.mjs` with `renownRun()` (full version): bot → max perks + both clubs → sell → assert reset shape + Renown accrual → buy a Brand perk → unlock rooftop → assert the third club plays faster than a no-Renown fresh run (mirrors `secondRoomRun()`'s `t2 < t1`).

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

- [ ] PR 1 — achievement multipliers + pacing re-baseline.
- [ ] PR 2 — flavor layer (news ticker + named regulars).
- [ ] PR 3 — deep research tree (tiers + prereqs + mechanic unlocks) + pacing re-baseline.
- [ ] PR 4 — challenge runs (modifiers + permanent rewards).
- [ ] PR 5 — upgradeable managers (levels).
- [ ] PR 6 — second prestige layer (SAVE_VER 10, Renown, reset scope, gate).
- [ ] PR 7 — Brand perks + third club + location identity.
- [ ] PR 8 — endgame horizon + `renownRun()` pacing guard.

---

## 13. Doc history

| Date | Note |
|------|------|
| 2026-08-15 | Initial design lock. Diagnoses the single-prestige dead-end; specs the second prestige layer ("Franchise Empire" → Renown, SAVE_VER 10) as the core, with 7 supporting PRs. Supersedes SECOND_LOCATION.md §11 "no location-specific buildings" (PR 7). |
