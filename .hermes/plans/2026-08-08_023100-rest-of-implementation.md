# Afterglow Club Idle — Rest of Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task (or implement directly with TDD).

**Goal:** Ship the remaining documented work after v0.9.5 (build 190, SAVE_VER 8): DESIGN.md refresh, small-screen responsive layout, achievement density expansion, burst-event variety, a balance-tuning pass, a profile-gated render throttle, and a design-gated second-location pass.

**Architecture:** Dependency-free static site (`index.html` + `style.css` + `game.js`). All logic is class `Game` in `game.js` (2785 lines); tests are dependency-free Node harnesses (`economy.test.mjs` 164 passing, `pacing.mjs` milestone bands + prestige scenario) that strip the boot lines and drive `Game` directly with a DOM prelude. No npm, no build step, no new runtime files.

**Tech Stack:** Vanilla JS (class fields, template literals), CSS grid + container queries, localStorage (SAVE_VER 8), `node` for validation/tests.

---

## Current context (what shipped vs what remains)

| Area | Status |
|------|--------|
| PLAN.md Phases 1–3 (correctness/robustness/organization) | ✅ shipped (0.5.x) |
| PLAN.md Phase 4: managers (4.1), special shifts (4.2), perk tree (4.3) | ✅ shipped (0.9.0–0.9.1) |
| Prestige system (PRESTIGE.md): gate, formula, perks, save v6→8 | ✅ shipped (0.8.0) |
| Achievements (23 in `ACHIEVEMENTS`), whales, buy-max, number fmt to Dc | ✅ shipped (0.8.1+) |
| Stage state-driven visuals + click floaters (IMPLEMENTATION_PLAN tasks 1–3) | ✅ shipped (0.7.x) |
| **DESIGN.md refresh to current systems** | ⬜ PLAN.md deferred list — doc targets v0.6.1/SAVE_VER 5; stale vs 0.9.x |
| **Small-screen stacking** | ⬜ IMPLEMENTATION_PLAN §6 runner-up — "not started; operator has not requested it" |
| **Achievement density** (23; genre norm 50–600) | ⬜ design-health gap (Tier 1 quick win) |
| **Burst-event variety** (whale + 3 special shifts only) | ⬜ design-health gap (Tier 1) |
| **Balance tuning** (numbers are placeholders; mechanics now stable) | ⬜ PLAN.md deferred — unlocked by 0.9.x stability |
| **Render throttle** (10 fps full-`innerHTML` re-render) | ⬜ PLAN.md deferred — profile-gated |
| **Second location** | ⬜ PRESTIGE.md non-goal; needs design pass first |

**Invariants that every phase must respect (AGENTS.md + repo docs):**
- `VERSION` num, visible build number, and `CHANGELOG` advance together on every behavior change.
- `SAVE_VER` bumps ONLY if the persisted save shape changes (currently 8).
- **Achievement Legacy rewards must credit BOTH `g.legacy` (spendable) and `g.legacyTotal` (lifetime)** — locked rule from the 0.9.5 fix; `legacy_50` and the Perks tab read `legacyTotal`.
- Preserve backward compatibility with existing `localStorage` saves; no offline elapsed-time double counting.
- No performer figure (v0.7.0 operator decision), no npm/build step, balance numbers off-limits unless the task is about balance.
- Gates before every commit: `node --check game.js`, `node economy.test.mjs` (0 failed), and `node pacing.mjs` (all milestones within band) where economy-affecting.

**Workflow convention:** branch per PR (repo history: `feature/perk-tree`, `fix/...`, `#NN` PRs), commit message style `fix:`/`feat:`/`docs:` with body. `.pr-body.md` exists at repo root as the PR-description scratch file — reuse it per PR.

---

## Phase 5 — DESIGN.md refresh to current systems (docs, no code)

