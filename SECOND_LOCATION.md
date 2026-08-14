# SECOND_LOCATION.md — Second Club Design

**Status:** design lock for first implementation; save-shape groundwork shipped (SAVE_VER 9, 0.11.0); second-room gameplay shipped (Slice B, 0.11.1); second-room pacing scenario pending (Slice C)  
**Scope:** this doc + the save-shape slice (0.11.0) + the second-room gameplay slice (0.11.1); `pacing2.mjs` scenario pending  
**Depends on:** prestige/shift/achievement systems shipped through v0.10.4 (SAVE_VER 8)
**Save format:** SAVE_VER 8 → **9** (shipped in 0.11.0)

This doc is intentionally complete enough for a later implementation PR: no open design questions for the first second-club ship. Numbers cite the post-0.10.4 balance intent; if live costs drift, re-check the worked tables and the second-room pacing scenario, not the fantasy.

---

## 1. Fantasy & name

**Fantasy.** The franchise group that bought the first room now wants a second property — a smaller, scrappier club in a different part of town. The player keeps the brand (Legacy), the research playbook (Clout), and the accumulated know-how, but the new room starts empty: its own till, its own crowd, its own building stack. Two clubs run in parallel, each with independent cash flow and build state, sharing a single Legacy/Clout/Research ledger and the same prestige history.

**Pitch (in-world).** After the first franchise deal proved the concept, the backer offers a lease on a second room. Same neon, different zip code. Cash is local; reputation is not.

**Currency model (unchanged, locked):**

| Currency | Role |
|----------|------|
| **Cash** | Per-club run currency. Each club has its own `cash`. Wipes on prestige only; moving cash between clubs is out of scope. |
| **Clout** | Shared research currency. Earned from the active club's Regulars; spent once on the global Research tab. Inactive clubs do not generate Clout in v1. |
| **Legacy** | Shared prestige currency. Earned on prestige; spent on perks + managers across the whole account. |

Do **not** add a new meta currency for the second club. Do **not** rename Clout or Legacy. UI copy may say "second room" or "new location"; the resource labels stay Cash/Clout/Legacy.

**Internal ids (locked):**

| Concept | Id / field |
|---------|------------|
| Club map | `g.clubs` (object map `clubId → Club`) |
| Active club id | `g.activeClub` (string) |
| First club id | `'main'` (canonical; pre-SAVE_VER 9 migrates here) |
| Second club id | `'annex'` (unlock target) |
| Club shape | `{ cash, hype, buzz, patrons, regulars, b, u, elapsed, night, shiftIdx, shiftT, _specialShift, _whaleCooldown }` |

The club id namespace is intentionally a plain string so future rooms can add `'rooftop'`, `'warehouse'`, etc. without a SAVE_VER bump.

---

## 2. Gate & unlock fantasy

**Condition (locked):** `g.prestiges >= 1` **and** the player has hired **at least one manager** (`Object.values(g.managers).some(Boolean)`).

This ties the second room to the post-prestige fantasy: the backer only trusts you with a second lease once you've proven you can franchise once and delegate at least one building. The gate is evaluated on the **account** (`g.prestiges`, `g.managers`), not on the active club's state.

**UI affordance:**

- When the gate is met, a header control **"Open second room"** appears next to the existing **Franchise offer** family.
- Below the gate, the control is absent (not disabled gray). No second-room teaser before the player has franchised once.
- Clicking opens the **confirmation modal** with a preview of what unlocks and what stays shared. Confirm commits; cancel closes with no state change.
- Unlocking the second room is **not a prestige**. It is a one-time account unlock. It does **not** reset the first club.

**Stale tab (`tabStale`):** while `tabStale` is true, the unlock action is blocked (same rule as prestige — do not award account progress only in memory). Show the same reload-to-continue copy.

---

## 3. What resets, what persists, what is shared

### Account-level (shared across all clubs; persists through prestige)

