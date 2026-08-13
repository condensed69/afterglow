# PLAN.md — Afterglow Club Idle: Logic Fix Plan

**Audited:** 2026-08-03 against `game.js` (914 lines, v0.4.1 build 143, SAVE_VER 4)
**Scope:** Correctness, robustness, and organization of game logic. Balance numbers remain early-stage placeholders per AGENTS.md and are only touched where a mechanic itself changes.

---

## Locked decisions (agreed 2026-08-03)

1. **Broke-crew model → STRIKE.** When cash is 0 and non-crew income cannot cover wages, crew output and wages both zero out. Buildings keep earning, so recovery is automatic. No debt/negative-cash system.
2. **Franchise research → REMOVED.** Deleted from `RESEARCH` until a real prestige design pass (0.6.0 material). The orphaned `r.franchise` key in old saves is harmless; no migration needed.
3. **Walk-in trickle → BASELINE PULL.** Flat `+0.02 patrons/s` added to `pull` in `rates()`. Buzz stays 100% player-driven; walk-ins flow through the existing `admitted = min(pull, space)` path.
4. **DESIGN.md → MARK SUPERSEDED NOW.** Banner at top; full rewrite deferred until after Phase 3 when systems are stable.

---

## Phase 1 — Correctness (target v0.5.0, build 144, SAVE_VER stays 4)

All fixes work on the existing save shape; no migration required.

### 1.0 Test harness FIRST (guards everything below)

Create `economy.test.mjs` at repo root — dependency-free Node script with a DOM prelude (stub `window`, `document.getElementById`, a minimal root object with `addEventListener`, `querySelector`/`querySelectorAll` returning null/[], and an `innerHTML` setter). Instantiate `Game`, never call `init()`; drive `fresh()`, `caps()`, `rates()`, `step()`, and the new `catchUp()` directly. Assertions:

- Job assignments always sum to `crew` after any sequence of hires/moves/steps.
- No resource ever goes negative across a 10-night simulated run with purchases.
- `catchUp(g, 3600)` yields ≈ 50% of the cash from an equivalent live `step()` simulation (tolerance ±2%), same shift alignment.
- 7th Door Staff purchase is rejected (see 1.5).
- Strike rule: at `cash = 0` with wages > non-crew income, crew output is 0 and wage is 0 (see 1.3).

Run: `node economy.test.mjs`. This joins `node --check game.js` as the per-change gate.

### 1.1 Unify catch-up simulation (fixes hidden-tab freeze + double-standard income)

**Bug:** Load-time offline (`init`, ~line 215–246) simulates at 50% rate; the live timer (~line 258–264) routes huge gaps through `step()` at full rate in `SIM=0.1` slices — up to 288,000 synchronous `rates()` calls on refocus (multi-second hang), and "tab left open" earns 2× what "browser closed" earns.

**Fix:** Extract `catchUp(g, seconds)`:
- `seconds = min(seconds, 28800)`.
- Loop: `wall = min(remaining, shift.len - g.shiftT, OFFLINE_STEP)`; accrue resources at `dt = wall * 0.5`; advance `shiftT`/`elapsed` by `wall`; handle shift/night rollover (no log spam — silent, like the current offline path).
- Re-read `rates()` each slice.
- Returns `{ earned, wagesPaid }` gross accumulators for honest reporting (1.10).

**Call sites:** `init()` offline path delegates to it (keeps the >60s log line); the live timer delegates when `dt > 2` (silent unless `dt > 60`, then same away-message format). `step()` keeps handling the normal sub-2s live path.

### 1.2 Remove the `dt` floor speed-up

**Bug:** `if (dt < 0.05) dt = 0.1` (line 262) advances the sim 0.1s for <0.05s of real time.
**Fix:** Replace with an early return — skip steps under 50ms; `g.ts` is untouched so the time accrues to the next tick.

### 1.3 Strike rule (crew is not free at $0)

**Bug:** Cash is floored at 0 in `step()` (line 345), so wages become free once broke — hire max crew, spend to zero, infinite free production.
**Fix in `rates()`:**
- Compute non-crew cash income (base + rail + bar + VIP building + regulars-loop) and crew wage separately.
- If `g.cash <= 0` and `nonCrewCash - wage < 0`: zero all crew contributions (`jobs.vipjob` cash, `jobs.stage` hype, `jobs.floor` buzz) and set wage to 0. Return `strike: true`.
- `renderVals()` shows a "crew unpaid — on strike" note on the Cash row and pushes one log line per strike onset (edge-triggered, not per-tick).