**Objective:** Bring `DESIGN.md` (477 lines, targets v0.6.1/SAVE_VER 5) up to v0.9.5/SAVE_VER 8 so it documents prestige, achievements, managers, special shifts, the perk tree, whales, and the multi-tab lease system.

**Files:** `DESIGN.md` only. No `game.js` change; no version bump (docs-only).

### Task 5.1: Update spec header
Update the header block: spec target `game.js` v0.9.5, SAVE_VER 8; change "Related: `PRESTIGE.md` (future prestige)" to "(shipped 0.8.0)"; note `PLAN.md` Phases 1–4 all shipped.

### Task 5.2: Add prestige & meta section
Add a section (mirroring `PRESTIGE.md` but condensed): gate `g.regulars >= 25`, `legacyGain(g) = floor(sqrt(regulars) + night/7)`, reset/persist matrix, `PRESTIGE_PERKS` table (6 perks + req tree), `perk(g, id)` helper, `legacy`/`legacyTotal`/`prestiges`/`perks`/`managers`/`managerPaused` fields, SAVE_VER 8 migration chain.

### Task 5.3: Add achievements, managers, special shifts, whales
- Achievements: the full `ACHIEVEMENTS` table (23 entries), reward accounting rule (legacy rewards credit `legacy` AND `legacyTotal`).
- Managers: one per building, auto-buy via `buyBuilding` path, strike-gated, pause/resume, away-report line.
- Special shifts: `SPECIAL_CHANCE = 0.10` per rollover, `SPECIAL_SHIFTS` override shape `{name, mult, len, tint}`, never two in a row.
- Whale: spawn condition (hype > 0), not a click, cash bonus.
- Multi-tab: `OWNER_KEY`/`LEASE_KEY`/`PROBE_KEY` handshake, `CLAIM_OFFLINE_SEC = 15`, `tabStale` behavior, import-takes-ownership.