| Field | Behavior |
|-------|----------|
| `g.clubs` | Map of all unlocked clubs. Never wiped by prestige. |
| `g.activeClub` | Last viewed club. Persists. |
| `g.clout` | Shared research currency. Earned from the active club's Regulars; spent globally. Inactive clubs do not generate Clout in v1. |
| `g.legacy` / `g.legacyTotal` | Shared prestige currency. |
| `g.perks` | Shared perk ranks. |
| `g.prestiges` | Count of franchise deals. |
| `g.managers` / `g.managerPaused` | Managers are account-level; their auto-buy targets whichever club is active when the manager fires. |
| `g.achievements` | Account-wide permanent unlocks. |
| `g.research` (`g.r`) | Research is account-level; one purchase benefits the whole account. |
| `g.goals` / `g.clicks` / `g.rounds` | Owner's List stays account-level for v1. Goal checks can look at the active club or aggregate account state; see §6. |

### Club-level (per-club; persists through active-club switches; resets on prestige)

| Field | Behavior |
|-------|----------|
| `cash` | Local till. Cannot be transferred. |
| `hype`, `buzz`, `patrons`, `regulars` | Local room state. |
| `b` (buildings) | Local building counts. |
| `u` (upgrades) | Local upgrade flags. |
| `elapsed`, `night`, `shiftIdx`, `shiftT` | Local shift/night clock. |
| `_specialShift` | Special-shift override index (set alongside `shiftIdx`/`shiftT` in `advanceShift`). |
| `_whaleCooldown` | Whale-spawn cooldown timer (driven by `hype`). |

### Shared roster (top-level, resets on prestige like today)

| Field | Behavior |
|-------|----------|
| `crew` | Shared across clubs. Resets to 0 on prestige (or 1 with `startCrew` perk). Excess crew pushed to `off` when switching clubs with a smaller Dressing Room count. |
| `jobs` | Shared assignment map (`stage`/`vipjob`/`floor`/`off`). Resets on prestige. |

### Prestige reset rules for multi-club v1

On prestige, **all clubs reset to fresh-run-equivalent club state**, but the account keeps the shared fields above. The post-prestige candidate:

1. Preserves `g.clubs` keys but replaces every club's run fields with a fresh club state.
2. Keeps `g.activeClub` as the club that was active at prestige time (usually `'main'`).
3. Applies start-of-run perks (`startCrew`, `startFlyers`) to the active club only, mirroring the current single-club behavior. Future designs may distribute starters across clubs; v1 does not.

This is a deliberately conservative reset: the player does not get N independent runs of income immediately after prestige. The long-term leverage comes from shared Clout/Legacy/Research and from future clubs being able to start with global perks.

---

## 4. Club shape (SAVE_VER 9)

### New / changed fields on `g`

```js
activeClub: 'main',          // id of the club currently being viewed/simmed
clubs: {                     // map of unlocked clubs
  main: {                    // migrated pre-v9 save lives here
    cash, hype, buzz, patrons, regulars,
    b, u,
    elapsed, night, shiftIdx, shiftT, _specialShift, _whaleCooldown
  },
  // annex added on unlock
}
```

Fields that move from the top-level `g` into each club:

```text
cash, hype, buzz, patrons, regulars, b, u,
elapsed, night, shiftIdx, shiftT, _specialShift, _whaleCooldown
```

Fields that stay at the top level of `g` (account/shared):

```text
clout, legacy, legacyTotal, perks, prestiges,
research (r), managers, managerPaused, achievements,
goals, clicks, rounds,
whalesCount, specialsCount, golden,
ts, log (shared night log, see §8),
crew, jobs,
clubs, activeClub
```

### Migration sketch (v8 → v9)

