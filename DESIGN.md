# DESIGN.md — Afterglow Club Idle

**Game:** Afterglow Club Idle (repo: stripper-dance)  
**Spec target:** post workstreams A–C — file save, Owner's List, balance + `pacing.mjs` (`game.js` v0.6.1, SAVE_VER 5)  
**Source of truth for numbers:** `game.js` (`caps()`, `rates()`, constant tables) — re-diff this file when those change  
**Related:** `PRESTIGE.md` (future prestige), `PLAN.md` (logic-fix predecessor, shipped), `AGENTS.md` (repo gates). Workstream sequencing for save I/O → Owner's List → balance → prestige → this rewrite lived in a local orchestrator plan (not published in the repo tree).  
**Ancestry:** this branch stacks A (file save) → B (Owner's List) → C (`pacing.mjs` + balance) → D (`PRESTIGE.md`) so every claim below is present in-tree.

This document replaces the 0.3.x canvas prototype design system. It describes what the shipped neon-noir club-management idle **actually does**, not aspirational UI kits.

---

## 1. Pillars & fantasy

**Fantasy.** You own a small neon nightclub. You hire dancers, buy brass and lights, fill the floor with buzz, turn strangers into regulars, and spend reputation (Clout) on permanent research. The room has a pulse — shifts roll, Peak pays more, After Hours dies unless you cook late.

**Pitch (three sentences).** Afterglow is a dependency-free browser idle where cash, hype, and bodies on the floor compound while you are away. You click to seed the till, build structures that mint passive income, and assign crew so Main Stage, VIP, and Floor each pull their weight. The Owner's List teaches the loop in order; a franchise man is waiting when you have a name in this town.

**Pillars**

| Pillar | Meaning in play |
|--------|-----------------|
| Neon-noir owner fantasy | OLED blacks, magenta/cyan/gold accents, Monoton wordmark, dry second-person night-log voice |
| Idle with active pressure | Offline at 50% for up to 8h; live play still rewards clicks, rounds, and Peak timing |
| Honest systems | Tip rails only tip, Off Shift is residual, strike when buildings cannot cover wages, saves fail closed |
| CSS/DOM stage | Performer is HTML + CSS keyframes bound to Hype — not canvas particles or outfit stages |

---

## 2. Resources & the loop

Six ledger resources. Simulation may keep fractions; the Patrons row displays `Math.floor`.

| Resource | Role | Why it exists |
|----------|------|----------------|
| **Cash** | Universal spend (structures, upgrades, crew, rounds) | The till. Net of non-crew income + VIP crew cash − wages |
| **Hype** | Soft-capped room energy | Multiplies cash (`1 + hype/140`), click value, and patron pull; decays unless fed |
| **Buzz** | Soft-capped awareness | Converts into patron pull; spent as patrons are admitted |
| **Patrons** | Soft-capped bodies on the floor | Fill tip rails; convert slowly into Regulars; drain a little over time |
| **Regulars** | Uncapped reputation stock | Mint Clout; with research, pay passive cash; gate prestige later |
| **Clout** | Research currency | Accrues from Regulars; spent permanently on the Research tab |

**Core loop**

1. Seed cash with **Work the room** (and early goal rewards).  
2. Buy **Tip Rail** / **Flyer Crew** so tips and buzz run without you.  
3. **Hire** → assign **Main Stage** (hype) / **VIP** (cash) / **Floor** (buzz + regulars).  
4. Grow **Hype** into Peak; convert cash → hype with **Buy a round** when needed.  
5. Mint **Regulars** → **Clout** → research; buy upgrades when structure reqs land.  
6. Leave the tab open or closed — **catchUp** runs the same 50% path offline and on long gaps.

---

## 3. Shift cycle

Four phases in `SHIFTS`. Wall-clock `shiftT` advances fully in live and offline; only resource accrual is half-rate offline.

| Index | Name | Mult | Length (s) | Tint |
|------:|------|-----:|-----------:|------|
| 0 | Early Doors | 0.70 | 40 | `#22d3ee` |
| 1 | Peak Hours | 1.60 | 55 | `#ff2d78` |
| 2 | Last Call | 1.15 | 35 | `#ffc94a` |
| 3 | After Hours | 0.45 | 30 | `#a855f7` |

- Cycle: `shiftIdx = (shiftIdx + 1) % 4`; when index wraps to 0, `night++`.  
- **Late Kitchen** research (`r.latemenu`): while After Hours, effective mult becomes **0.95** instead of 0.45.  
- Cash multipliers include shift mult (`sm`) for non-crew cash, VIP crew cash, and regular conversion.  
- Live `step()` can log chatty shift/night lines when remaining dt ≤ 0.5s; `catchUp()` is silent on rollover.

---

## 4. Economy reference

Transcribed from `caps()` / `rates()` post balance pass (v0.6.1). Balance numbers are intentional, not placeholders, once C has landed.

### 4.1 Caps — `caps(g)`

| Cap | Formula |
|-----|---------|
| patrons | `10 + bar×5 + (coat ? 20 : 0) + vip×4` |
| buzz | `50 + marquee×35` |
| hype | `100 + dj×25` |
| crew | `2 + dress×2` |

### 4.2 Shared multipliers (inside `rates`)

```
sm        = shift.mult; if After Hours && latemenu → 0.95
hypeMult  = 1 + hype / 140
crewMult  = residency ? 1.4 : 1
cashMult  = (twodrink ? 1.35 : 1) * hypeMult * sm
bottle    = bottle service ? 2.2 : 1
```

### 4.3 Cash

**Non-crew cash** (before wages):

```
railCap     = rail × 6
nonCrewCash = (0.08 + min(patrons, railCap) × 0.06 + bar × 0.45) × cashMult
            + vip × 1.25 × bottle × cashMult
            + (loop ? regulars × 0.04 × cashMult : 0)
```

- Flat **0.08** is the door trickle (uncapped patrons do **not** pay outside the rail).  
- Rail tips: up to **6 patrons per rail** at **+$0.06/s** each, then × `cashMult`.

**Crew cash & wages**

```
wage        = (crew − jobs.off) × 0.20 × (payroll ? 0.6 : 1)
vipCrewCash = jobs.vipjob × 1.35 × crewMult × bottle × cashMult
```

**Strike rule** (session-logged once on onset):

```
if nonCrewCash < wage:
  zero vipCrewCash, stageHype, floorBuzz, wage
  strike = true
```

Recovery is **not** “cash > 0”. Buildings must cover payroll via non-crew revenue so strike ticks cannot alternate with production via the door trickle.

```
cash = nonCrewCash + vipCrewCash − wage   // net $/s
```

### 4.4 Hype

```
stageHype = jobs.stage × 0.24 × crewMult   // zeroed on strike
hypeGain  = (dj × 0.10 + stageHype) × (led ? 1.3 : 1)
decay     = hype × 0.014 × max(0.25, 1 − door × 0.12)
hype      = hypeGain − decay               // then clamped to [0, cap.hype] in step/catchUp
```

Door Staff: each cuts decay 12%, floored so decay factor never below 0.25. Max 6 doors (`BUILDINGS.door.max`).

### 4.5 Buzz, pull, patrons

```
floorBuzz = jobs.floor × 0.035 × crewMult   // zeroed on strike
buzz      = (marquee × 0.07 + flyers × 0.025 + floorBuzz) × (photog ? 1.5 : 1)

promoMult = promo ? 1.6 : 1
basis     = (buzz > 0 ? min(buzz, 0.065) : 0) × promoMult
pull      = basis × (1 + hype / 200) + 0.02    // walk-in 0.02 fixed, unscaled by hype
space     = max(0, cap.patrons − patrons)
admitted  = min(pull, space)
buzzSpent = basis > 0 && pull > 0 ? basis × (admitted / pull) : 0
patrons   = admitted − patrons × 0.008
```

Net buzz change in sim: `+buzz − buzzSpent` per second, clamped to cap.

### 4.6 Regulars & Clout

```
regulars = patrons × 0.00045 × (1 + vip × 0.18) × sm
clout    = regulars × 0.0011
```

### 4.7 Offline / large-gap — `catchUp(g, seconds)`

| Rule | Value |
|------|------:|
| Cap wall time | 28800 s (8 h) |
| Resource dt | `wall × 0.5` (50% rate) |
| Wall chunk | `min(remaining, shift left, OFFLINE_STEP=1.0)` |
| Shift/night | advance on wall time (full length) |
| Report | gross earned = Σ `(cash + wage) × dt`; wages paid; `struck` if any strike tick |

Live timer (`init` interval 100 ms):

- `dt < 0.05` → skip (do not advance `ts`)  
- `dt > 2` → `catchUp` at 50% (same path as load offline; per-slice `noteGoals({ live: false })` inside), then a post-`catchUp` `noteGoals({ live: false })`  
- else → `step(dt)` full rate — **per-slice** `noteGoals({ live: true })` **before** shift rollover inside the sim loop (not only after the whole `step`)

Load-time offline uses the same `catchUp` + away log when offline > 60 s.

---

## 5. Structures / upgrades / research

Costs and growth from post-C tables. Building price: `floor(cost × growth^owned)`.

### 5.1 Buildings (`BUILDINGS`)

| id | Name | Cost | Growth | Max | Effect (code / desc) |
|----|------|-----:|-------:|----:|----------------------|
| rail | Tip Rail | 140 | 1.16 | — | 6 tip slots × $0.06/s before mult |
| bar | Back Bar | 150 | 1.18 | — | +$0.45/s; +5 patron cap |
| dj | DJ Booth | 180 | 1.17 | — | +0.10 Hype/s; +25 hype cap |
| marquee | Marquee Sign | 380 | 1.22 | — | +0.07 Buzz/s; +35 buzz cap |
| flyers | Flyer Crew | 210 | 1.16 | — | +0.025 Buzz/s |
| vip | VIP Booth | 600 | 1.24 | — | +$1.25/s room; +18% regular conversion; +4 patron cap |
| door | Door Staff | 300 | 1.20 | **6** | −12% hype decay each (floor 0.25) |
| dress | Dressing Room | 500 | 1.28 | — | +2 crew capacity |

### 5.2 Upgrades (`UPGRADES`) — one-shot, cash, building req enforced in `buyUpgrade`

| id | Name | Cost | Req | Effect |
|----|------|-----:|-----|--------|
| led | LED Pole Lighting | 420 | dj ×2 | Hype gen ×1.30 |
| twodrink | Two-Drink Minimum | 1100 | bar ×4 | All cash ×1.35 |
| coat | Coat Check | 850 | door ×2 | +20 floor cap |
| photog | House Photographer | 1700 | marquee ×2 | Buzz gen ×1.5 |
| bottle | Bottle Service | 3800 | vip ×3 | VIP cash ×2.2 (room + VIP crew) |
| residency | Weekly Residency | 5800 | dress ×2 | Crew output ×1.4 |

### 5.3 Research (`RESEARCH`) — one-shot, Clout

| id | Name | Cost | Effect |
|----|------|-----:|--------|
| loop | Reputation Loop | 6 | Regulars +$0.04/s each (× cashMult) |
| latemenu | Late Kitchen | 12 | After Hours mult 0.45 → 0.95 |
| promo | Promoter Network | 20 | Buzz→patron basis ×1.6 (“60% faster” in copy) |
| payroll | Payroll Software | 32 | Wages ×0.6 (40% cut) |

Franchise Binder research was removed in 0.5.0 pending prestige design; orphan `r.franchise` in old saves is ignored.

---

## 6. Crew & jobs

### 6.1 Hire

```
price = floor(280 × 1.38^crew)
```

- Blocked at `crew >= caps().crew`.  
- New hire: `crew++`, **`jobs.stage++`** (always opens on Main Stage).

### 6.2 Jobs (`JOBS`)

| id | Name | Production | UI |
|----|------|------------|-----|
| stage | Main Stage | +0.24 Hype/s each × crewMult (before LED) | +/− steppers |
| vipjob | VIP Room | +$1.35/s each × crewMult × bottle × cashMult | +/− |
| floor | Floor Work | +0.035 Buzz/s × crewMult; feeds regulars via patrons | +/− |
| off | Off Shift | No wage; no production | **display-only** residual count |

`moveJob(id, d)`: never assigns to `off` directly. `+` takes from `off`; `−` returns to `off`. `sanitizeG` rebalances job sums to `crew` (prefer stripping off → floor → vip → stage on overflow).

### 6.3 Wages & strike

- Wage base **$0.20/s** per non-off crew; Payroll Software → ×0.6.  
- Strike when `nonCrewCash < wage` (see §4.3). Crew cash/hype/buzz output and wages zero until non-crew revenue covers payroll.  
- Night log: one **“Crew unpaid — on strike.”** line on onset (`noteStrike`).

---

## 7. Owner's List

Sequential onboarding (`GOALS`, SAVE_VER 5). Exactly one active goal: first id not in `g.goals`. Panel sits in the systems column under the tab bar, always visible.

### 7.1 Shape

```
{ id, title, why, hint, reward: { cash, clout }, check(g), progress(g)|null }
```

Persisted: `g.goals[]` (completed ids), `g.clicks`, `g.rounds`. Not required by `isValidSavePayload` (v4 imports lack them).

### 7.2 Engine

- `activeGoal(g)` → first incomplete, or `null` (resting copy: “Club runs itself”, 14/14).  
- `noteGoals(g, { live })` evaluates **only** the active goal; on complete: pay reward once, push id, log `Owner's list: <title> — <reward>`.  
- Call sites:
  - **Live `step`:** after each sim slice **before** shift rollover (`live: true`). A tick that starts in Peak Hours and ends in Last Call can still complete **peak** mid-loop; post-loop-only evaluation would miss it.
  - **Offline `catchUp`:** each offline slice (`live: false`); also once after load / large-gap `catchUp` (`live: false`).
  - **Actions:** after `buyBuilding`, `buyUpgrade`, `buyResearch`, `hireCrew`, `moveJob`, `workCrowd`, `buyRound` (default `live: true`).
- Goal **`peak`**: completes only when `live !== false` — never offline.

### 7.3 Arc (post-C rewards)

| # | id | Title | Check | Reward |
|--:|----|-------|-------|--------|
| 1 | work | Work the room | clicks ≥ 5 | $8 |
| 2 | rail | Brass brings tips | rail ≥ 1 | $12 |
| 3 | word | Get the word out | flyers ≥ 1 | $15 |
| 4 | pulse | A floor with a pulse | patrons ≥ 8 | $20 |
| 5 | contract | First contract | crew ≥ 1 | $18 |
| 6 | energy | Room energy | hype ≥ 25 | $25 |
| 7 | house | On the house | rounds ≥ 1 | $20 |
| 8 | backstage | Backstage pass | vip ≥ 1 ∧ vipjob ≥ 1 | $35 |
| 9 | regulars | They keep coming back | regulars ≥ 3 | 2 Clout |
| 10 | study | Study the game | any **catalog** research (`RESEARCH` ids only; orphan `r.franchise` does not count) | $50 |
| 11 | roster | Grow the roster | dress ≥ 1 ∧ crew ≥ 3 | $80 |
| 12 | peak | Peak-hour hero | hype ≥ 60 ∧ shiftIdx === 1 | $100 (live only) |
| 13 | builtin | Built to last | any **catalog** upgrade (`UPGRADES` ids only) | $120 |
| 14 | name | A name in this town | regulars ≥ 25 | 5 Clout |

Goal 14 teaser becomes the prestige gate in `PRESTIGE.md` (`regulars >= 25`).

### 7.4 Migration 4 → 5

`MIGRATIONS[4]`: init `goals/clicks/rounds`; if club already past opener, set `clicks = 5`; credit **every** satisfied `check` without paying rewards (holes allowed — `activeGoal` still returns the first missing id). Load log: “Owner's list updated.”

---

## 8. Player actions

### 8.1 Work the room

```
clickVal = 1.15 + rail × 0.65 + hype × 0.07
cash    += clickVal
buzz     = min(cap.buzz, buzz + 0.12)
clicks  += 1
```

No cooldown. Primary pink CTA under the stage.

### 8.2 Buy a round

```
roundPrice = floor(50 + patrons × 7)   // roundPrice(g) — single source for UI + pacing bot
roundGain  = min(14, cap.hype − hype)  // display / log only
// action:
if cash >= roundPrice && hypeRoom > 0:
  cash −= roundPrice
  hype  = clamp(hype + 14, 0, cap.hype)   // always attempts +14, then clamp
  rounds += 1
```

Best used before Peak to stack mult.

---

## 9. Save system

| Field | Value |
|-------|--------|
| localStorage key | `afterglow.save` |
| SAVE_VER | **5** |
| Envelope | `{ saveVer, ver, build, g }` |
| Autosave | every 10 s (`save('auto')`) |
| Manual | Settings → Save now |

### 9.1 `g` shape (v5)

```
cash, hype, buzz, patrons, regulars, clout,
crew, jobs: { stage, vipjob, floor, off },
b: { …building counts }, u: { …upgrade bools }, r: { …research bools },
elapsed, night, shiftIdx, shiftT, log[], ts,
goals[], clicks, rounds
```

### 9.2 Paths

| Path | Behavior |
|------|----------|
| **Download save (.json)** | Blob download `afterglow-save.json`; same JSON as clipboard; `saveState: 'downloaded'` |
| **Load save from file…** | hidden file input → `FileReader.readAsText` → **`importSaveFromText` only** |
| **Copy / Restore clipboard** | same payload; restore fails closed |
| **Wipe** | double-click confirm; `fresh()` |

Files and clipboard are interchangeable by design.

### 9.3 Import pipeline (`importSaveFromText`)

Safety-critical order is **log → persist → replace** (not replace-first). A quota/storage failure must not leave the player on an imported club that never hit disk.

1. `JSON.parse`  
2. `isValidSavePayload` (saveVer finite; cash/hype/buzz/patrons/regulars/clout/crew numbers; jobs object)  
3. If `saveVer !== SAVE_VER`: `migrateFrom` chain; missing step → fail  
4. `completeImportedG` (fill defaults, reject unsafe values)  
5. Stamp `ts = now` on the **candidate** `g` (not yet live)  
6. Push restore log line onto the candidate (`push(g, 'Save restored.', …)`) so disk and memory share the same night-log entry  
7. `localStorage.setItem` with the candidate payload — **must succeed**  
8. Only then: replace `state.g`, clear `_onStrike`, clear `tabStale`, restart autosave if stopped, `saveState: 'imported'`  

If `setItem` throws (or any earlier step fails) → `saveState: 'import failed'`, live club / tabStale / autosave ownership **unchanged**.

### 9.4 Migration chain

| From → To | Step |
|-----------|------|
| 3 → 4 | `sanitizeG` (jobs/crew honesty) |
| 4 → 5 | Owner's List fields + credit without rewards |

Future saveVer or missing step → wipe on load (localStorage path) or import failed (clipboard/file).

### 9.5 Multi-tab guard

`storage` event on `KEY` in another tab → stop autosave, `tabStale: true`, banner: reload to adopt foreign save. Manual save still allowed; autosave will not clobber.

### 9.6 Offline on load

`offline = min((now − g.ts)/1000, 28800)` → `catchUp` → away message if > 60 s → `noteGoals({ live: false })`.

---

## 10. UI map

### 10.1 Shell

Three-row grid: **header (62px) · main · footer (28px)**.  
Main: three columns **`262px | minmax(420px,1fr) | 352px`** — Ledger · Stage · Systems.

| Region | Contents |
|--------|----------|
| Header | Afterglow wordmark, version badge (opens changelog), shift name + bar + night/mult, settings ☰ |
| Ledger | Cash/Hype/Buzz/Patrons/Regulars/Clout with rates + notes; Floor stats (crew, on stage, structures, night time) |
| Stage | CSS stage set, performer, Main Stage line, Room energy %, Work the room + Buy a round, Night log |
| Systems | Tabs Club / Crew / Upgrades / Research; **Owner's List** under tabs; scrollable cards + crew assignments |
| Footer | full version string, save format, saveState, tick count; multi-tab takeover banner above when stale |
| Modals | Changelog history; Settings (save I/O + wipe) |

Typography (loaded in `index.html`): **Monoton** (wordmark), **Space Grotesk** (UI), **IBM Plex Mono** (numbers). Palette is magenta `#ff2d78`, cyan `#22d3ee`, gold `#ffc94a` on near-black `#07050c`.

### 10.2 CSS/DOM performer

Not canvas. Markup from `dancerHTML(g, cap)` inside `#performer-stage`:

| Class | Part |
|-------|------|
| `.pole` | Cyan metallic pole |
| `.pbody` | Root motion group |
| `.ptorso` / `.pneck` / `.phead` / `.phair` | Body |
| `.parm.pole` / `.parm.free` | Arms |
| `.phip` | Hips |
| `.pleg.l` / `.pleg.r` | Legs |

**Bindings from `renderVals` → `perfStyle`**

```
--bpm    = max(0.55, 2.3 − (hype/cap.hype)×1.6) + 's'   // faster as room heats
--energy = round(hype/cap.hype × 100) + '%'
opacity  = stage crew > 0 ? 1 : 0.55
filter   = stage crew > 0 ? none : grayscale(.6)
scale    = f(stageH) clamped
```

**Empty stage:** only `.performer.empty` + pole (no gray idle body). Badge text:

- no crew → “hire crew to open the stage”  
- crew but none on stage → “assign crew · Crew tab” / “nobody on stage”  
- badge click → Crew tab  

**Crowd class:** `patrons >= 3` adds `.crowd` (stronger glow).  

**Render hygiene:** `#performer-stage` DOM is preserved across full re-renders when possible so CSS animations do not restart; occupancy flips rebuild performer HTML. Scroll positions restored via `data-scroll`. Pointer-down defers re-render so buttons receive real clicks under 10 Hz paint.

---

## 11. Engineering rules

| Rule | Detail |
|------|--------|
| Dependency-free | No npm, no bundler, no package manager. `index.html` + `style.css` + `game.js` (+ test/sim scripts) |
| Gates | `node --check game.js` && `node economy.test.mjs`; after C also `node pacing.mjs` within milestone bands |
| Version discipline | `VERSION.num`, `VERSION.build`, and in-game `CHANGELOG` advance together on behavior changes |
| Save version | Bump `SAVE_VER` only when persisted shape changes; ship a migration step |
| Compatibility | Preserve offline correctness; no double-count of elapsed time; fail closed on bad imports |
| Visual invariant | Neon-noir language and CSS/DOM performer unless a task explicitly redesigns them |
| Tests | `economy.test.mjs` boots Game without `game.init()` (boot line stripped); `pacing.mjs` same prelude |
| Balance process | Tune costs/rates against `pacing.mjs` reference bot; SHIFTS lengths/mults, 50% offline, 8h cap, walk-in 0.02, strike structure are off-limits knobs unless re-planned |

Primary files: `index.html`, `style.css`, `game.js`. Scripts: `economy.test.mjs`, `pacing.mjs`.

---

## 12. Future: prestige

Prestige is **not implemented in code**. When the club reaches **25 regulars**, design intent is a franchise sale/reopen loop with a separate meta currency (**Legacy**), permanent perks, and a SAVE_VER 5→6 migration.

Full locked design — fantasy, gate, reset rules, Legacy formula, starter perks, save sketch, pacing hooks, non-goals, UI — lives in **[`PRESTIGE.md`](./PRESTIGE.md)**. Do not invent prestige numbers in this file; point implementers there.

---

## Doc maintenance

- Rewrite claims against `game.js`, not against stale plans.  
- Keep Owner's List UI copy aligned with formulas when both change in the same PR (rail goal `why` matches tip rate +$0.06/s). Do not silent-fix economy numbers to match stale copy.  
- After any balance PR: re-check §4–§8 tables and run `pacing.mjs`.  
- After prestige ships: fold a short “as shipped” summary into §12 and keep `PRESTIGE.md` as the deep design archive or retire it deliberately.

**End of DESIGN.md**