### Task 5.4: Verify
- No code changed: `git diff --stat` touches only `DESIGN.md`.
- Cross-check every number/table against `game.js` (the doc's own rule: "Source of truth for numbers: `game.js`").
- Commit: `docs: refresh DESIGN.md to v0.9.5 systems (prestige, achievements, managers, special shifts, whales)`

---

## Phase 6 — Small-screen stacking (responsive layout)

**Objective:** Below ~872px the three fixed-minimum columns force horizontal scrolling. Move the shell grid rule from the inline style to a `style.css` class with a `@media (max-width: 900px)` single-column fallback (Ledger / Stage / Systems stacked). Purely visual — no balance/save changes.

**Files:** `game.js` (shell `<main>` inline style, ~line 2640), `style.css` (new class + media query). No `SAVE_VER` bump.

### Task 6.1: Write the CSS class + media query (TDD-in-CSS: change style first, verify in browser)

In `style.css` add:

```css
/* Shell: three-column grid (v0.10.0). Replaces the inline grid on <main>. */
.shell-grid {
  display: grid;
  grid-template-columns: minmax(232px, 300px) minmax(320px, 720px) minmax(320px, 440px);
  width: 100%;
  max-width: 1460px;
  margin-inline: auto;
  min-height: 0;
  overflow: auto;
}

/* Small screens: stack Ledger / Stage / Systems vertically, no horizontal scroll. */
@media (max-width: 900px) {
  .shell-grid {
    grid-template-columns: 1fr;
    max-width: none;
    overflow-y: auto;
    overflow-x: hidden;
  }
  .shell-grid > section,
  .shell-grid > aside {
    min-width: 0;
  }
}
```

### Task 6.2: Swap the inline style for the class in game.js

Replace the `<main ... style="display:grid;grid-template-columns:...">` opening tag (line ~2640) with `<main data-scroll="main" class="shell-grid">`, keeping `data-scroll="main"`. Remove now-redundant inline grid props; keep `style.css`'s existing `#stage` container-query behavior intact (do not touch `@container` rules or the 720px stage cap).

### Task 6.3: Verify narrow-layout constraints
- The stage section keeps `grid-template-rows:minmax(190px,1fr) auto 132px` (its inline styles stay); the systems `<aside>` keeps its own `grid-template-rows`. Only the outer column layout moves to the class.
- Motion prefs (`html[data-motion="still"]`/`"easy"`) still apply — they're global CSS, unaffected.
- Ledger/systems min-widths must not force a page-level horizontal scrollbar at 320px viewport: verify `document.documentElement.scrollWidth <= innerWidth` at 360px and 900px widths.

### Task 6.4: Verify (browser)
```bash
cd /opt/data/stripper-dance && python3 -m http.server 8791 --bind 127.0.0.1
# http://127.0.0.1:8791/ at 1280px, 900px, 872px, 360px
```
- ≥901px: identical three-column layout to before (visual diff only: same grid).
- ≤900px: single column in order Ledger → Stage → Systems; no horizontal scroll; stage container queries still reflow the neon sign/crowd.
- Fresh save and an existing save both render; `node --check game.js`, `node economy.test.mjs` (164) green.
- Commit: `feat: stack shell columns below 900px (no horizontal scroll on small screens)` + VERSION/build/CHANGELOG bump (0.10.0, build 191).

---

## Phase 7 — Achievement density expansion

**Objective:** 23 → ~45 achievements (genre norm 50–600; Pillar 6). Add mid/late-game tiers and event-tied achievements. All new rewards follow the locked accounting rule (legacy rewards credit both `legacy` and `legacyTotal`).

**Files:** `game.js` (`ACHIEVEMENTS` array, line ~377), `economy.test.mjs` (new tests). No save-shape change → no SAVE_VER bump; `g.achievements` is an id array, new entries are backward compatible.

### Task 7.1: Write failing tests for new achievements (TDD)

Add to `economy.test.mjs` (pattern: existing `first_rail`/`legacy_50` tests). Representative:

```js
test('new building-tier achievements unlock at thresholds', () => {
  const game = newGame(50000);
  const g = game.state.g;
  g.b.rail = 25;
  g.b.vip = 10;
  game.checkAchievements(g);
  ok(g.achievements.includes('rail_25'), 'rail_25 unlocks at 25 rails');
  ok(g.achievements.includes('vip_10'), 'vip_10 unlocks at 10 VIP');
  ok(g.achievements.includes('all_buildings'), 'Empire still unlocks');
});

test('legacy-tier achievements credit legacyTotal only once per unlock', () => {
  const game = newGame();
  const g = game.state.g;
  g.legacyTotal = 99; // legacy_100 threshold
  game.checkAchievements(g);
  ok(g.achievements.includes('legacy_100'), 'legacy_100 unlocks at 100 lifetime');
  strictEqual(g.legacy, g.legacyTotal - 99 + 100 /* see reward */, 'spendable and lifetime both credited');
  // Second pass: no double credit
  game.checkAchievements(g);
  strictEqual(g.legacyTotal, 100 + 3, 'no double credit on re-check');
});
```

### Task 7.2: Run to verify failure
Run: `node economy.test.mjs` — expected: new tests FAIL (ids not in `ACHIEVEMENTS`, rewards not credited).

### Task 7.3: Implement — add achievement entries

Append to `ACHIEVEMENTS` (before `max_perks` or after; `checkAchievements` iterates the array so order only affects unlock order — keep narrative order):

```js
{ id: 'rail_25', name: 'Rail King', desc: 'Own 25 Tip Rails', check: g => g.b.rail >= 25, reward: { clout: 4 } },
{ id: 'vip_10', name: 'Penthouse Row', desc: 'Own 10 VIP Booths', check: g => g.b.vip >= 10, reward: { clout: 6 } },
{ id: 'hype_200', name: 'White Hot', desc: 'Reach 200 Hype', check: g => g.hype >= 200, reward: { clout: 5 } },
{ id: 'patrons_100', name: 'Over Capacity', desc: '100 patrons on floor', check: g => g.patrons >= 100, reward: { clout: 4 } },
{ id: 'regulars_50', name: 'Institution', desc: '50 Regulars', check: g => g.regulars >= 50, reward: { clout: 8 } },
{ id: 'night_25', name: 'Month One', desc: 'Survive 25 nights', check: g => g.night >= 25, reward: { clout: 3 } },
{ id: 'night_50', name: 'Seasoned', desc: 'Survive 50 nights', check: g => g.night >= 50, reward: { clout: 5 } },
{ id: 'click_5000', name: 'Crowd Workout', desc: 'Work the room 5,000 times', check: g => g.clicks >= 5000, reward: { clout: 4 } },
{ id: 'prestige_10', name: 'Franchise Empire', desc: '10 franchise deals', check: g => g.prestiges >= 10, reward: { legacy: 10 } },
{ id: 'legacy_100', name: 'Legacy Titan', desc: 'Accumulate 100 Legacy', check: g => g.legacyTotal >= 100, reward: { legacy: 3 } },
{ id: 'legacy_250', name: 'Immortal Name', desc: 'Accumulate 250 Legacy', check: g => g.legacyTotal >= 250, reward: { legacy: 5 } },
{ id: 'all_managers', name: 'Full Staff', desc: 'Hire every manager', check: g => this.MANAGERS.every(m => g.managers && g.managers[m.id]), reward: { legacy: 4 } },
{ id: 'special_1', name: 'Event Night', desc: 'Survive a special shift', check: g => (g.specialsCount || 0) >= 1, reward: { clout: 3 } },
{ id: 'whale_1', name: 'Big Spender', desc: 'Host a whale', check: g => (g.whalesCount || 0) >= 1, reward: { clout: 2 } },
{ id: 'all_crew_jobs', name: 'Full Rotation', desc: 'Assign crew to every job', check: g => g.jobs.stage >= 1 && g.jobs.vipjob >= 1 && g.jobs.floor >= 1, reward: { clout: 2 } },
```

### Task 7.4: Add the two counters (additive fields, NO SAVE_VER bump)

`g.specialsCount` and `g.whalesCount` are additive counters — same pattern as `goals`/`clicks`/`rounds` (PLAN-NEXT §B precedent): backfilled by `sanitizeG`/migration as `|| 0`, never required by validation. Increment in `spawnWhale(g)` (`g.whalesCount = (g.whalesCount || 0) + 1`) and at special-shift rollover (`g.specialsCount = (g.specialsCount || 0) + 1`). **Do NOT bump SAVE_VER** — absent keys read as 0 (mirror `managerPaused` precedent in 0.9.3).

### Task 7.5: Run tests to verify pass
Run: `node economy.test.mjs` — expected: new tests PASS, total ≈ 175+; `node --check game.js` clean.

### Task 7.6: Backfill on load
`init()` already backfills earned achievements (0.8.1 pattern) — the new entries flow through automatically. Add one test asserting a legacy save with `rail: 25` loads with `rail_25` credited (mirror existing `init backfills achievements` test).

### Task 7.7: Commit
`feat: 15 new achievements (building tiers, legacy tiers, events)` + VERSION/build/CHANGELOG bump (0.10.1, build 192). Changelog notes the achievement-Legacy accounting rule applies to all new rewards.

---

## Phase 8 — Burst-event variety

**Objective:** Expand beyond the single whale + 3 special shifts (Pillar 3). Add 1–2 low-cost burst events that reuse existing systems — no new art.

### Task 8.1: Add "Critic" event (risk/reward)
A critic visits during Peak (`hype >= 30`), random 2% per night: if the room is strong (`patrons >= 20`) → +Hype bonus + Clout; if weak → −Hype (review bites). Implement as a `maybeCritic(g)` called from `step()` at shift rollover, data-driven chance constant `CRITIC_CHANCE = 0.02`, log line with existing color tokens. TDD first: deterministic via `withRandom()` (existing helper in `economy.test.mjs`).

### Task 8.2: Add "Golden ticket" (mini golden-cookie)
Rare (0.5%/tick at `hype > 0`), clickable floating offer in the stage template when active: "VIP booked the booth — take the $ or grow the crowd?" Reward: cash (scaled by `cashIncomeMult`) OR +patrons. Needs a small `g.golden` state (additive, no SAVE_VER bump) and a render branch. Simpler fallback if scope balloons: skip the choice, single reward (`g.cash += 25 * cashIncomeMult(g)`).

### Task 8.3: Verify
New tests for both events (deterministic trigger, reward accounting, log lines, no double-fire); `node --check` + `node economy.test.mjs` green; commit `feat: critic review and golden ticket burst events` + VERSION/build/CHANGELOG (0.10.2, build 193).

---

## Phase 9 — Balance tuning pass (numbers only, no mechanic changes)

**Objective:** Mechanics are stable (0.9.5). Now validate and tune pacing against `pacing.mjs` milestone bands + prestige scenario, using economy heuristics. This is the first task that legitimately touches balance (AGENTS.md allows when the task concerns balance).

**Files:** `game.js` (cost/rate constants only), `pacing.mjs` (bands, if a target moves), `economy.test.mjs` (guards). No save-shape change.

### Task 9.1: Baseline
Run `node pacing.mjs`; record every milestone actual vs band (rail, crew, patrons, LED, research, all upgrades, prestige-run t1/t2). Save output as the baseline note in the PR body.

### Task 9.2: Audit against heuristics
- First prestige within **20–40 min** active play (currently the bot's prestige-run scenario gates at `regulars >= 25` — check actual).
- Building cost growth **1.15–1.25**/level; upgrade costs 10–100× building cost at tier; research logarithmic in Clout.
- Prestige n→n+1 accelerates **0.7–0.9×** previous time (perk impact +10–25%/rank).
- Offline 50% base / 65% with `offline65`, 8h cap — already shipped; just re-verify.
Adjust only numbers in `BUILDINGS`/`UPGRADES`/`RESEARCH`/`rates()`/goal rewards. No mechanic changes, no new systems.

### Task 9.3: Tune and re-run
For each out-of-band milestone, adjust the smallest number that moves it into band (prefer cost over rate; prefer early-game knobs). Re-run `node pacing.mjs` until all bands green AND prestige-run `t2 < t1` holds. Re-run `node economy.test.mjs` (164+ must stay green — they assert relationships like catchUp≈50% live, not absolute numbers, so they should hold; if a test pins a number that moves, update the test deliberately).

### Task 9.4: Commit
`chore: balance pass — pacing bands green (PLAN deferred item)` + VERSION/build/CHANGELOG (0.10.3, build 194). Changelog lists each moved number.

---

## Phase 10 — Render throttle (profile-gated, optional)

**Objective:** The 100ms tick calls `forceUpdate()` → `render()` → full `root.innerHTML` every 10 fps. PLAN.md deferred this "only if profiling shows a problem."

### Task 10.1: Profile first (gate)
In the browser (or a headless run), measure `render()` cost: `performance.mark` around the template build; sample over 60s at a busy state (patrons 100, all buildings). If render > ~8ms average (i.e., >8% of a 100ms tick) or jank is visible, proceed; else stop and document "no action needed."

### Task 10.2: Throttle cadence (if gated through)
Change the tick loop to render at most every 250ms (4 fps) while the sim still steps every 100ms: keep `this.state.tick` incrementing every tick, but only call `forceUpdate()` when `Date.now() - lastRender >= 250` (or on action/`setState`). FX layer (`fxLayer` outside `#app`) and Look panel are untouched. Stage CSS animations are not DOM-replacements, so 4 fps render is visually identical.

### Task 10.3: Verify
- No behavior change: all 164+ tests green; manual play for 5 min (click floaters still spawn — they're outside `#app`; actions still re-render immediately via `forceUpdate` in handlers).
- Measure again: render cost per second down ~60%.
- Commit only if gated through: `perf: throttle full re-render to 4fps (tick stays 10Hz)` + VERSION/build/CHANGELOG (0.10.4, build 195).

---

## Phase 11 — Second location (design pass FIRST; implementation gated)

**Objective:** PLAN.md defers "second location — its own design pass beyond 0.9.0"; PRESTIGE.md §8 lists it as an explicit non-goal that "a later plan may supersede deliberately." Do the design doc before any code, mirroring the `PRESTIGE.md` pattern (doc-only PR first, locked decisions, then implementation PR).

### Task 11.1: Design doc (`SECOND_LOCATION.md`)
- Fantasy/pitch, gate & unlock fantasy (e.g., "Franchise the second room" from the franchise deal itself).
- Reset/meta interplay: does the second location share Legacy? Its own currency? A `g.clubs` map keyed by location id?
- Save shape: `SAVE_VER` 9 migration sketch (additive fields, defaults, old-save compat).
- Pacing: second room's first-run target, its own `pacing.mjs` scenario or band extension.
- Explicitly supersede PRESTIGE.md §8 non-goals it touches (second-location simulation, multi-club map).
- Non-goals for the second room (e.g., no travel map in v1, no cross-room scheduling).

### Task 11.2: Lock decisions, then implement (separate PRs)
Doc PR first (`docs: second-location design (PLAN deferred item)`). Implementation is its own plan phase gated on design lock — do NOT implement in this pass.

---

## Execution rules (all phases)

1. **Gates before every commit:** `node --check game.js`, `node economy.test.mjs` (0 failed), `node pacing.mjs` green where economy-affecting.
2. `VERSION` num + build + `CHANGELOG` advance together on every behavior change; docs-only phases skip the bump.
3. `SAVE_VER` stays 8 throughout unless a phase explicitly changes the persisted shape (only Phase 11 may, and only in its implementation PR).
4. Legacy-rewarding achievements MUST credit both `g.legacy` and `g.legacyTotal` (locked rule; regression-tested in Phase 7).
5. No performer figure, no npm/build step, no new runtime files (tests/harness files excluded).
6. Branch per phase off `main` (or the current release branch); every phase ships as a PR — after commit, run `/opt/data/.git-helpers/new-pr.sh "<title>" [.pr-body.md]` which pushes and opens the PR in one step (no bare branch pushes).
7. Offline progression correctness and no elapsed-time double counting remain primary invariants — the harness asserts both.

## Risks, tradeoffs, open questions

- **Phase 9 (balance) is the highest-risk phase** — it changes the feel of the whole game. Mitigate: pacing.mjs bands are the contract; tune smallest-number-first; keep changelog explicit; any number pinned by a test moves deliberately with a comment.
- **Phase 10 may be a no-op** if profiling shows render is cheap — that is a valid outcome; do not force the change (YAGNI).
- **Phase 7 counters** (`whalesCount`/`specialsCount`) are additive and don't bump SAVE_VER — confirm `sanitizeG` won't reject saves lacking them (it must not; mirror `goals`/`clicks` handling).
- **Phase 11 scope risk** — the second location could double the game's surface. The design doc gates this: if the design's save-shape delta exceeds additive fields, split into multiple implementation PRs.
- **Open question:** should `whale_1`/`special_1` achievements be gated behind `metaUnlocked`-style visibility, or shown always? Default: always visible (achievements modal already lists all ids; checks are live).
- **Order note:** Phases 5–8 and 10 are independent and parallelizable; Phase 9 should land after 7–8 (they add income events that pacing.mjs's bot may or may not simulate — the bot must not randomly roll events during its deterministic runs; keep `maybeCritic`/`golden` OFF in the bot path or seeded deterministic, else bands flake).