```js
// MIGRATIONS[8]: v8 → v9 second-club club map
8(g) {
  // Move current run state into the main club.
  const main = {};
  const clubFields = ['cash','hype','buzz','patrons','regulars','b','u','elapsed','night','shiftIdx','shiftT','_specialShift','_whaleCooldown'];
  for (const k of clubFields) {
    main[k] = g[k];
    delete g[k];
  }
  // Ensure sub-objects exist and are plain.
  if (!main.b || typeof main.b !== 'object' || Array.isArray(main.b)) main.b = {};
  if (!main.u || typeof main.u !== 'object' || Array.isArray(main.u)) main.u = {};
  for (const def of this.BUILDINGS) if (typeof main.b[def.id] !== 'number') main.b[def.id] = 0;
  for (const def of this.UPGRADES)   if (typeof main.u[def.id] !== 'boolean') main.u[def.id] = false;
  main.elapsed = typeof main.elapsed === 'number' ? main.elapsed : 0;
  main.night = typeof main.night === 'number' ? Math.max(1, main.night) : 1;
  main.shiftIdx = typeof main.shiftIdx === 'number' ? main.shiftIdx % this.SHIFTS.length : 0;
  main.shiftT = typeof main.shiftT === 'number' ? main.shiftT : 0;
  main._specialShift = main._specialShift != null && Number.isInteger(main._specialShift) ? main._specialShift : null;
  main._whaleCooldown = typeof main._whaleCooldown === 'number' ? main._whaleCooldown : 0;

  g.clubs = { main };
  g.activeClub = 'main';
}
```

`isValidSavePayload` must **not** require `g.clubs` — migration fills it. `sanitizeG` must fail-closed: if `g.clubs` is missing or malformed, reconstruct `{ main: freshClub() }` from top-level fields or from a full fresh state.

**v9 import compatibility note:** the existing `isValidSavePayload` hard-requires `cash`, `hype`, `buzz`, `patrons`, `regulars` as numeric fields directly on `g`. After the v8→v9 migration, these fields live inside `g.clubs.main`, not on `g` directly. A natively-exported v9 save will lack these top-level fields, so the current validator would reject it. The fix: change `isValidSavePayload` to check `g.clubs?.main?.cash ?? g.cash` (and likewise for `hype`, `buzz`, `patrons`, `regulars`). This avoids duplicating state back to the top level and is consistent with the `club(g)` helper pattern used everywhere else. The migration chain runs *after* validation, so the validator sees either the pre-migration shape (fields on `g`) or the post-migration shape (fields in `g.clubs.main`).

*Implementation note:* `?.` (optional chaining) does not appear in `game.js` today. The implementer may choose to keep the codebase free of it (e.g. `g.clubs && g.clubs.main && g.clubs.main.cash`) or introduce it here as the first use — either is fine as long as it's intentional.

---

## 5. Simulation changes

### `club(g)` helper

```js
club(g, id = g.activeClub) {
  const c = g.clubs && g.clubs[id];
  return c || (g.clubs && g.clubs.main);
}
```

Single helper used everywhere a club-specific value is read. No scattered `g.clubs[g.activeClub]` copies. The explicit parens `c || (g.clubs && g.clubs.main)` avoid precedence ambiguity (`&&` binds tighter than `||`).

### `activeClub(g)` / `setActiveClub(id)`

- `setActiveClub` switches `g.activeClub` and immediately re-renders.
- The previously active club pauses earning; the new active club resumes. There is **no cross-club offline earning** while a club is inactive — its `ts` is not advanced, and `catchUp` runs only for the active club on load. This avoids double-counting and keeps v1 simple.
- Managers auto-buy only for the **active club**.
- Whale / critic / golden events run only on the **active club**.

### `rates(g)`, `caps(g)`, `step(g, dt)`, `catchUp(g, seconds)`

All economy helpers are refactored to take a **club object** as the mutable state source while reading account-level fields from `g`:

```js
const c = this.club(g);
const cap = this.caps(g, c);   // crew is shared; cap derived from active club's Dressing Rooms
```