### 1.4 Walk-in trickle (fixes dead-end opener)

**Bug:** Patrons only arrive via Buzz; Buzz only comes from purchasables. Buying the cheapest building (Tip Rail, $30) first yields literally `min(0, …) * 0.05 = 0` forever.
**Fix in `rates()`:** `const pull = basis * (1 + g.hype / 200) + 0.02;` (walk-ins unscaled by Hype — simple and predictable). No change to `admitted`/`buzzSpent` math; when `buzz = 0`, `basis = 0` so `buzzSpent = 0` — walk-ins are free.
**Desc updates:** Tip Rail → "Brass rail along the stage. Up to 6 patrons per rail tip +$0.05/s." Club tab hint gains one sentence: "A few regulars wander in on their own; Buzz fills the floor faster."

### 1.5 Door Staff cap (7th+ purchase is pure waste)

**Bug:** Decay multiplier `Math.max(0.25, 1 - door*0.12)` clamps at 6 doors (0.28); the 7th+ does nothing while costing 1.20ⁿ.
**Fix:** Add `max: 6` to the `door` entry in `BUILDINGS` (data-driven, reusable). `buyBuilding` returns early when `n >= def.max`; the card shows "maxed" and locks the button. Desc gains "(max 6)".

### 1.6 Consolidate double patron income

**Bug:** Patrons pay twice — `min(patrons, rail*6) * 0.05` (line 308) and an uncapped `patrons * 0.012` (line 311).
**Fix (v0.10.19 amendment — intentional reversal):** The `0.012` term is deleted as originally specified, but the flat `0.08` base is *also* replaced — the door take is now a per-patron cover (`patrons × 0.02`, v0.10.19). This **deliberately restores two patron-driven cash channels**: the uncapped cover (`patrons × 0.02`) plus the capped rail tips (`min(patrons, rail×6) × 0.06` when rails exist) — exactly the double payment §1.6 originally consolidated. That constraint no longer holds and should not be re-applied by a future maintainer: the cover replaced the flat door (no free money — an empty room earns ~nothing, and the patron cap bounds the early game), while tips remain the rail's layer. The two channels are complementary (crowd size vs rail capacity), not a duplicate-payment bug. Changelog notes the consolidation.

### 1.7 Off Shift row: display-only

**Bug:** The jobs invariant (`stage+vip+floor+off === crew`) makes Off Shift's `+` permanently locked (`assigned + off >= crew` is always true), `−` is hardcoded locked, and the `moveJob('off', +1)` branch is unreachable.
**Fix:** In the jobs UI, render no steppers for `j.id === 'off'` (count only, styled as a passive roster row). Delete the dead `id === 'off'` `d > 0` branch in `moveJob`.

### 1.8 Enforce upgrade requirements in the action

**Bug:** `buyUpgrade` (line 391) checks only `g.u[id]` and cash; the req is UI-enforced only.
**Fix:** `const reqId = Object.keys(def.req)[0]; if (g.b[reqId] < def.req[reqId]) return;`

### 1.9 Remove Franchise research

**Fix:** Delete the `franchise` entry from `RESEARCH`. `fresh()` and the research tab adapt automatically (both iterate `RESEARCH`). Old saves keep a harmless `r.franchise = true` orphan.

### 1.10 Honest away-report

**Bug:** `reported = max(0, cash - cashBefore)` prints "+$0" when the room actually bled to the floor.
**Fix:** Use the `catchUp` accumulators from 1.1: report signed net plus wage drag — e.g. `Away 94m — earned $312, wages −$88.` When a strike occurred during the gap, append `Crew struck while you were gone.`

### Phase 1 verification

- `node --check game.js` and `node economy.test.mjs` green.
- Manual: fresh save → play two full nights (rail-first opener now earns; walk-ins visible).
- Manual: existing SAVE_VER 4 save loads unchanged.
- Manual: fake an 8h gap (edit `ts` in localStorage) → catch-up completes without hang at 50% rate, honest report; repeat with tab-hidden (dev tools) for the live path.
- `VERSION`, build, `CHANGELOG` advance together (0.5.0 entry lists items 1.1–1.10).

---

## Phase 2 — Robustness (target v0.5.1, build 145, SAVE_VER stays 4 unless a field is added)

