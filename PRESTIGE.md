# PRESTIGE.md — Franchise Prestige Design

**Status:** design locked for first implementation  
**Scope:** document only (no `game.js` change in the PRESTIGE.md PR)  
**Depends on:** PLAN-NEXT workstreams A–C (save file I/O, Owner's List, balance + `pacing.mjs`)  
**Save format when implemented:** SAVE_VER 5 → **6**  
**Plan source:** `.omo/PLAN-NEXT.md` §D  

This doc is complete enough for a later implementation PR: no open design questions for the first prestige ship. Numbers cite post–workstream-C balance intent; if live costs drift, re-check the worked table and the prestige pacing scenario, not the fantasy or field list.

---

## 1. Fantasy & name

**Fantasy.** The player sells the club to a franchise group and reopens under their banner. The room is new, the name is licensed, and the previous run's reputation survives as **Legacy** — not as cash, not as Clout.

**Pitch (in-world).** A franchise man has been asking about you. When the club has enough regulars to prove the concept, they make an offer: sign over this location, keep the know-how, start the next room with a permanent edge.

**Currency name: Legacy**

| Currency | Role |
|----------|------|
| **Clout** | Run currency only. Spent on research. Resets on prestige. |
| **Legacy** | Prestige currency. Earned on reset, spent on permanent perks. Never converts to/from Clout. |

Do **not** reuse Clout as prestige currency. Do not rename Clout. UI copy may say "franchise" in the offer flow; the resource label is always **Legacy**.

**Internal ids (locked):**

| Concept | Id / field |
|---------|------------|
| Prestige currency (spendable this meta) | `g.legacy` |
| Lifetime Legacy earned | `g.legacyTotal` |
| Purchased perk ranks | `g.perks` (object map `perkId → rank`) |
| Times prestiged | `g.prestiges` (integer) |
| Perk definitions table | `PRESTIGE_PERKS` (class constant, like `BUILDINGS`) |
| Helper | `perk(g, id)` → current rank (0 if missing) |

---

## 2. Gate

**Condition (locked):** the active club's `regulars >= 25` (reads through `club(g)` since SAVE_VER 9).

This is deliberately identical to Owner's List goal 14 (`name` — "A name in this town"). Onboarding ends exactly where prestige begins. Completing goal 14 is **not** required to prestige (a migrated mid-game save with 25+ regulars can prestige without a completed goals array), but the teaser line on goal 14 points at this system:

> Word is a franchise man has been asking about you.

**UI affordance:**

- When the active club's `regulars >= 25` (reads through `club(g)` since SAVE_VER 9), a header control **"Franchise offer"** appears (same header strip as shift / version badge family — not buried in Settings).
- Below gate, the control is absent (not disabled gray). No prestige teaser chrome before the gate.
- Clicking opens the **confirmation modal** with the reset report **preview** (Legacy gain, what resets, what persists). Confirm commits; cancel closes with no state change.
- **Stale tab (`tabStale`):** after another tab writes the save, this tab stays interactive but `save('auto')` no-ops. Prestige must not award Legacy only in memory. **Locked rule:** while `tabStale` is true, either (a) disable **Sign the deal** with copy that the player must reload the fresh save first, **or** (b) on confirm use the same **explicit/manual save path** that bypasses the stale auto-save guard (the path Settings → Save now already uses). Prefer (a) if simpler — no silent prestige that vanishes on reload banner accept. Cancel still closes with no state change.

**Gate is evaluated live** from the active club's current `regulars` (fractional sim is fine; use `>= 25` the same way goal 14 does). Offline catch-up that crosses 25 does not auto-open the modal; it only makes the button appear on the next render.

---

## 3. Reset rules

On confirm of Franchise offer:

### Reset (wipe to fresh-run defaults)

**SAVE_VER 9 multi-club rule:** reset applies **per club** — the `clubs` map keeps every key, each club's run fields below reset to fresh defaults, and `activeClub` stays on its club. Prestige resets run state; it does not delete rooms or move the player.

| Field / group | After prestige |
|---------------|----------------|
| `cash` | starting cash (`props.startingCash`, default 20), then apply start perks (see §5) — **per club** |
| `hype`, `buzz`, `patrons`, `regulars`, `clout` | 0 — **per club** for the club fields (`clout` is account-level) |
| `b` (buildings) | all 0, then apply start perks (e.g. free Flyer Crew) — **per club** |
| `u` (upgrades) | all false — **per club** |
| `r` (research) | all false (account-level) |
| `crew` | 0, then apply start perks (e.g. start with 1 crew) (account-level) |
| `jobs` | all 0; if start-with-crew perk, assign that crew to `stage` |
| `shiftIdx`, `shiftT`, `night`, `elapsed` | 0 / 0 / 1 / 0 (same as `fresh()` night baseline) — **per club** |
| `clubs` map, `activeClub` | **preserved** — every club key survives; `activeClub` unchanged (still names an own club) |
| `goals` | `[]` — Owner's List **resets** and replays |
| `clicks`, `rounds` | 0 |
| `log` | cleared, then one franchise line (see §9) |
| Strike session flag | cleared |

### Persist (carry across prestige)

| Field | Behavior |
|-------|----------|
| `legacy` | previous `legacy` − spent this session + **newly earned** this reset (see §4) |
| `legacyTotal` | += newly earned this reset (never decreases) |
| `perks` | unchanged (purchases permanent until a future redesign) |
| `prestiges` | += 1 |
| Save-format / version fields | as always on write (`saveVer`, `ver`, `build`) |

**Order of operations (locked):** same safety pattern as import (`importSaveFromText`: log → persist → replace). Construct the post-prestige **candidate** fully, require `localStorage.setItem` success, **then** replace live state. Never replace first and leave the critical write to the next autosave — a storage failure or a reload before the next scheduled autosave would restore the pre-prestige run and discard the reset + awarded Legacy.

1. Compute `gain = legacyGain(g)` from the **active club's** pre-reset `regulars` and `night` (§4).  
2. Snapshot `perks`, `legacy`, `legacyTotal`, `prestiges`.  
3. Build a **candidate** `g` (not yet live): `fresh()`-equivalent run fields, **per club** — every existing club key is carried over with its run fields reset, the `clubs` map and `activeClub` preserved (SAVE_VER 9).  
4. Restore meta on the candidate: `legacy = snapshot.legacy + gain`, `legacyTotal = snapshot.legacyTotal + gain`, `perks = snapshot.perks`, `prestiges = snapshot.prestiges + 1`.  
5. Apply start-of-run perk effects (crew, buildings) on the candidate — buildings seed the **active club** only.  
6. Push the franchise log line onto the candidate so disk and memory share the same entry.  
7. `localStorage.setItem` with the candidate payload — **must succeed** (use the explicit/manual save path when `tabStale` so the write is not a no-op auto-save; see §2 stale-tab rule).  
8. Only then: replace `state.g` with the candidate and refresh UI.  

If `setItem` throws (or is blocked by `tabStale` without a manual path): leave the live pre-prestige club unchanged, surface a save/prestige failure — no silent in-memory franchise.

**Not a full wipe:** Settings → Wipe still clears everything including Legacy/perks (existing wipe semantics). Prestige is a soft reset, not wipe.

**Owner's List:** resets every prestige. Prestige-tier goals are explicitly out of scope (§8).

---

## 4. Legacy formula

**Formula (locked):**

```text
legacyGain(g) = floor( sqrt(activeClub.regulars) + activeClub.night / 7 )
```

- `regulars` and `night` are pre-reset values of the **active club** (since SAVE_VER 9 they live in `g.clubs[g.activeClub]`; `legacyGain` reads them through the `club(g)` accessor — see SECOND_LOCATION.md §5).  
- `sqrt` is math square root (not integer sqrt).  
- Primary reward is the gate resource (regulars); long runs add via nights.  
- Minimum at the gate: `regulars === 25`, `night === 0` → `floor(5 + 0) = 5`.  
- No soft cap on gain for v1; extreme AFK farms are acceptable for first ship.

**Helper shape (implementation sketch):**

```js
legacyGain(g) {
  const c = club(g);              // active club (g.clubs[g.activeClub])
  const reg = Math.max(0, c.regulars || 0);
  const nights = Math.max(0, c.night || 0);
  return Math.floor(Math.sqrt(reg) + nights / 7);
}
```

### Worked table

| Regulars | Night | √regulars | night/7 | **Legacy gain** |
|---------:|------:|----------:|--------:|----------------:|
| 25 | 0 | 5.00 | 0.00 | **5** |
| 25 | 10 | 5.00 | 1.43 | **6** |
| 25 | 14 | 5.00 | 2.00 | **7** |
| 36 | 7 | 6.00 | 1.00 | **7** |
| 49 | 0 | 7.00 | 0.00 | **7** |
| 60 | 30 | 7.75 | 4.29 | **12** |
| 100 | 50 | 10.00 | 7.14 | **17** |
| 144 | 70 | 12.00 | 10.00 | **22** |

Plan check points: **25 regulars / night 10 → 6** (plan prose said ~7; exact formula yields 6 — **table wins**); **25 / 14 → 7**; **60 / 30 → 12**. Implementers copy the formula, not the "~" estimates.

**Spending:** Legacy is only spent on perks (§5). No bank interest, no conversion to cash/Clout.

---

## 5. Starter perks (6)

Data-driven table `PRESTIGE_PERKS`. All costs in **Legacy**. First implementation ships exactly these six; order is shop display order.

| # | id | Name | Effect | Cost | Max rank | Notes |
|---|-----|------|--------|-----:|---------:|-------|
| 1 | `cash10` | House cut | +15% all cash income per rank | 1 | 5 | Multiplies **all** cash income: passive `rates()` cash **and** active Work-the-crowd clicks (see apply rules) |
| 2 | `startCrew` | Seed roster | Start run with 1 crew on Main Stage | 2 | 1 | Applied after `fresh()`; `crew = 1`, `jobs.stage = 1` |
| 3 | `startFlyers` | Street team | Start run with Flyer Crew ×1 built | 3 | 1 | `b.flyers = 1` after fresh; does not refund if player rebuilds |
| 4 | `offline65` | Franchise playbook | Offline / catchUp rate 50% → 65% | 4 | 1 | Only `catchUp` dt factor; live `step` stays 100% |
| 5 | `doorPlus` | Extra bouncer slot | +1 max Door Staff | 5 | 1 | `door` building `max` 6 → 7 when owned; **card/desc max text must be dynamic** (no hardcoded "(max 6)") |
| 6 | `clout25` | Name recognition | +25% Clout gain | 6 | 1 | Multiplies `rates().clout` |

**Total Legacy to buy everything once (max ranks):**  
`cash10`×5 (5) + 2 + 3 + 4 + 5 + 6 = **25** Legacy lifetime spend for full tree at rank caps.

### `perk(g, id)` helper

```js
perk(g, id) {
  const p = g.perks && g.perks[id];
  return typeof p === 'number' && p > 0 ? p : 0;
}
```

Single helper used everywhere — no scattered `g.perks?.x` copies.

### Apply rules (locked)

1. **`cash10` (House cut — all cash income, including clicks)** — multiplies **every** cash income source by `(1 + 0.15 * perk(g, 'cash10'))`:
   - **Passive:** `rates().cash` is multiplied by `houseCut = totalCashMult(g)` — the House cut composed with the achievement milk multiplier (`cashIncomeMult(g) × achievementMult(g)`, REPLAY_ROADMAP §3).
   - **Active:** `workCrowd` grants `clickGrant = clickVal × totalCashMult(g)` (the same composed factor). The perk copy "+15% all cash income" is **not** passive-only; the prestige pacing bot also uses `workCrowd` while cash is low, so click mult is load-bearing for the §7 scenario.
2. **`startCrew` / `startFlyers`** — only in prestige reset path and in `fresh()` when loading a meta-save that already has those perks (new club after prestige, and brand-new game with perks should not happen without prestige; `fresh()` still checks perks so a future "new run keep meta" path is consistent).  
3. **`offline65`** — `catchUp` uses `dt = wall * (perk(g, 'offline65') ? 0.65 : 0.5)` instead of hardcoded `0.5`. Live `step` unchanged. Away report still honest on gross/wages.  
4. **`doorPlus`** — in buy path and UI max for Door Staff: `max = (BUILDINGS door max) + perk(g, 'doorPlus')` → 6 or 7. **Card description must not hardcode `"(max 6)"`** (current Door Staff blurb does). When implementing, derive displayed max from the same expression as the buy path (e.g. `"… (max " + doorMax(g) + ")"`) or drop the parenthetical and show remaining capacity only on the card body. Leaving static "max 6" while allowing a seventh hire is a bug.  
5. **`clout25`** — `clout` rate × `(1 + 0.25 * perk(g, 'clout25'))` (rank is 0/1).  
6. **Purchase action** — `buyPerk(id)`: if rank < max and `g.legacy >= cost` (cost is flat per rank for `cash10`, same 1 Legacy each rank), decrement legacy, increment `g.perks[id]`. No refunds.  
7. **Shop availability** — Perks panel always visible once `g.prestiges >= 1` **or** `g.legacyTotal > 0` **or** any perk rank > 0. Before first prestige, no Perks UI (Legacy is 0 and unused).

### Implementation touch points (for the future code PR)

| Area | Change |
|------|--------|
| `rates()` | cash mult, clout mult |
| `workCrowd` / click grant | same `cash10` mult as `rates()` cash income |
| `caps()` | none required for v1 (door is max on building, not caps) |
| Door buy / card | honor +1 max; **dynamic max text** (not hardcoded 6) |
| `catchUp()` | 0.5 → 0.65 factor |
| `fresh()` / prestige reset | apply start crew / flyers |
| Franchise confirm | block or manual-save when `tabStale` |
| `renderVals` / systems | Perks tab or Settings subsection + Franchise modal |
| Tests | gain formula table, reset field matrix, perk apply, migration 5→6, array `perks` rejected |

---

## 6. Save format (v5 → v6)

**Bump `SAVE_VER` to 6** only in the implementation PR (not this doc PR).

### New fields on `g` (defaults)

```js
// meta — prestige
legacy: 0,        // spendable Legacy
legacyTotal: 0,   // lifetime earned
perks: {},        // { [perkId]: rank }
prestiges: 0      // times confirmed franchise deal
```

`isValidSavePayload` must **not** require these fields (same pattern as goals/clicks/rounds on v4→v5): migration fills them; import validates before migrate.

### Migration sketch

```js
// MIGRATIONS[5]: v5 → v6 prestige meta fields
5(g) {
  if (typeof g.legacy !== 'number' || !Number.isFinite(g.legacy)) g.legacy = 0;
  if (typeof g.legacyTotal !== 'number' || !Number.isFinite(g.legacyTotal)) g.legacyTotal = 0;
  // perks must be a plain object map. Arrays pass typeof === 'object' but
  // JSON.stringify omits string-keyed properties on arrays, so ranks would
  // vanish after reload while Legacy spend already stuck — reject/replace.
  if (!g.perks || typeof g.perks !== 'object' || Array.isArray(g.perks)) g.perks = {};
  if (typeof g.prestiges !== 'number' || !Number.isFinite(g.prestiges)) g.prestiges = 0;
  // Clamp junk ranks from hand-edited saves
  for (const def of this.PRESTIGE_PERKS) {
    let r = g.perks[def.id];
    if (typeof r !== 'number' || r < 0) r = 0;
    g.perks[def.id] = Math.min(def.max, Math.floor(r));
  }
}
```

- Old saves migrate with **zero** prestige state.  
- `fresh()` initializes the four fields directly.  
- `sanitizeG` / numeric wipe lists include `legacy`, `legacyTotal`, `prestiges`; `perks` sanitized as above (**always** re-check `Array.isArray(g.perks)` in sanitize too, not only migration — hand-edited imports after migrate can reintroduce `[]`).

### File + clipboard import

Exported `.json` and clipboard payloads are the same shape (`{ saveVer, ver, build, g }`). On import, **the existing migration chain runs** — a v4/v5 file gains prestige fields when the game is on SAVE_VER 6. No parallel import path for prestige. Call this out in settings hint if needed: "Older saves upgrade on load; franchise progress appears after you prestige in this version."

### Future saveVers

Do not invent v7 in this design. Next shape change gets its own migration step.

---

## 7. Balance hooks (`pacing.mjs`)

When prestige is implemented, extend `pacing.mjs` (dependency-free, same DOM prelude as `economy.test.mjs`) with a **prestige run** scenario:

### Scenario: `prestige-run`

1. **Run 1:** reference bot (same buy/assign/active policy as §C) plays until `regulars >= 25` **and** night is at least 10, **or** until the wall-time cap — whichever comes first. Record wall-time of first **LED** upgrade (`u.led`) as `t1` when it occurs.  
2. **Gate check (locked):** if at the wall-time cap `regulars < 25`, **fail the scenario immediately** (exit non-zero, print reason). Do **not** prestige, do **not** buy perks, do **not** run Run 2. A production reset must reject below-gate state; bypassing the gate would invalidate the Run 2 comparison.  
3. Only if gate is met: perform prestige reset with formula gain; spend **exactly 1 Legacy** on `cash10` rank 1 (leave remaining Legacy unspent).  
4. **Run 2:** same bot from post-prestige start state.  
5. Record wall-time of first LED as `t2`.  
6. **Assert:** `t2 < t1` (run 2 reaches first upgrade faster with +15% cash). Exit non-zero on failure.

### Reporting

Print a second table block:

```text
Prestige scenario
  run1 gate regulars: … (need >= 25)
  run1 first LED:  …s
  run2 first LED (+15% cash perk): …s
  delta: …s (must be < 0 wall for run2 − run1)
```

On gate miss: print `FAIL: prestige gate not reached (regulars=… < 25 at wall cap)` and skip run2 lines.

### Tuning policy

- If the assert fails after implementation, **prefer perk magnitude / bot gate timing**, not reopening the formula, unless the formula is clearly wrong vs §4 table.  
- Prestige scenario is a regression guard for "prestige must matter," not a full meta balance suite.  
- Existing §C milestone bands stay required; prestige scenario is additive.

---

## 8. Non-goals (first implementation)

Explicitly **out of scope** for the first prestige ship:

| Non-goal | Rationale |
|----------|-----------|
| Second-location simulation | One club fantasy; no parallel rooms. **Superseded by `SECOND_LOCATION.md`** for a future implementation PR. |
| Multi-club map / travel | No world map UI. **Superseded by `SECOND_LOCATION.md`** (tab switcher, not a map). |
| Prestige-tier Owner's List goals | List resets; new goal rows later if needed |
| Leaderboards / cloud ranks | Static site, local saves only |
| Legacy → cash/Clout conversion | Keeps currencies pure |
| Perk refunds / respec | Flat purchases; wipe is the hard reset |
| Auto-prestige | Modal confirm only |
| Franchise Binder research revival | Was removed pending this design; **do not** reintroduce a research that duplicates Legacy — prestige replaces that orphan concept |
| Changing SHIFTS / offline cap (8h) / walk-in 0.02 as prestige levers | Unrelated; offline **rate** 50→65 is the only offline knob here |

If a later plan wants multi-club, it supersedes this section deliberately — not by creeping into v1.
That plan now exists: `SECOND_LOCATION.md` supersedes the two second-location rows above. The rest
of this section stands.

---

## 9. UI sketch

### 9.1 Header — Franchise offer

- Placement: header row, near shift label / primary status.  
- Label: **Franchise offer**.  
- Visible only when `regulars >= 25`.  
- Style: existing neon CTA language (pink/cyan accent), not a second art system.

### 9.2 Confirmation modal

**Title:** Franchise offer  

**Body (preview, pre-confirm):**

1. Short fantasy line (one sentence): e.g. "Sign the club over. Keep the know-how as Legacy. Reopen under the banner."  
2. **You will earn:** `+N Legacy` (from `legacyGain(g)`).  
3. **You keep:** Legacy bank (after gain), perks, prestige count.  
4. **You reset:** cash, room stats, buildings, upgrades, research, crew, shift/night, Owner's List.  
5. Optional detail line: `regulars` and `night` used in the formula (mono, dim).

**Actions:**

- Primary: **Sign the deal** (confirm) — **disabled** while `tabStale` (or confirm forces the explicit/manual save path; see §2). When disabled, show a short line: "Another tab has a newer save — reload before signing."  
- Secondary: **Not yet** (cancel)

No third button. No "don't show again."

### 9.3 Reset report (post-confirm)

Night log line (and optional toast using existing save-state patterns if cheap):

```text
Signed the franchise deal: +7 Legacy
```

Use the actual gain, not a hardcoded 7. Color: gold/amber (`#ffc94a`) to match migration/away notices, or franchise pink if that reads better next to existing log colors — implementer picks one existing token, no new palette.

### 9.4 Legacy in the ledger

- After first prestige (or whenever `legacyTotal > 0`), ledger shows a **Legacy** row with the other resources (Cash, Hype, Buzz, Patrons, Regulars, Clout).  
- Display: whole numbers (`fmt` / floor as appropriate for a currency that only moves in integers).  
- Rate column: blank or "perk shop" note — Legacy does not tick passively.  
- Color: distinct from Clout (Clout stays fuchsia `#e879f9`); suggest cool gold or soft white-gold so it reads as meta, not run income.

### 9.5 Perks shop

- Systems column: new sub-tab **Perks** **or** a block under Settings — prefer a **Perks** tab once meta is unlocked so Settings stays save-focused.  
- Each row: name, effect blurb, cost, rank `cur/max`, buy button.  
- `cash10` shows rank and "×5 max".  
- Insufficient Legacy: button disabled with "N Legacy short" (same meta pattern as research).
- **No inline help icon on perk or manager cards (0.10.21).** The card renders the effect blurb (`desc`) directly under the name, so the `?` tooltip repeated it verbatim; the focusable help control was removed from these cards. The Ledger's meta rows (Legacy) keep their `?` because those tooltips add a plain-English definition the label does not show. The blurb text remains in the DOM, so screen readers and keyboard users lose nothing.

### 9.6 Owner's List interaction

- After prestige, panel shows goal 1 again (`0 / 14`).  
- No special "you've prestiged" goal in v1.  
- Completing goal 14 again is allowed; teaser line still fine as flavor.

### 9.7 Accessibility / input

- Modal traps focus with existing modal patterns if any; otherwise match wipe-confirm UX.  
- Confirm is click-only for v1 (no keyboard chord required).

---

## Implementation checklist (future code PR)

Use this as the acceptance spine when coding prestige (not part of this doc-only deliverable):

- [ ] `PRESTIGE_PERKS` + `perk()` + `legacyGain()`  
- [ ] Franchise offer button at `regulars >= 25`  
- [ ] Modal preview + confirm reset matrix (§3)  
- [ ] Log line with real gain  
- [ ] Ledger Legacy row when meta unlocked  
- [ ] Perks shop + spend  
- [ ] Apply rules in `rates` / `workCrowd` / `catchUp` / door max (dynamic text) / fresh  
- [ ] Franchise confirm blocked or manual-saved when `tabStale`  
- [ ] Prestige candidate: setItem success **before** live `state.g` replace (import-style fail-closed)  
- [ ] SAVE_VER 6 + `MIGRATIONS[5]` + `fresh()` defaults  
- [ ] `perks: []` (array) rejected → `{}` in migrate **and** sanitize  
- [ ] File/clipboard import migrates v5→v6  
- [ ] `economy.test.mjs`: formula table samples, reset persist/wipe split, migration zeros, cash perk mult on rates **and** click, offline 65%, array perks normalize  
- [ ] `pacing.mjs` prestige-run scenario green; **fails closed** if gate not reached at wall cap  
- [ ] VERSION + build + CHANGELOG together; SAVE_VER 6  
- [ ] No second location, no prestige goals, no leaderboards  

---

## 10. Second prestige layer — Franchise → Renown (shipped 0.11.9)

**Status:** design locked; shipped in PR 6 of the replay roadmap (`REPLAY_ROADMAP.md` §8) with `game.js` 0.11.9.  
**Save format when implemented:** SAVE_VER 9 → **10** — the bump ships with this PR, the first since the v9 `g.clubs` map (0.11.0).

This section is the locked spec of the second prestige layer, with the same authority for "Sell the franchise" that §1–§9 hold for the first. Numbers below are as shipped in `game.js` (the draft's worked examples are decorative; the code wins).

### 10.1 Fantasy & name

**Fantasy.** After you've maxed every prestige perk and built out both clubs, a national conglomerate offers to buy your entire operation. You **sell the franchise** — resetting *everything* (both clubs, Legacy, perks, research, Clout, managers, crew, challenges, run counters) — in exchange for **Renown**, a new permanent meta-currency that measures your brand's national footprint. Renown buys **Brand** upgrades that no single club could afford, and eventually a **third location**.

**Pitch (in-world).** "The chain wants your name on every marquee in the country. Cash out, keep the brand, and build something bigger." (This is also the modal's opening line.)

**Currency name: Renown** — spent and tracked like Legacy, never convertible to it.

| Currency | Role |
|----------|------|
| **Cash / Clout / Legacy** | unchanged (per-club run / shared research / first-layer prestige) |
| **Renown** | Second-layer meta-currency. Earned **only** by selling the franchise. Spent on Brand perks (PR 7) and Brand Endorsements (0.11.12). Never wipes. |

**Internal ids (locked):**

| Concept | Id / field |
|---------|------------|
| Renown spendable | `g.renown` (number) |
| Renown lifetime | `g.renownTotal` (number) |
| Brand perk ranks | `g.brand` (object map `perkId → rank`) |
| Brand Endorsement level | `g.brandLevel` (number ≥ 0 — the repeatable sink, 0.11.12) |
| Third club id | `'rooftop'` (unlock target, PR 7) |

### 10.2 Gate

**Condition (locked, account-level):** all three, evaluated on the **account**, never the active club:

1. every prestige perk is maxed — `this.PRESTIGE_PERKS.every(p => this.perk(g, p.id) >= p.max)`;
2. every manager is hired — `this.MANAGERS.every(m => g.managers[m.id])`;
3. both clubs are unlocked — `Object.prototype.hasOwnProperty.call(g.clubs, 'main') && Object.prototype.hasOwnProperty.call(g.clubs, 'annex')`.

That is `franchiseGate(g)` in `game.js`. The account-level gate ties the second prestige to "you've exhausted the first layer and proven the multi-club model."

**UI affordance:** below the gate, the Perks panel shows no second-prestige chrome (the card is **absent**, not disabled gray). At the gate, a distinct cyan **"Sell the franchise"** card appears — styled as a *bigger* reset than the franchise offer. `tabStale` blocks open and confirm (same rule as §2).

### 10.3 Reset rules

On the confirmed sale — the confirm is **two-click armed** (`state.franchiseArmed`, mirroring the reset button): the first click arms ("⚠ Confirm sale — click again. This cannot be undone."), the second sells. Opening the modal is gate-checked.

**Reset (wipe to fresh-run defaults — account-wide, both clubs):** the candidate is built from `fresh()`, so everything below resets; this is a **deeper** reset than §3 — it deletes the annex, not just the run.

| Field / group | After sale |
|---------------|------------|
| `g.clubs` | `{ main: freshClubState() }` — the annex re-locks; only `main` remains |
| `g.activeClub` | `'main'` |
| `g.legacy` / `g.legacyTotal` | `0` / `0` |
| `g.perks` / `g.prestiges` | `{}` / `0` |
| `g.clout` | `0` |
| `g.r` (research) | `{}` (all false) |
| `g.managers` / `g.managerPaused` / `g.managerLevels` | `{}` / `{}` / `{}` — re-hire and re-level |
| `g.crew` / `g.jobs` | `0` / fresh |
| `g.challengesDone` / `g.challenge` | `[]` / `null` — challenges re-lock (like starting a challenge, minus the modifier) |
| `g.goals` / `g.clicks` / `g.rounds` | fresh goal arc / `0` / `0` |
| `g.whalesCount` / `g.specialsCount` / `g.golden` | `0` / `0` / `null` |
| `log` | cleared, then one sale line (§10.6) |

**Persist (carry across the sale — the permanent layers):**

| Field | Behavior |
|-------|----------|
| `g.renown` | previous spendable + newly earned (§10.4) — never wipes |
| `g.renownTotal` | += newly earned — never decreases |
| `g.achievements` | permanent unlocks, unchanged |
| `g.brand` | Brand perk ranks, unchanged — **the reason to sell again** (PR 7 sink) |
| `g.brandLevel` | Brand Endorsement level, unchanged — the repeatable sink keeps every sale spendable (0.11.12) |

**Order of operations (locked, mirrors §3):** snapshot the four permanent layers → build the post-sale candidate from `fresh()` → restore the snapshot → push the sale log line onto the candidate → `localStorage.setItem` must succeed → only then replace live `state.g`. On `setItem` throw: `saveState: 'franchise failed'` and the live state is untouched — no silent in-memory sale.

### 10.4 Renown formula

**Formula (locked, as shipped):**

```js
renownGain(g) {
  return Math.floor(Math.sqrt(g.legacyTotal || 0) + (g.prestiges || 0) / 3);
}
```

- Mirrors `legacyGain`'s shape (sqrt of lifetime + linear term) but reads the **account**, not the active club: `g.legacyTotal` (lifetime Legacy, achievement credits included) and `g.prestiges`.
- ~105 lifetime Legacy + ~15 prestiges → ~15 Renown on the first sale.
- No soft cap. Renown spends on Brand perks (PR 7) and Brand Endorsements (0.11.12 — the repeatable sink, +2% all cash per level at `floor(15 × 1.35^level)`); no Renown → cash/Clout/Legacy conversion (the endorsement is a permanent multiplier, not an exchange), no auto-sell (§8 rules carry over).

### 10.5 Save format (SAVE_VER 10)

**Bump `SAVE_VER` to 10** in this PR. v9 saves migrate automatically on load.

**New fields on `g` (defaults):**

```js
// meta — second prestige layer
renown: 0,        // spendable Renown
renownTotal: 0,   // lifetime earned
brand: {}         // { [brandPerkId]: rank } — PR 7 spends Renown here
```

`isValidSavePayload` must **not** require these fields (same pattern as the first layer, §6): migration fills them; import validates before migrate.

**Migration sketch:**

```js
// MIGRATIONS[9]: v9 → v10 — add Renown + Brand fields
9(g) {
  if (typeof g.renown !== 'number' || !Number.isFinite(g.renown)) g.renown = 0;
  if (typeof g.renownTotal !== 'number' || !Number.isFinite(g.renownTotal)) g.renownTotal = 0;
  if (!g.brand || typeof g.brand !== 'object' || Array.isArray(g.brand)) g.brand = {};
}
```

- **No-clobber:** finite numbers and a plain `brand` object pass through untouched; only missing/malformed values default.
- `sanitizeG` fail-closes the same shape after the chain: non-numeric `renown` / `renownTotal` → 0, clamped ≥ 0; non-object / array `brand` → `{}`.
- `completeImportedG` adds `renown` / `renownTotal` to its account-level numeric list (default from `fresh()`, reject non-finite) and defaults `brand` to `{}` (lenient fill, not reject).
- Old saves migrate with **zero** Renown; `fresh()` initializes the three fields directly.

### 10.6 UI

- **Renown readout** — after the first sale (`g.renownTotal > 0`) the Perks panel gains a **Renown** card: `N spare · M lifetime`, meta "spent on Brand perks below" (the brand perk cards render directly under it — PR 7, DESIGN.md §22.1). Same pattern as the Legacy ledger row (§9.4): appears only once the meta is real.
- **"Sell the franchise" card** — gate-aware (absent below the gate), cyan border/button, previewing `+N Renown · a bigger reset than the franchise deal`.
- **Confirmation modal (`showFranchise`)** — title "Sell the franchise"; preview block:
  - **You will earn:** `+N Renown`
  - **You keep:** `Renown (X spare · Y lifetime) · achievements · Brand ranks`
  - **You reset:** `EVERYTHING else — both clubs, Legacy, perks, research, Clout, managers, crew, challenges`
  - Primary button two-click armed (§10.3), **disabled while `tabStale`** with "Reload to adopt fresh save before selling"; secondary **Not yet**.
- **Log line (post-sale):** `Sold the franchise: +N Renown. The brand grows.` — cyan `#22d3ee`.
- **Meta unlock:** the Perks-tab / Legacy-ledger `metaUnlocked` predicate now also unlocks on `g.renownTotal > 0`, so a save with lifetime Renown but zero prestiges still shows the meta UI.

**Non-goals (v1, REPLAY_ROADMAP.md §8.9):** no third prestige layer; no Renown → cash/Clout/Legacy conversion; no auto-sell; no per-club Renown. The Renown sink is Brand perks (PR 7) **plus** the repeatable Brand Endorsement (0.11.12) — the §8.9 "Brand perks are the only Renown sink in v1" line is superseded by the endorsement, which keeps the sink alive past ~58 Renown.

---

## 11. Challenge runs (0.11.7)

Opt-in replay modifiers with permanent, derived rewards (REPLAY_ROADMAP.md §6).
UI lives at the bottom of the Perks panel.

- **Starting** = a fresh run under the challenge's modifier: every club resets to
  `freshClubState()` (the annex is re-locked — only `main` exists afterwards);
  account meta (Legacy, perks, achievements, managers, `challengesDone`)
  persists; run state (research, Clout, crew, jobs) resets like a franchise
  deal. Start is two-click armed (it resets the run).
- **Modifiers** (`mod`): `startCash` overrides the starting till; `incomeMult`
  scales ALL cash income through `totalCashMult` (passive + clicks + whale +
  golden — no click bypass); `locked` blocks buildings in `buyBuilding`,
  `autoBuyManagers`, and the card.
- **Completion** (`check`) runs on the same beats as achievements
  (`checkAchievements` → `checkChallenge`). Completing records the id in
  `g.challengesDone` and clears the active challenge; the permanent reward is
  **derived** from the table (`challengeBonus(g)`), no separate reward field.
- **Rewards** (`reward`): additive `cashMult` (+% all cash, folds into
  `totalCashMult`), `doorMax` (+N Door Staff cap), `crewOut` (+% crew output).
  Never Clout or Legacy — run variance must not feed the research currency
  (Legacy-not-Clout rule).
- **Ending:** `endChallenge()` lifts the modifier without reward (mercy rule).
  Prestige also clears the active challenge (fresh() resets `g.challenge`);
  `challengesDone` survives prestige.

Challenges are opt-in — the pacing bot never starts one, so the existing bands
are untouched (`pacing.mjs` unchanged).

---

## Doc history

| Date | Note |
|------|------|
| 2026-08-04 | Initial lock from PLAN-NEXT §D (AAR-51). Formula table resolves plan "~7" ambiguity via exact `floor(sqrt(reg)+night/7)`. |
| 2026-08-04 | AAR-56 / PR #13 Codex P2: House cut includes click cash; prestige scenario fails if gate missed; door max text dynamic; reject array `perks`; block/manual-save prestige when `tabStale`. |
| 2026-08-04 | AAR-72 / PR #14 Codex P2: prestige order is candidate → setItem must succeed → live replace (same fail-closed pattern as import); never leave the critical write to autosave. |