Crew capacity (`caps().crew`) is derived from the **active club's** Dressing Rooms, because crew is physically assigned to the active room. If the player switches clubs, the crew cap may shrink; excess crew are pushed to `off`. **Shipped (0.11.1):** `setActiveClub` runs the cap-aware rebalance — evicts excess crew to `off` in order **floor → stage → VIP** (least-valuable roles first; deterministic). The existing jobs/crew rebalance pass in `sanitizeG` only rebalances `g.jobs` against `g.crew` count — it has no notion of `caps(g).crew` or evicting crew when a cap shrinks.

Clout is earned into the shared `g.clout` from the active club's Regulars only. Inactive clubs do not generate Clout. This is v1's simplicity tradeoff; future designs may accrue Clout across all clubs at a reduced rate.

### Offline progression

Offline `catchUp` runs only for the active club. `g.ts` is a single shared timestamp updated by the active club's simulation. When the player returns, only the active club's offline window is computed from `g.ts` and applied. Switching to a previously-inactive club afterward will see `offline = 0` (its offline window is not stored separately) — this matches the non-goal in §11 (inactive-club offline earnings out of scope for v1). The player must reload on that club to capture its future offline progress.

---

## 6. Owner's List in multi-club v1

Owner's List remains account-level. Goal checks reference the **active club** for structure/stat goals, except where an aggregate makes more sense:

All 14 goal ids, with the field each `check` reads today and where it resolves under `g.clubs`:

| # | Goal id | Reads today | Source in v1 |
|---|---------|-------------|--------------|
| 1 | `work` | `g.clicks >= 5` | account (clicks are not per-club) |
| 2 | `rail` | `g.b.rail >= 1` | active club |
| 3 | `word` | `g.b.flyers >= 1` | active club |
| 4 | `pulse` | `g.patrons >= 8` | active club |
| 5 | `contract` | `g.crew >= 1` | account (shared roster) |
| 6 | `energy` | `g.hype >= 25` | active club |
| 7 | `house` | `g.rounds >= 1` | account |
| 8 | `backstage` | `g.b.vip >= 1` **and** `g.jobs.vipjob >= 1` | **mixed** — club `b`, shared `jobs` |
| 9 | `regulars` | `g.regulars >= 3` | active club |
| 10 | `study` | any `g.r[d.id]` | account (research) |
| 11 | `roster` | `g.b.dress >= 1` **and** `g.crew >= 3` | **mixed** — club `b`, shared `crew` |
| 12 | `peak` | `g.hype >= 60` **and** `g.shiftIdx === 1` | active club (live only) |
| 13 | `builtin` | any `g.u[d.id]` | active club (`u` is club-level per §4) |
| 14 | `name` | `g.regulars >= 25` | active club |

> **Implementer note.** Goals 8 and 11 straddle the boundary: each predicate reads one
> club-level field (`b`) and one shared-roster field (`jobs` / `crew`). They cannot be
> rewritten as a blanket `club(g).x` substitution — split the two halves explicitly.

Goal rewards are paid to the active club's cash or account Clout as today. Goal 14 (`name`) remains the per-club prestige gate for the active club.

Prestige-tier Owner's List goals are still out of scope (this doc inherits PRESTIGE.md §8 non-goal).

---

## 7. Achievements

Existing achievements remain account-level and check the **active club** where state is club-local. No new second-room achievements in v1 — the design opens the door but does not add a new collection tier yet.

Future achievements may count "all clubs at N regulars" or "unlock every location"; v1 does not.

---

## 8. UI sketch

### 8.1 Header — "Open second room" / club switcher

- **Before unlock:** no second-room chrome.
- **After unlock:** a compact club switcher appears near the shift badge: `[ main ] [ annex ]`.
- Switching is instant and re-renders the full UI; the inactive club pauses.
- A small lock icon + tooltip on the header explains the gate before unlock.

### 8.2 Ledger

Cash, Hype, Buzz, Patrons, Regulars now reflect the **active club**. Clout and Legacy remain account-level. Add a subtle label: **"Annex"** or **"Main Room"** above the resource block so the player knows which club is live.

### 8.3 Systems / Club tab