### 2.1 Save import

Settings gains "Restore save from clipboard": reads clipboard (fallback textarea paste), `JSON.parse`, validates shape (`saveVer` number, `g` object, numeric `cash`/`hype`/`buzz`/`patrons`/`regulars`/`clout`/`crew`, `jobs` object), runs the same sanitize/fixup block as `init()` (jobs sum correction), then replaces `state.g` and saves. Failure shows `saveState: 'import failed'` and changes nothing.

### 2.2 Migration map instead of wipe-on-mismatch

Add `MIGRATIONS = { 3: g => { /* backfill jobs/crew fixups */ } }`. On load with `saveVer < SAVE_VER`, apply the chain `saveVer → … → SAVE_VER`; only wipe when a version has no path (corrupt JSON still wipes, as today). This is infrastructure — the chain for 3→4 documents what the current `init()` fixup block already does informally.

### 2.3 Multi-tab guard

`window.addEventListener('storage', …)` on `this.KEY` from another tab: stop this tab's autosave (prevents clobbering), show a footer/banner notice — "Save changed in another tab — click to reload and take over" — reloading on click. No locking protocol; last-explicit-wins with a visible signal.

### 2.4 Integer patrons for display

`Math.floor(g.patrons)` in the Patrons ledger value and anywhere patron counts are shown as people (crowd threshold already uses `>= 3`, fine). Simulation stays fractional; display-only change.

### Phase 2 verification

- Round-trip: export → hard reset → import → identical state.
- Save with `saveVer: 3` shape migrates cleanly; garbage JSON wipes with the existing message.
- Two browser tabs: second tab's write triggers the first tab's notice; no autosave clobber.
- Gates green; version/build/CHANGELOG advance (0.5.1).

---

## Phase 3 — Organization, no behavior change (target v0.5.2, build 146)

### 3.1 Section game.js explicitly

Header comments dividing: `// --- constants (shifts, buildings, upgrades, research, jobs) ---` / `// --- economy (caps, rates) ---` / `// --- simulation (step, catchUp) ---` / `// --- actions (buy*, hire, moveJob) ---` / `// --- render values ---` / `// --- render ---` / `// --- boot ---`. Move nothing across section boundaries except `catchUp` living beside `step`.

### 3.2 Remove dead `.performer.idle` CSS

`style.css` lines 47–48: nothing in JS ever applies the class. Delete the rules.

### 3.3 DESIGN.md superseded banner

Prepend to `DESIGN.md`: `> **Status: SUPERSEDED (2026-08-03)** — This document specifies the 0.3.x canvas prototype. The 0.4 rewrite (club-management idle, CSS/DOM performer) replaced those systems; treat this file as historical reference. A rewrite against current systems is scheduled after the 0.5.x logic series.`

### 3.4 Changelog note

0.5.2 entry states "Reorganization only — no behavior change." Gates green.

---

## Phase 4 — Automation & Polish (target v0.9.0, SAVE_VER bumps to 8: new `g.managers` and `g.perkTree` fields)

**Status as of audit (2026-08-07):** Phases 1–3 are shipped (v0.8.1, build 183, SAVE_VER 7) — `catchUp`, `MIGRATIONS`, Door Staff cap+perk, and the `game.js` section headers all exist. Prestige/Legacy/Perks (deferred in the original plan as "0.6.0 candidate") also shipped ahead of schedule — see `PRESTIGE.md`. This phase name was first used loosely in PR #23's description ("Managers, Special Shifts, Away Report, Perk Tree"); this section is the first time it's written down as an actual spec. Away Report already exists (Phase 1 §1.10) — nothing further is planned for it here beyond 4.1's addition below.

### 4.1 Managers (auto-buyers)

New crew role, one per building type (`rail`, `bar`, `dj`, `marquee`, `flyers`, `vip`, `door`, `dress`), purchasable with Legacy from the Perks/Prestige panel (flat cost per manager, similar shape to `PRESTIGE_PERKS`, `max: 1` each). Effect: on each `step()` and `catchUp()` slice, a hired manager auto-buys its building the moment `g.cash >= cost`, using the same `buyBuilding` path so growth/cap logic isn't duplicated. No effect while broke/on strike (respects 1.3's cash gate — a manager cannot spend into a strike). Away-report gains a line when managers bought buildings during the gap (extends 1.10's report, doesn't replace it): `Managers bought 3 buildings while you were away.` New persisted field: `g.managers` (object map `buildingId → bool`), migrated 7→8 with all `false`.

