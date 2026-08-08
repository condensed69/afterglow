# DESIGN.md — Afterglow Club Idle

**Game:** Afterglow Club Idle (repo: stripper-dance)  
**Spec target:** post-workstreams A–D and post-0.9.x systems — file save, Owner's List, balance + `pacing.mjs`, prestige, achievements, managers, special shifts, whales, multi-tab ownership (`game.js` v0.9.5, SAVE_VER 8)  
**Source of truth for numbers:** `game.js` (`caps()`, `rates()`, constant tables) — re-diff this file when those change  
**Related:** `PRESTIGE.md` (prestige deep design, shipped 0.8.0), `PLAN.md` (logic-fix predecessor, shipped), `AGENTS.md` (repo gates). Workstream sequencing lived in a local orchestrator plan (not published in the repo tree).  
**Ancestry:** this branch stacks A (file save) → B (Owner's List) → C (`pacing.mjs` + balance) → D (`PRESTIGE.md`) → 0.7.x stage work → 0.8.x prestige/achievements/whale → 0.9.x managers/special shifts/perk tree → 0.9.5 legacyTotal fix, so every claim below is present in-tree.

This document describes what the shipped neon-noir club-management idle **actually does**, not aspirational UI kits.

---

## 1. Pillars & fantasy

**Fantasy.** You own a small neon nightclub. You hire dancers, buy brass and lights, fill the floor with buzz, turn strangers into regulars, and spend reputation (Clout) on permanent research. The room has a pulse — shifts roll, Peak pays more, After Hours dies unless you cook late.

**Pitch (three sentences).** Afterglow is a dependency-free browser idle where cash, hype, and bodies on the floor compound while you are away. You click to seed the till, build structures that mint passive income, and assign crew so Main Stage, VIP, and Floor each pull their weight. The Owner's List teaches the loop in order; a franchise man is waiting when you have a name in this town.

**Pillars**

| Pillar | Meaning in play |
|--------|-----------------|
| Neon-noir owner fantasy | OLED blacks, magenta/cyan/gold accents, Monoton wordmark, dry second-person night-log voice |
| Idle with active pressure | Offline at 50% (65% with the Franchise playbook perk) for up to 8h; live play still rewards clicks, rounds, and Peak timing |
| Honest systems | Tip rails only tip, Off Shift is residual, strike when buildings cannot cover wages, saves fail closed |
| CSS/DOM stage | Stage is lighting, haze, crowd silhouettes and the stage lip — no performer figure (removed v0.7.0 by operator decision) |

---

## 2. Resources & the loop

Six ledger resources plus the prestige meta-currency **Legacy** (see §9). Simulation may keep fractions; the Patrons row displays `Math.floor`.

| Resource | Role | Why it exists |
|----------|------|----------------|
| **Cash** | Universal spend (structures, upgrades, crew, rounds) | The till. Net of non-crew income + VIP crew cash − wages |
| **Hype** | Soft-capped room energy | Multiplies cash (`1 + hype/140`), click value, and patron pull; decays unless fed |
| **Buzz** | Soft-capped awareness | Converts into patron pull; spent as patrons are admitted |
| **Patrons** | Soft-capped bodies on the floor | Fill tip rails; convert slowly into Regulars; drain a little over time |
| **Regulars** | Uncapped reputation stock | Mint Clout; with research, pay passive cash; gate prestige |
| **Clout** | Research currency | Accrues from Regulars; spent permanently on the Research tab |
| **Legacy** | Prestige meta-currency | Earned on franchise deals; spent permanently on perks + managers |

**Core loop**

1. Seed cash with **Work the room** (and early goal rewards).  
2. Buy **Tip Rail** / **Flyer Crew** so tips and buzz run without you.  
3. **Hire** → assign **Main Stage** (hype) / **VIP** (cash) / **Floor** (buzz + regulars).  
4. Grow **Hype** into Peak; convert cash → hype with **Buy a round** when needed.  
5. Mint **Regulars** → **Clout** → research; buy upgrades when structure reqs land.  
6. At **25 Regulars**, sell the club for **Legacy** → perks + managers make the next run faster.  
7. Leave the tab open or closed — **catchUp** runs the same 50% path offline and on long gaps.

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
- **Special shifts** (`SPECIAL_SHIFTS`, §11.1) occasionally substitute one instance — same render shape, never two in a row.  
- **Late Kitchen** research (`r.latemenu`): while After Hours, effective mult becomes **0.95** instead of 0.45.  
- Cash multipliers include shift mult (`sm`) for non-crew cash, VIP crew cash, and regular conversion.  
- Live `step()` can log chatty shift/night lines when remaining dt ≤ 0.5s; `catchUp()` is silent on rollover.

---

## 4. Economy reference

Transcribed from `caps()` / `rates()` post balance pass (v0.6.1) with the 0.9.x additions (house cut, clout perk, scaled buzz cap).

### 4.1 Caps — `caps(g)`

| Cap | Formula |
|-----|---------|
| patrons | `10 + bar×5 + (coat ? 20 : 0) + vip×4` |
| buzz | `50 + marquee×35` |
| hype | `100 + dj×25` |
| crew | `2 + dress×2` |
| door max | `6 + (doorPlus perk ? 1 : 0)` via `doorMax(g)` |

### 4.2 Shared multipliers (inside `rates`)

```
sm        = shift.mult; if After Hours && latemenu → 0.95
hypeMult  = 1 + hype / 140
crewMult  = residency ? 1.4 : 1
cashMult  = (twodrink ? 1.35 : 1) * hypeMult * sm
bottle    = bottle service ? 2.2 : 1
houseCut  = cashIncomeMult(g) = 1 + 0.10 × cash10 perk rank   // multiplies ALL cash income
cloutMult = 1 + 0.25 × clout25 perk rank                      // multiplies Clout gain
```

### 4.3 Cash

**Non-crew cash** (before wages):

```
railCap     = rail × 6
nonCrewCash = (0.08 + min(patrons, railCap) × 0.06 + bar × 0.45) × cashMult × houseCut
            + vip × 1.25 × bottle × cashMult × houseCut
            + (loop ? regulars × 0.04 × cashMult × houseCut : 0)
```

- Flat **0.08** is the door trickle (uncapped patrons do **not** pay outside the rail).  
- Rail tips: up to **6 patrons per rail** at **+$0.06/s** each, then × `cashMult` × `houseCut`.

**Crew cash & wages**

```
wage        = (crew − jobs.off) × 0.20 × (payroll ? 0.6 : 1)
vipCrewCash = jobs.vipjob × 1.35 × crewMult × bottle × cashMult × houseCut
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

Door Staff: each cuts decay 12%, floored so decay factor never below 0.25. Max 6 doors (`doorMax(g)`, +1 with the Extra bouncer slot perk).

### 4.5 Buzz, pull, patrons

```
floorBuzz = jobs.floor × 0.035 × crewMult   // zeroed on strike
buzz      = (marquee × 0.07 + flyers × 0.025 + floorBuzz) × (photog ? 1.5 : 1)

promoMult = promo ? 1.6 : 1
basis     = (buzz > 0 ? min(buzz, cap.buzz × 0.0013) : 0) × promoMult
pull      = basis × (1 + hype / 200) + 0.02    // walk-in 0.02 fixed, unscaled by hype
space     = max(0, cap.patrons − patrons)
admitted  = min(pull, space)
buzzSpent = basis > 0 && pull > 0 ? basis × (admitted / pull) : 0
patrons   = admitted − patrons × 0.008
```

Net buzz change in sim: `+buzz − buzzSpent` per second, clamped to cap.

> **0.9.4 fix:** the Buzz→patron conversion cap is **not** a permanent 0.065 floor anymore. It scales with `cap.buzz` (`cap.buzz × 0.0013`), which grows with Marquee Sign — at marquee=0 it equals the original 0.065, then rises with progression so buying Buzz-cap upgrades legitimately raises the pull ceiling (issue #29).

### 4.6 Regulars & Clout

```
regulars = patrons × 0.00045 × (1 + vip × 0.18) × sm
clout    = regulars × 0.0011 × cloutMult
```

### 4.7 Offline / large-gap — `catchUp(g, seconds)`

| Rule | Value |
|------|------:|
| Cap wall time | 28800 s (8 h) |
| Resource dt | `wall × 0.5` (50% rate); `wall × 0.65` with the **Franchise playbook** perk (`offline65`) |
| Wall chunk | `min(remaining, shift left, OFFLINE_STEP=1.0)` |
| Shift/night | advance on wall time (full length) |
| Report | gross earned = Σ `(cash + wage) × dt`; wages paid; `struck` if any strike tick; `managerBought` count |

Live timer (`init` interval 100 ms):

- `dt < 0.05` → skip (do not advance `ts`)  
- `dt > 2` → `catchUp` at 50% (same path as load offline; per-slice `noteGoals({ live: false })` inside), then a post-`catchUp` `noteGoals({ live: false })`  
- else → `step(dt)` full rate — **per-slice** `noteGoals({ live: true })` **before** shift rollover inside the sim loop (not only after the whole `step`)

Load-time offline uses the same `catchUp` + away log when offline > 60 s, but only after the pre-catch-up timestamp **claim** succeeds (see §13.6).

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
| door | Door Staff | 300 | 1.20 | 6 (+1 perk) | −12% hype decay each (floor 0.25) |
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
| loop | Reputation Loop | 8 | Regulars +$0.04/s each (× cashMult) |
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
- **Seed roster** perk (`startCrew`): a prestige run starts with 1 crew on Main Stage.

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

Sequential onboarding (`GOALS`). Exactly one active goal: first id not in `g.goals`. Panel sits in the systems column under the tab bar, always visible.

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

Goal 14 is also the prestige gate (see §9).

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

No cooldown. Primary pink CTA under the stage. Spawns a `+$` floater and a stage brightness pulse (v0.7.2).

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

## 9. Prestige & meta (Legacy) — shipped 0.8.0

Full locked design lives in **`PRESTIGE.md`** (fantasy, gate, formula, reset rules, save sketch, pacing hooks, non-goals, UI). This section is the as-shipped summary.

- **Gate:** `g.regulars >= 25` (goal 14). The **Franchise offer** button appears in the header once met; modal confirms.
- **Gain:** `legacyGain(g) = floor(sqrt(regulars) + night / 7)`.
- **Reset:** the next run is a `fresh()` club — cash/hype/buzz/patrons/regulars/clout/crew/buildings/research reset, and Owner's List state restarts (`clicks: 0`, `rounds: 0`, `goals: []`, same goal arc) — while **perks, managers, managerPaused, achievements, legacy, legacyTotal, prestiges** persist.
- **Persist-before-replace:** `confirmPrestige()` builds the post-prestige candidate, `localStorage.setItem` **first**; on failure → `saveState: 'prestige failed'` and the live club is untouched (same rule as import, §13.3).
- **Fields:** `g.legacy` (spendable), `g.legacyTotal` (lifetime earned — achievements credit this too, see §12), `g.prestiges` (count), `g.perks` (id → rank map).

### 9.1 Perk tree (`PRESTIGE_PERKS`)

Legacy cost, max rank. `req: perkId` gates purchase on the prerequisite perk's rank ≥ 1. `perk(g, id)` returns the current rank (0 if missing/invalid); `buyPerk` blocks until the req is met.

| id | Name | Cost | Max | Req | Effect |
|----|------|-----:|----:|-----|--------|
| cash10 | House cut | 1 | 5 | — | +10% all cash income per rank |
| startCrew | Seed roster | 2 | 1 | — | Start run with 1 crew on Main Stage |
| startFlyers | Street team | 3 | 1 | — | Start run with Flyer Crew ×1 built |
| offline65 | Franchise playbook | 4 | 1 | cash10 | Offline / catchUp rate 50% → 65% |
| doorPlus | Extra bouncer slot | 5 | 1 | startCrew | +1 max Door Staff |
| clout25 | Name recognition | 6 | 1 | offline65 | +25% Clout gain |

---

## 10. Managers (`MANAGERS`) — shipped 0.9.0

One auto-buyer per building type, purchased with Legacy from the Perks tab, max 1 each (all cost 10).

| id | Name |
|----|------|
| rail | Tip Rail Manager |
| bar | Barback Manager |
| dj | DJ Manager |
| marquee | Marquee Manager |
| flyers | Flyer Manager |
| vip | VIP Manager |
| door | Door Manager |
| dress | Dressing Room Manager |

- Auto-buy routes through `buyBuilding` the instant `cash >= price` — respects the strike rule (no auto-buy at cash=0 or on strike), and building-count achievements unlocked by a manager buy are picked up in the same slice.
- **Pause/Resume** (v0.9.3): click a hired manager's card in the Perks tab to toggle `g.managerPaused[id]`; a paused manager stops auto-buying. Legacy already spent is not refunded.
- Away report gains a line: **“Managers bought N buildings while you were away.”** (`awayMsg`).
- Persisted via `g.managers` (v8) and `g.managerPaused` (additive).

---

## 11. Special shifts & burst events

### 11.1 Special shifts (`SPECIAL_SHIFTS`) — shipped 0.9.0

At each shift rollover (`advanceShift`, shared live/offline path), a normal shift that just ended rolls **`SPECIAL_CHANCE = 0.10`** to start a special on the next instance. A special that just ended is cleared and never re-rolls → **never two in a row**. When the roll succeeds, the specific special is picked **by weight** (table below, default 1). `g.shiftIdx` keeps advancing the base 4-shift rotation underneath, so a special never corrupts it. `g._specialShift` (index into `SPECIAL_SHIFTS`) round-trips through disk, so a save mid-special resumes it correctly; bad/foreign values fall through to the base shift (fail-closed).

| id | Name | Mult | Length (s) | Tint | Weight |
|----|------|-----:|-----------:|------|-------:|
| 0 | Bachelorette Rush | 1.9 | 26 | `#ff2d78` | 4 |
| 1 | Midweek Surge | 1.3 | 34 | `#22d3ee` | 3 |
| 2 | Slow Tuesday | 0.55 | 40 | `#9c86ab` | 3 |

`effectiveShift(g)` returns the override (same `{name,mult,len,tint}` shape) so the render path needs zero changes. Specials are announced on chatty rollover even on a night-wrap (“Bachelorette Rush — x1.90 take.”).

### 11.2 Whale (`spawnWhale`) — shipped 0.8.1

Random high-roller burst, **live only** (inside `step`), requires `hype > 0`:

```
per-tick chance = 0.0008 × chunk × (1 + hype / 200)     // ~1 per 3 min at base, scales with hype
bonus           = floor(50 × (1 + hype / 100) × cashIncomeMult(g))
g.cash += bonus;  log '🐋 Whale spotted! +$…';  fx floater
cooldown        = 120 + rand × 180 s                     // 2–5 min between whales
```

A whale is **not** a click (does not increment `g.clicks`).

---

## 12. Achievements (`ACHIEVEMENTS`) — shipped 0.8.1, 23 entries

Permanent unlocks with small Clout/Legacy rewards. `checkAchievements(g)` iterates the catalog; on first pass of a satisfied check it pushes the id, pays the reward once, and logs **“Achievement: <name> — <desc>”** (`#ffd700`). Called per-slice in `step`/`catchUp` (so stat/night thresholds reached mid-window unlock), after every buy/hire action, after `spawnWhale`, after prestige, and on load via migration v6→v7 backfill.

**Reward accounting rule (0.9.5, regression-tested):** achievement **Legacy rewards credit BOTH `g.legacy` (spendable) and `g.legacyTotal` (lifetime)** — matching how prestige gains are tracked — so `legacy_50` (Legacy Builder) and the Perks tab “Total Legacy earned” reflect achievement income. This matters in a single pass: `prestige_1` (+1) can push `legacyTotal` across 50 and unlock `legacy_50` (+2) in the same `checkAchievements` call.

| id | Name | Check | Reward |
|----|------|-------|--------|
| first_rail | Brass Tax | rail ≥ 1 | 1 Clout |
| rail_5 | Rail Yard | rail ≥ 5 | 2 Clout |
| rail_10 | Rail Baron | rail ≥ 10 | 3 Clout |
| first_vip | Velvet Rope | vip ≥ 1 | 2 Clout |
| vip_5 | High Roller Haven | vip ≥ 5 | 5 Clout |
| hype_50 | Buzzing | hype ≥ 50 | 1 Clout |
| hype_100 | Electric | hype ≥ 100 | 3 Clout |
| patrons_25 | Packed House | patrons ≥ 25 | 2 Clout |
| patrons_50 | Standing Room Only | patrons ≥ 50 | 3 Clout |
| regulars_5 | Regulars | regulars ≥ 5 | 1 Clout |
| regulars_10 | Locals | regulars ≥ 10 | 2 Clout |
| regulars_25 | Pillars | regulars ≥ 25 | 5 Clout |
| prestige_1 | Franchisee | prestiges ≥ 1 | 1 Legacy |
| prestige_5 | Mogul | prestiges ≥ 5 | 5 Legacy |
| legacy_50 | Legacy Builder | legacyTotal ≥ 50 | 2 Legacy |
| click_100 | Busy Hands | clicks ≥ 100 | 1 Clout |
| click_1000 | Wrist Action | clicks ≥ 1000 | 3 Clout |
| night_5 | Week One | night ≥ 5 | 1 Clout |
| night_10 | Ten Nights | night ≥ 10 | 2 Clout |
| all_buildings | Empire | every building ≥ 1 | 3 Legacy |
| all_upgrades | Fully Loaded | every upgrade bought | 3 Legacy |
| all_research | Scholar | every research bought | 2 Legacy |
| max_perks | Perfectionist | every perk at max rank | 10 Legacy |

Achievements live in the Settings modal. Backfill on load credits already-earned unlocks without double-paying (v6→v7 migration runs `checkAchievements`).

---

## 13. Save system

| Field | Value |
|-------|--------|
| localStorage key | `afterglow.save` |
| SAVE_VER | **8** |
| Envelope | `{ saveVer, ver, build, g }` |
| Autosave | every 10 s (`save('auto')`) |
| Manual | Settings → Save now |

### 13.1 `g` shape (v8)

```
cash, hype, buzz, patrons, regulars, clout,
crew, jobs: { stage, vipjob, floor, off },
b: { …building counts }, u: { …upgrade bools }, r: { …research bools },
elapsed, night, shiftIdx, shiftT, log[], ts,
goals[], clicks, rounds,
legacy, legacyTotal, perks: { id: rank }, prestiges,
achievements[],
managers: { id: bool }, managerPaused: { id: bool }
```

Additive fields (e.g. `managerPaused`) default to 0/false when absent — not required by `isValidSavePayload`, so they never force a SAVE_VER bump on their own.

### 13.2 Paths

| Path | Behavior |
|------|----------|
| **Download save (.json)** | Blob download `afterglow-save.json`; same JSON as clipboard; `saveState: 'downloaded'` |
| **Load save from file…** | hidden file input → `FileReader.readAsText` → **`importSaveFromText` only** |
| **Copy / Restore clipboard** | same payload; restore fails closed |
| **Wipe** | double-click confirm; `fresh()`; no-ops while non-owner (never removeItem a live sibling save) |

Files and clipboard are interchangeable by design.

### 13.3 Import pipeline (`importSaveFromText`)

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

### 13.4 Migration chain

| From → To | Step |
|-----------|------|
| 3 → 4 | `sanitizeG` (jobs/crew honesty) |
| 4 → 5 | Owner's List fields + credit without rewards |
| 5 → 6 | Prestige meta: legacy/legacyTotal/perks/prestiges; array perks replaced with map, ranks clamped to max |
| 6 → 7 | Achievements: `achievements[]`, backfill already-earned via `checkAchievements` |
| 7 → 8 | Managers: `managers` map, default all false |

Future saveVer or missing step → wipe on load (localStorage path) or import failed (clipboard/file).

### 13.5 Multi-tab guard & ownership

`storage` event on `KEY` in another tab → stop autosave, `tabStale: true`, banner: reload to adopt foreign save. Manual save still allowed; autosave will not clobber.

- **Owner token** (`OWNER_KEY`, sessionStorage) + **lease** (`LEASE_KEY`, localStorage) + **probe** (`PROBE_KEY`) handshake (`CLAIM_OFFLINE_SEC = 15`, `PROBE_WAIT_MS`).
- Hard claims (fresh/wiped club, migration, same-tab reload via `RELOAD_KEY`, future/corrupt ts) always proceed; **age-only claims probe first** so a live owner can refresh its lease before a second tab steals.
- Non-owner tabs are **read-only** (sim + controls pause, `tabStale`) until reload takeover or successful import — a first auto write from a duplicate would setItem a stale snapshot and pause the live sibling.
- Actions no-op while `tabStale`; `save('auto'|'manual')` no-ops while non-owner.
- Successful import acquires ownership and restarts autosave only after `setItem` succeeds.
- Reload intent is written on `pagehide` (`RELOAD_KEY`), cleared on `pageshow` so BFCache restores don't leave a stealable marker.

### 13.6 Offline on load

Safety-critical order is **claim → conditional catch-up → post-catch-up write** (`game.js` `init`). Catch-up-then-persist left the prior blob (old `ts`) on disk when `setItem` failed, so every reload re-applied the same offline window (elapsed-time double-count). Documented sequence:

1. Only for a successfully loaded existing save (not `fresh()` / wipe): compute  
   `offline = min((now − g.ts) / 1000, 28800)` (8h cap).  
2. Attach live `state.g`, push doors-open / migrate / version log lines as needed.  
3. **Claim the offline window on disk before catch-up:** set `g.ts = now`, then `localStorage.setItem` with the current payload.  
4. If the claim `setItem` **fails** → set `saveState: 'save failed'`, **skip catch-up** entirely. Memory may still run, but a reload re-reads the prior blob once (no silent progress that cannot be written).  
5. If claim **succeeds** and `offline > 0`: run `catchUp(g, offline)`; if `offline > 60` push the away message; `noteGoals({ live: false })` once after load catch-up.  
6. After successful catch-up, attempt a **post-catch-up** `setItem` of the progressed `g`. If that write fails → `saveState: 'save failed'`. Disk already holds the claimed `ts`, so a reload cannot re-apply the gap (offline progress may be lost once).

Brand-new / wiped clubs stamp `ts` via `fresh()` and skip offline entirely (`resumeExisting` is false).

---

## 14. UI map

### 14.1 Shell

Three-row grid: **header (62px) · main · footer (28px)**.  
Main: three columns **`minmax(232px,300px) | minmax(320px,720px) | minmax(320px,440px)`** — Ledger · Stage · Systems. The stage column is hard-capped at 720px (v0.7.1) so it no longer stretches into dead space on wide monitors; the shell centers via `max-width:1460px; margin-inline:auto` (not `justify-content:center`, which would clip the left edge when narrow screens overflow).

| Region | Contents |
|--------|----------|
| Header | Afterglow wordmark, version badge (opens changelog), **Franchise offer** (once the 25-regulars gate is met), shift name + bar + night/mult, settings ☰ |
| Ledger | Cash/Hype/Buzz/Patrons/Regulars/Clout with rates + notes; **Legacy** row (gold `#d4af37`, “spent on permanent perks”); Floor stats (crew, on stage, structures, night time) |
| Stage | CSS stage set only (lighting, haze, crowd silhouettes, marquee, lip) — **no performer figure**; Main Stage line, Room energy %, Work the room + Buy a round, Night log |
| Systems | Tabs Club / Crew / Upgrades / Research / **Perks** (Perks gated on `prestiges > 0`); **Owner's List** under tabs; scrollable cards + crew assignments |
| Footer | full version string, save format, saveState, tick count; multi-tab takeover banner above when stale |
| Modals | Changelog history; **Achievements**; Settings (save I/O + wipe + Look & feel) |

Typography (loaded in `index.html`): **Monoton** (wordmark), **Space Grotesk** (UI), **IBM Plex Mono** (numbers). Palette is magenta `#ff2d78`, cyan `#22d3ee`, gold `#ffc94a` on near-black `#07050c`.

### 14.2 Main Stage (environment only — v0.7.0)

**No CSS/DOM performer, pole, or undressing progression.** Operator removed the figure in v0.7.0 (“gimmicky”). Stage art is environmental only:

- Marquee bulbs, sweeping spotlight cones, haze, crowd silhouettes, stage lip, neon *girls girls girls* sign  
- `#stage` is a CSS **size container**: neon sign drops under 660px stage width and **hides under 300px**  
- Empty-stage badge text still routes crew assignment: hire / assign / nobody on stage (badge → Crew tab)  
- The crowd silhouette row grows from a pair of wallflowers up to 14 bodies as `patrons` increases, bobbing faster as `hype` rises; container queries hide later silhouettes below 600/420px stage widths (v0.7.3)  

**Removed (do not restore without an explicit ask):** `dancerHTML()`, `perfStyle`, `#performer-stage` preservation, `state.stageH` / ResizeObserver fit, `.performer` / `.pole` / `dn*` CSS.

**Look prefs** (`localStorage['afterglow.look']`, chrome only — not in the save): House lights, Room mood, Motion (Full / Easy / Still). Panel mounts outside `#app` so the 10 Hz render loop does not destroy it.

**Render hygiene:** Scroll positions restored via `data-scroll`. Pointer-down defers re-render so buttons receive real clicks under 10 Hz paint.

---

## 15. Engineering rules

| Rule | Detail |
|------|--------|
| Dependency-free | No npm, no bundler, no package manager. `index.html` + `style.css` + `game.js` (+ test/sim scripts) |
| Gates | `node --check game.js` && `node economy.test.mjs`; `node pacing.mjs` within milestone bands after any economy-affecting change |
| Version discipline | `VERSION.num`, `VERSION.build`, and in-game `CHANGELOG` advance together on behavior changes |
| Save version | Bump `SAVE_VER` only when persisted shape changes; ship a migration step |
| Compatibility | Preserve offline correctness; no double-count of elapsed time; fail closed on bad imports |
| Visual invariant | Neon-noir language; Main Stage is environment-only (no performer figure) unless a task explicitly redesigns the stage |
| Achievement Legacy | Legacy rewards credit BOTH `g.legacy` and `g.legacyTotal` (0.9.5 rule — do not regress) |
| Tests | `economy.test.mjs` boots Game without `game.init()` (boot line stripped); `pacing.mjs` same prelude |
| Balance process | Tune costs/rates against `pacing.mjs` reference bot; SHIFTS lengths/mults, 50% offline base, 8h cap, walk-in 0.02, strike structure are off-limits knobs unless re-planned |

Primary files: `index.html`, `style.css`, `game.js`. Scripts: `economy.test.mjs`, `pacing.mjs`.

---

## 16. Prestige status

Prestige **is shipped** (0.8.0): franchise sale at 25 regulars → Legacy → perks + managers. The deep design (fantasy, reset matrix, pacing hooks, non-goals) is archived in **[`PRESTIGE.md`](./PRESTIGE.md)** — treat that file as the design archive and this §9/§10 as the as-shipped summary; do not invent prestige numbers in this file.

---

## Doc maintenance

- Rewrite claims against `game.js`, not against stale plans.  
- Keep Owner's List UI copy aligned with formulas when both change in the same PR (rail goal `why` matches tip rate +$0.06/s). Do not silent-fix economy numbers to match stale copy.  
- After any balance PR: re-check §4–§8 tables and run `pacing.mjs`.  
- Save-path order is load-bearing: import is log → persist → replace (§13.3); load offline is claim → conditional catch-up → post-catch-up write (§13.6); prestige must match import's persist-before-replace rule (§9).

**End of DESIGN.md**