The existing **Club** tab stays focused on the active club's buildings and upgrades. No new tab needed for v1. Research is account-level (already is). Perks/Managers remain account-level.

### 8.4 Night log

v1 keeps **one shared night log** at `g.log` to avoid per-club log complexity. When the player switches clubs, new log lines append to the same ledger. A prefix like `[Main]` / `[Annex]` can be added to log lines if cheap; otherwise the active-club label in the ledger is sufficient.

Future designs may move logs into each club; v1 does not.

### 8.5 Stage

Stage art is unchanged. The crowd silhouette count, beam opacity, and neon flicker all read from the active club's state.

---

## 9. Save format (v8 → v9)

**Bump `SAVE_VER` to 9** only in the implementation PR.

- `fresh()` initializes `g.clubs = { main: freshClub() }` and `g.activeClub = 'main'`.
- Old v8 saves migrate by moving top-level run fields into `g.clubs.main`.
- `sanitizeG` must reconstruct `g.clubs` if it is missing/malformed and fall back to a fresh main club.
- File/clipboard import runs the migration chain normally.
- `isValidSavePayload` must be relaxed to accept v9 saves where `cash`/`hype`/`buzz`/`patrons`/`regulars` live inside `g.clubs.main` rather than on `g` directly (see §4 v9 import compatibility note).

---

## 10. Balance hooks (`pacing2.mjs`)

Add a second-room pacing scenario (new file `pacing2.mjs`, or an extension in `pacing.mjs` if cleaner) that verifies the unlock pacing and the post-unlock acceleration.

### Scenario: `second-room`

1. **Run 1:** reference bot plays from a fresh post-prestige start (1 Legacy spent on `cash10` rank 1, one manager hired, same as prestige scenario end state) until it meets the second-room gate: `prestiges >= 1` and `>= 1` manager.
2. **Unlock:** unlock the annex.
3. **Run 2:** bot plays the annex from fresh club state (cash = starting cash, no buildings) with the account's Legacy perks and research intact.
4. Record wall-time of first LED upgrade in the annex (`t2`).
5. Compare against a baseline `t1` recorded from the same bot starting a fresh club **without** any account perks/research (use a stripped fresh state).
6. **Assert:** `t2 < t1` (account progress makes the second room faster).

### Reporting

```text
Second room scenario
  gate met at: …s (prestiges=…, managers=…)
  annex first LED (with account progress): …s
  fresh club first LED (no progress): …s
  delta: …s (must be < 0)
```

On gate miss: print `FAIL: second-room gate not reached` and skip the comparison.

### Tuning policy

- If the assert fails, prefer tuning manager cost/accessibility or the cash10 perk magnitude — not reopening the gate or the club-shape design.
- The scenario is a regression guard for "account progress must matter in a new room," not a full multi-club balance suite.

---

## 11. Non-goals (first implementation)

Explicitly **out of scope** for the first second-club ship:

| Non-goal | Rationale |
|----------|-----------|
| Travel / map UI | No world map; club switching is a header toggle. |
| Cross-club cash transfers | Keeps each club's economy honest; avoids a new transfer UI. |
| Inactive-club offline earnings | Simplicity + no double-counting; only active club advances offline. |
| Per-club crew roster | Crew is shared/account-level in v1. |
| Per-club research tree | Research stays global. |
| More than 2 clubs in v1 | The id namespace supports more; only `main` + `annex` ship. |
| New second-room achievements | Existing achievement catalog is sufficient for v1. |
| Second-room prestige goal | Prestige goals remain out of scope (PRESTIGE.md §8). |
| Auto-prestige per club | Manual prestige modal only; prestige resets all clubs. |
| Cross-club scheduling / shift coordination | Each club has its own shift clock. |
| Crew restore on switch-back | Excess crew pushed to `off` when switching to a smaller-capacity club stay in `off` until manually reassigned; no auto-restore on returning to a larger-capacity club. |
| New buildings/upgrades unique to the annex | Annex uses the same catalog; future design may add location-specific content. |