**0.9.3 amendment:** the original spec above had no way to stop a manager once hired (`max: 1`, no un-hire path) — a player who hired all 8 had every building's cash siphoned automatically with no way to redirect toward a specific goal. Added `g.managerPaused` (object map `buildingId → bool`, additive field, not SAVE_VER-gated — same pattern as `goals`/`clicks`), `toggleManager()`, and `autoBuyManagers()` now skips paused managers. Pause state survives prestige alongside the manager itself. Clicking a hired manager's card toggles Pause/Resume; Legacy already spent is not refunded.

### 4.2 Special Shifts

Random low-frequency event shift (distinct from the four fixed `SHIFTS`) that can trigger at a shift boundary — e.g. "Bachelorette Rush" (+hype, +cash, shorter length) or "Slow Tuesday" (-cash, -patrons, same length as Early Doors). Selection: small chance per shift rollover, weighted table, never two in a row. Purely a modifier layer on top of the existing `shift.mult`/`shift.len` — does not replace the 4-shift rotation, just occasionally substitutes one instance. UI: shift name/tint already renders from `SHIFTS[g.shift]`; special shifts need a temporary override object with the same `{name, mult, len, tint}` shape so no render-path changes beyond reading the override when present.

### 4.3 Perk Tree (restructure `PRESTIGE_PERKS`)

Currently a flat list of 6 perks, all purchasable in any order once unlocked (PRESTIGE.md §7). Add prerequisites: each perk entry gains an optional `req: perkId` (single prerequisite, mirrors `UPGRADES`' `req` shape). Suggested shape — `cash10` and `startCrew` are tier-1 (no req); `offline65` requires `cash10` rank ≥ 1; `doorPlus` requires `startCrew`; `clout25` requires `offline65`; `startFlyers` stays tier-1. Buy-path (`buyPerk`) adds a req check identical in spirit to 1.8's `buyUpgrade` req enforcement. UI: Perks panel groups by tier or draws simple connector lines; locked-by-req perks show "requires X" instead of the buy button. New persisted field is unnecessary — `g.perks` rank map already encodes what's unlocked; add a migration guard only if the tree reshuffles existing perk IDs (current plan doesn't rename any).

### Phase 4 verification

- `node --check game.js` and `node economy.test.mjs` green; new tests: manager auto-buy respects cash-gate/strike, manager auto-buy runs correctly inside `catchUp` slices (not just live `step`), special-shift override doesn't corrupt the base `SHIFTS` rotation on the next boundary, perk req blocks purchase until prerequisite rank met.
- Manual: hire a manager, let a shift roll over unattended (or simulate via `catchUp`), confirm auto-buy happened and away-report mentions it.
- Manual: force a special-shift roll (temporarily lower the trigger chance for testing), confirm shift UI shows the override name/tint and reverts next boundary.
- Manual: existing SAVE_VER 7 save loads unchanged; new fields default correctly (no managers hired, perk tree reflects existing `g.perks` ranks under the new req rules — i.e. a save with `offline65` already ranked stays valid even though `cash10` may be rank 0, since reqs gate future purchases only, not past ones).
- `VERSION`, build, `CHANGELOG` advance together (0.9.0 entry lists 4.1–4.3).

---

## Deferred / out of scope

- **Second location** — design pass **done**: `SECOND_LOCATION.md`. Implementation still deferred beyond 0.9.0; `franchise` removal in 1.9 keeps the door open.
- **DESIGN.md full rewrite** — after Phase 3, as a writing task. (Phase 3 shipped; rewrite itself remains undone as of this audit.)
- **Render throttle** (10fps full-innerHTML is wasteful but functional) — only if profiling shows a problem; the performer-node preservation already handles the animation-sensitive part.
- **Balance tuning** — numbers stay placeholders per AGENTS.md until the mechanics above are stable.

## Execution rules (all phases)

- `VERSION`, visible build number, and `CHANGELOG` advance together on every behavior change (AGENTS.md invariant).
- `SAVE_VER` bumps only if the persisted shape changes; current plan keeps it at 4 throughout.
- Offline progression correctness and no elapsed-time double counting remain the primary invariants — the 1.0 harness asserts both.
- Gates before every commit: `node --check game.js`, `node economy.test.mjs`.