If a later plan wants world maps, inactive earnings, or per-club crew, it supersedes this section deliberately — not by creeping into v1.

---

## 12. Superseding PRESTIGE.md §8

`PRESTIGE.md` §8 lists these non-goals:

- Second-location simulation
- Multi-club map / travel

This design **explicitly supersedes** both for a future implementation PR. The other §8 non-goals remain locked:

- Prestige-tier Owner's List goals — still out.
- Leaderboards / cloud ranks — still out.
- Legacy → cash/Clout conversion — still out.
- Perk refunds / respec — still out.
- Auto-prestige — still out.
- Franchise Binder research revival — still out.
- Changing SHIFTS / offline cap / walk-in as prestige levers — still out.

---

## 13. Implementation checklist

Slice A (save-shape groundwork, 0.11.0) and Slice B (second-room gameplay, 0.11.1) items are marked done; unchecked items are the remaining second-room pacing scenario (Slice C):

- [x] `club(g, id)` helper; replace direct top-level cash/hype/etc. reads in `rates`/`caps`/`step`/`catchUp`.
- [x] `activeClub` + `setActiveClub` action; header switcher.
- [x] "Open second room" unlock button + modal; gate on `prestiges >= 1` and `>= 1` manager.
- [x] SAVE_VER 9 + `MIGRATIONS[8]` moving top-level fields into `g.clubs.main`.
- [x] `isValidSavePayload` relaxed to accept v9 saves: reads club resources from the active club (own-property lookup; fallback `main` → any own club → top-level).
- [x] `fresh()` initializes `g.clubs.main` + `g.activeClub`.
- [x] Prestige reset preserves `g.clubs` keys but freshens every club's run state; applies starters to active club only.
- [x] Managers auto-buy only for active club; whale/critic/golden events only for active club (all routed through `club(g)`).
- [x] Offline `catchUp` runs only for the active club; `g.ts` is shared, inactive club offline window not stored.
- [x] `sanitizeG` reconstructs `g.clubs` fail-closed (incl. reserved club-ID rejection).
- [x] Cap-aware crew rebalance in `setActiveClub`: compares `g.crew` against `caps(g).crew` for the newly active club and pushes excess to `off` (floor → stage → VIP).
- [x] `ACHIEVEMENTS` checks that read `g.b.*` / `g.u.*` are routed through `club(g)` (or `check` receives the active club) so building/upgrade achievements don't throw once `b`/`u` move off `g`.
- [x] Owner's List goal checks that read `g.b.*` / `g.hype` / `g.patrons` / etc. are routed through `club(g)` (same fix shape as achievements) — **except** `backstage` and `roster`, whose predicates read both a club field (`b`) and a shared-roster field (`jobs` / `crew`); see the §6 table.
- [x] Ledger shows active-club label; Clout/Legacy remain account-level.
- [ ] `pacing2.mjs` second-room scenario green.
- [x] VERSION + build + CHANGELOG together; SAVE_VER 9 (0.11.0).
- [ ] No travel map, no cash transfers, no inactive earnings, no per-club crew, no location-specific buildings in v1.

---

## 14. Doc history

| Date | Note |
|------|------|
| 2026-08-08 | Initial design lock for Phase 11. Mirrors PRESTIGE.md pattern; gates second-room implementation on account-level prestige + manager delegation; defines SAVE_VER 9 `g.clubs` map; supersedes PRESTIGE.md §8 second-location non-goals. |

| 2026-08-08 | Review pass: §6 Owner's List table rewritten against the real `GOALS` array (all 14 ids; `bar`/`flyers` were not goal ids — the flyers goal is `word`; `regulars` threshold is 3, not 25) and flags `backstage`/`roster` as straddling the club/shared-roster boundary. Replaced brittle `game.js:NNN-NNN` citations with symbol references. `PRESTIGE.md` §8 and `PLAN.md` deferred item now cross-reference this doc. |
