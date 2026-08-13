# DESIGN.md — Afterglow Club Idle

**Game:** Afterglow Club Idle (repo: stripper-dance)  
**Spec target:** post-workstreams A–D and post-0.9.x systems — file save, Owner's List, balance + `pacing.mjs`, prestige, achievements, managers, special shifts, whales, multi-tab ownership, second-location save shape (`game.js` v0.11.0, SAVE_VER 9)  
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
houseCut  = cashIncomeMult(g) = 1 + 0.15 × cash10 perk rank   // multiplies ALL cash income
cloutMult = 1 + 0.25 × clout25 perk rank                      // multiplies Clout gain
```

### 4.3 Cash

**Non-crew cash** (before wages):

```
railCap     = rail × 6
nonCrewCash = (patrons × 0.02 + min(patrons, railCap) × 0.06 + bar × 0.45) × cashMult × houseCut
            + vip × 1.25 × bottle × cashMult × houseCut
            + (loop ? regulars × 0.04 × cashMult × houseCut : 0)
```

- **Door cover: patrons × $0.02/head** (v0.10.19). Replaces the old flat $0.08 trickle, so
  the door take scales with the crowd — a packed floor always pays more and income never
  flatlines against patron count, while an empty room earns ~nothing (no free money). The
  patron cap bounds the early game. This supersedes the earlier PLAN §1.6
  "no uncapped patrons×0.012" decision: that rejected a flat per-patron rate stacked *on
  top of* the door; the cover *replaces* the door trickle instead.
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

Recovery is **not** “cash > 0”. Buildings must cover payroll via non-crew revenue so strike ticks cannot alternate with production via the door take.

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
| residency | Weekly Residency | 8000 | dress ×2 | Crew output ×1.4 |

### 5.3 Research (`RESEARCH`) — one-shot, Clout

| id | Name | Cost | Effect |
|----|------|-----:|--------|
| loop | Reputation Loop | 12 | Regulars +$0.04/s each (× cashMult) |
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

- `activeGoal(g)` → first incomplete, or `null` (resting copy: "Club runs itself", 14/14).
- `noteGoals(g, { live })` evaluates **only** the active goal; on complete: pay reward once, push id, log `Owner's list: <title> — <reward>`.
- Call sites:
  - **Live `step`:** after each sim slice **before** shift rollover (`live: true`). A tick that starts in Peak Hours and ends in Last Call can still complete **peak** mid-loop; post-loop-only evaluation would miss it.
  - **Offline `catchUp`:** each offline slice (`live: false`); also once after load / large-gap `catchUp` (`live: false`).
  - **Actions:** after `buyBuilding`, `buyUpgrade`, `buyResearch`, `hireCrew`, `moveJob`, `workCrowd`, `buyRound` (default `live: true`).
- Goal **`peak`**: completes only when `live !== false` — never offline.
- **Presentation:** a sticky banner at the top of the panel shows "Goal X of 14" with progress counter. For the first 3 goals, a subtle pulse animation (`onboardPulse`) draws attention to the active step.

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
| cash10 | House cut | 1 | 5 | — | +15% all cash income per rank |
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

At each shift rollover (`advanceShift`), a normal shift that just ended rolls **`SPECIAL_CHANCE = 0.10`** to start a special on the next instance — **live only** (0.10.19: gated by the `_live` flag like the critic/golden/whale rolls; the pacing bot and offline `catchUp` stay on the base 4-shift rotation, keeping `pacing.mjs` deterministic). A special that just ended is cleared and never re-rolls → **never two in a row**. When the roll succeeds, the specific special is picked **by weight** (table below, default 1). `g.shiftIdx` keeps advancing the base 4-shift rotation underneath, so a special never corrupts it. `g._specialShift` (index into `SPECIAL_SHIFTS`) round-trips through disk, so a save mid-special resumes it correctly (offline `catchUp` runs its remaining length and clears it on rollover); bad/foreign values fall through to the base shift (fail-closed).

| id | Name | Mult | Length (s) | Tint | Weight |
|----|------|-----:|-----------:|------|-------:|
| 0 | Bachelorette Rush | 1.9 | 26 | `#ff2d78` | 4 |
| 1 | Midweek Surge | 1.3 | 34 | `#22d3ee` | 3 |
| 2 | Slow Tuesday | 0.55 | 40 | `#9c86ab` | 3 |

`effectiveShift(g)` returns the override (same `{name,mult,len,tint}` shape) so the render path needs zero changes. Specials are announced on chatty rollover even on a night-wrap (“Bachelorette Rush — x1.90 take.”).

### 11.2 Whale (`spawnWhale`) — shipped 0.8.1

Random high-roller burst, **live only** — gated by the `_live` flag (0.10.19; the doc always claimed live-only but the guard was missing, letting the pacing bot roll whales and making `pacing.mjs` seed-dependent) — requires `hype > 0`:

```
per-tick chance = 0.0008 × chunk × (1 + hype / 200)     // ~1 per 3 min at base, scales with hype
bonus           = floor(50 × (1 + hype / 100) × cashIncomeMult(g))
g.cash += bonus;  log '🐋 Whale spotted! +$…';  fx floater
cooldown        = 120 + rand × 180 s                     // 2–5 min between whales
```

A whale is **not** a click (does not increment `g.clicks`).

### 11.3 Critic (`maybeCritic`) — shipped 0.10.2

A reviewer visits at the start of a **new night** (rollover into `shiftIdx === 0`), **live only** (gated by the `_live` flag set only in the real tick interval), requires `hype >= 30`:

```
per-night chance = CRITIC_CHANCE = 0.02        // 2% per night at hype ≥ 30
strong room (patrons ≥ 20):  hype += floor(8 + hype × 0.08) (capped);  clout += 2   → rave
weak room  (patrons < 20):   hype -= floor(12 + hype × 0.06) (floored at 0)          → pan
```

Rave and pan are logged with distinct colors. Like `spawnWhale`, the handler resolves goals/achievements immediately (`noteGoals` + `checkAchievements`) — a rave's +Hype can cross a stat tier (e.g. `hype_50`) in the same call. The night-rollover gate means a critic fires at most once per night; the pacing bot and offline `catchUp` drive `step()` with `_live = false` and never roll it.

### 11.4 Golden ticket (`maybeGolden` / `takeGolden`) — shipped 0.10.2

A rare floating offer — “VIP booked the booth” — **live only** (inside the `_live` tick), requires `hype > 0`, one offer at a time:

```
per-slice chance = GOLDEN_CHANCE × (chunk / SIM)          // 0.001 × slice-time fraction, whale-style (≈1 offer per ~2 min at the 10Hz sim — 0.10.20, was 0.005 ≈ one per 20s)
state: g.golden = { at: Date.now() }                      // additive; null when absent
TTL:  GOLDEN_TTL = 30 s wall-clock (live tick or catchUp expiry — expireGolden)
take the $:    cash += floor(25 × cashIncomeMult(g))      // income-scaled tip
grow the crowd: patrons = min(cap, patrons + 10)          // capped
```

The roll scales by slice time like the whale (`chunk / SIM`), so a lag spike packing many `SIM` slices into one `step()` call cannot inflate the rate. `takeGolden` is idempotent, refuses on a stale (non-owning) tab, and resolves goals/achievements immediately. `g.golden` is additive UI state — `sanitizeG` fail-closes malformed offers (non-object/array/non-finite `at` → `null`), and it never forces a SAVE_VER bump.

**Presentation (0.10.5):** the offer renders as a compact collapsible **VIP badge** in the top-right of the stage, not a centered overlay — the idle sim stays visible and keeps ticking underneath. `this.state.goldenOpen` (transient, not persisted) tracks whether the choice is expanded; the claim actions are built in `renderVals()` as `v.takeGoldenCash` / `v.takeGoldenCrowd` so the template never touches the raw `g` (see §14.4). The crowd preview is rounded — `g.patrons` is fractional in the sim.

---

## 12. Achievements (`ACHIEVEMENTS`) — shipped 0.8.1 (23), density pass 0.10.1 (38)

Permanent unlocks with small Clout/Legacy rewards. `checkAchievements(g)` iterates the catalog; on first pass of a satisfied check it pushes the id, pays the reward once, and logs **“Achievement: <name> — <desc>”** (`#ffd700`). Called per-slice in `step`/`catchUp` (so stat/night thresholds reached mid-window unlock), after every buy/hire action, after `spawnWhale` and the 0.10.2 burst handlers (`maybeCritic`, `takeGolden`), after prestige, and on load via migration v6→v7 backfill.

**Reward accounting rule (0.9.5, regression-tested):** achievement **Legacy rewards credit BOTH `g.legacy` (spendable) and `g.legacyTotal` (lifetime)** — matching how prestige gains are tracked — so `legacy_50` (Legacy Builder) and the Perks tab “Total Legacy earned” reflect achievement income. This matters in a single pass: `prestige_1` (+1) can push `legacyTotal` across 50 and unlock `legacy_50` (+2) in the same `checkAchievements` call.

**0.10.1 density pass:** catalog grew 23 → 38 — new building tiers (10 bars, 5 DJs, 3 marquees, 5 flyer crews, max door, 3 dressing rooms), stat tiers (200 hype, 100 patrons, 50 regulars, 25 nights), 10 rounds, and burst-event achievements driven by two additive counters: `g.whalesCount` (incremented in `spawnWhale`) and `g.specialsCount` (incremented in `advanceShift` when a special actually triggers). The four burst-event achievements reward **Legacy, not Clout**: they fire early and randomly, and Clout rewards would inject variance into research pacing (Clout is the research currency; see §11 and `pacing.mjs`).

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
| bar_10 | Two-Thirds Full | bar ≥ 10 | 2 Clout |
| dj_5 | Beatkeeper | dj ≥ 5 | 2 Clout |
| marquee_3 | Bright Lights | marquee ≥ 3 | 3 Clout |
| flyers_5 | Street Team | flyers ≥ 5 | 2 Clout |
| door_max | Bouncer | door ≥ `doorMax(g)` | 3 Clout |
| dress_3 | Backstage Pass | dress ≥ 3 | 3 Clout |
| hype_200 | Deafening | hype ≥ 200 | 3 Clout |
| patrons_100 | Fire Marshal | patrons ≥ 100 | 5 Clout |
| regulars_50 | Institution | regulars ≥ 50 | 8 Clout |
| night_25 | A Month In | night ≥ 25 | 3 Clout |
| round_10 | Toast | rounds ≥ 10 | 1 Clout |
| whale_1 | Big Catch | whalesCount ≥ 1 | 1 Legacy |
| whale_10 | Whale Watcher | whalesCount ≥ 10 | 3 Legacy |
| special_1 | Surprise Hit | specialsCount ≥ 1 | 1 Legacy |
| special_5 | Event Planner | specialsCount ≥ 5 | 2 Legacy |

Achievements live in the Settings modal. Backfill on load credits already-earned unlocks without double-paying (v6→v7 migration runs `checkAchievements`).

---

## 13. Save system

| Field | Value |
|-------|--------|
| localStorage key | `afterglow.save` |
| SAVE_VER | **9** |
| Envelope | `{ saveVer, ver, build, g }` |
| Autosave | every 10 s (`save('auto')`) |
| Manual | Settings → Save now |

### 13.1 `g` shape (v9)

```
clubs: {
  main: {
    cash, hype, buzz, patrons, regulars,
    b: { …building counts }, u: { …upgrade bools },
    elapsed, night, shiftIdx, shiftT,
    _specialShift, _whaleCooldown
  },
  // future rooms: <id>: { same run-state shape } (SECOND_LOCATION.md §4)
},
activeClub,                       // id of the club being played ('main' today)
clout, crew, jobs: { stage, vipjob, floor, off },
r: { …research bools }, log[], ts,
goals[], clicks, rounds,
legacy, legacyTotal, perks: { id: rank }, prestiges,
achievements[],
whalesCount, specialsCount,  // 0.10.1 burst-event counters (additive)
golden,                      // 0.10.2 golden-ticket offer (additive UI state: { at } | null)
managers: { id: bool }, managerPaused: { id: bool }
```

Club-level run fields live under `g.clubs[<id>]`; account/shared fields stay top-level. `club(g)` reads/writes the active club (SECOND_LOCATION.md §5), so club fields must never be treated as top-level. Flat `g.cash`-style access exists only through the `wrapState` compat proxy (same shape on disk: `JSON.stringify` emits the real v9 layout).

Additive fields (`managerPaused`, the 0.10.1 counters `whalesCount` / `specialsCount`, and the 0.10.2 `golden` offer) default to 0/false/null when absent — not required by `isValidSavePayload`, so they never force a SAVE_VER bump on their own.

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
2. `isValidSavePayload` (saveVer finite; club resources cash/hype/buzz/patrons/regulars numeric — read from `g.clubs.main` for v9 payloads, top-level for pre-v9; clout/crew numbers; jobs object)  
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
| 8 → 9 | Club fields into `g.clubs.main` (run state under the clubs map; `activeClub` added; `MIGRATIONS[8]` never clobbers a map sanitizeG already built on older chains) |

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
| Systems | Tabs Club + Crew (always visible) / **Upgrades** (gated on first building owned) / **Research** (gated on first Clout earned) / **Perks** (gated on `prestiges > 0`); **Owner's List** under tabs; scrollable cards + crew assignments |
| Footer | full version string, save format, saveState, tick count; multi-tab takeover banner above when stale |
| Modals | Changelog history; **Achievements**; Settings (save I/O + wipe + Look & feel) |

Typography (loaded in `index.html`): **Monoton** (wordmark), **Space Grotesk** (UI), **IBM Plex Mono** (numbers). Palette is magenta `#ff2d78`, cyan `#22d3ee`, gold `#ffc94a` on near-black `#07050c`.

**Narrow screens — one scroller, not four (v0.10.7).** The app root is `height:100dvh; overflow:hidden` (with `100vh` fallback for browsers without dynamic viewport units), and Ledger, Log and the Systems tab body each carry an inline `overflow-y:auto`. Side by side that is correct: each of the three columns owns a full-height viewport. Stacked into a single column below **900px** they instead share `100dvh − header − footer`, so every panel becomes a ~100px window with its own scrollbar nested inside the shell's. Below 900px:

- the three inner panels go `overflow:visible !important` and size to content — `.shell-grid` (which already carries `data-scroll="main"`, so the existing save/restore in §14.2 covers it) is the only scroller;
- the Stage `section` (`.stage-col`) and Systems `aside` (`.sys-col`) switch from `minmax(190px,1fr) auto 132px` / `auto auto minmax(0,1fr)` to content-sized rows — two rows for `.stage-col`, since `#stage` itself is hidden here (below);
- `.shell-grid` gets **`grid-auto-rows: min-content`**. This one is not cosmetic. As a scroll container the grid has a *definite* height, so the default `auto` rows are shrunk to fit it — the Ledger claims the entire ~620px and the Stage and Systems rows resolve to **zero**, their contents spilling out and painting on top of each other. `min-content` refuses to shrink below content. Measured: `auto` and `grid-template-rows:auto auto auto` both leave `scrollHeight` at 1715px with two collapsed rows; `min-content` gives 2082px and three real panels.

`!important` throughout because the shell is inline-styled from `game.js` and would otherwise win on specificity. None of this is reachable by the three verification gates, which stub the DOM — it was verified in headless Chrome at 400×800, 700×420 and 1400×900.

**Narrow screens — no stage art (v0.10.8).** Below the same 900px, `#stage` is `display:none`. It is environment only (§14.2): no controls, no readout, nothing that changes with game state that a player needs. On a phone it was a screenful to scroll past before reaching *Work the room*, which moved the first action from y≈962 to y≈722 once removed. **Hidden, not removed from the markup** — the render path is shared with desktop, and both JS references survive it: the click brightness pulse is `if (stage && stage.animate)` and no-ops harmlessly on a hidden node, and the keyboard tip-floater anchor now size-checks its rect rather than null-checking the element, because a `display:none` `#stage` is truthy but measures 0×0 and would have parked the floater in the top-left corner. If the stage ever gains a control or a state readout, this rule has to be revisited rather than the control being hidden with it.

**Narrow screens — collapsible Ledger (v0.10.16).** Below 900px the Ledger renders collapsed to the **CASH row only**, with a tap-to-expand chevron (▸/▾) for the full resource rows and the Floor block. The full Ledger — six resource rows plus Floor — measured **776px on a 390px phone**, taller than the whole viewport and first in the stacked column: *Work the room* (y≈703) and the Systems tabs (y≈1113) were both below the fold, so a new player scrolled past a wall of read-only numbers before reaching anything pressable. Collapsed it is ~70px, moving *Work the room* to y≈219 and the tabs to y≈331. **CASH stays visible collapsed** — it is the number idle players watch; the state flag `state.ledgerOpen` (transient, like `tab`, not persisted) drives the `ledger-collapsed` class, and the toggle button plus the collapse rule live entirely inside the ≤900px media query, so desktop keeps the always-expanded Ledger and never sees the chevron.

**Narrow screens — tap targets (v0.10.17).** Below 900px every button gets `min-height:44px; min-width:44px` via `#app button, #look-panel button:not(.lk-seg)`. The multi-buy ×1/×5/×10/×Max row — the most-tapped controls in an idle game — was **40×30px**: Barbara's thumb covered two at once and she bought the wrong thing twice. The tab bar was 38px tall, the ☰ menu 34×34, the job steppers 26×26, the version badge 33px. `min-height`/`min-width` beat the inline `height`/`width`/`padding` from `game.js` (a min-constraint overrides a fixed size), so one rule covers the shell, header, modals, and the Look panel (mounted on `body`); `!important` is needed only because the multi-buy buttons carry an inline `min-width:40px`. The Look panel's mood/motion segments (`.lk-seg`, game.js `paintLookPanel`) are exempt from the width floor — they carry an inline `min-width:0` so they can flex-shrink and ellipsize below content width, and a 44px floor would silently defeat that if a fourth option is ever added; they keep the 44px height floor. The rule lives inside the ≤900px media query, so desktop keeps its compact controls. Verified at 320px: the multi-buy row (194px = 4×44 + gaps) fits the 311px column on one line with no overflow.

### 14.2 Main Stage (environment only — v0.7.0)

**No CSS/DOM performer, pole, or undressing progression.** Operator removed the figure in v0.7.0 (“gimmicky”). Stage art is environmental only:

- Marquee bulbs, sweeping spotlight cones, haze, crowd silhouettes, stage lip, neon *girls girls girls* sign  
- `#stage` is a CSS **size container**: neon sign drops under 660px stage width and **hides under 300px**. The whole panel is hidden below a 900px *viewport* (§14.1), so those container queries only ever fire on a narrow desktop column now, not on phones  
- Empty-stage badge text still routes crew assignment: hire / assign / nobody on stage (badge → Crew tab)  
- The crowd silhouette row grows from a pair of wallflowers up to 14 bodies as `patrons` increases, bobbing faster as `hype` rises; container queries hide later silhouettes below 600/420px stage widths (v0.7.3)  

**Removed (do not restore without an explicit ask):** `dancerHTML()`, `perfStyle`, `#performer-stage` preservation, `state.stageH` / ResizeObserver fit, `.performer` / `.pole` / `dn*` CSS.

**Look prefs** (`localStorage['afterglow.look']`, chrome only — not in the save): House lights, Room mood, Motion (Full / Easy / Still). Panel mounts outside `#app` so the 10 Hz render loop does not destroy it.

**Render hygiene:** Scroll positions restored via `data-scroll`. Pointer-down defers re-render so buttons receive real clicks under 10 Hz paint.

### 14.3 Buying buildings (0.10.5)

Building cards render a **×1 / ×5 / ×10 / ×Max** button row so touch players can bulk-buy
without a Shift key. All four route through one `buyBuilding(def, count)` loop, which
re-checks cash and the per-building `max` on every iteration and keeps the single-buy log
format when `count === 1`. `buildingMaxAffordable()` is the shared source of truth for
×Max and for each button's affordability state — the loop is not duplicated in the
renderer.

Desktop **Shift-click on any of the four** still forces a max buy via the global click
handler. The explanatory `title` lives on ×1 only; repeating it on all four was noise now
that a dedicated ×Max button exists.

### 14.4 Templates read the view model, never `g`

`render()` has only `v` (the `renderVals()` output) in scope. Any handler a template binds
must be constructed in `renderVals()`, where `g` is in scope, and exposed on `v`. A
template that references the bare identifier `g` parses fine and renders fine, then throws
`ReferenceError: g is not defined` inside the delegated click handler — so it survives a
render smoke test and only fails when a player actually clicks.

This has shipped twice: the prestige modal (PR #30) and the 0.10.5 golden-ticket badge
(PR #43). Rather than rely on a review checklist a third time, `economy.test.mjs` enforces
it with two gates:

| Gate | What it does |
|------|--------------|
| `render() never references the bare identifier \`g\`` | Brace-matches `render()` out of the `game.js` source and scans it for `g` used as an identifier. Pins the exact cause with a line offset. |
| `every bound click handler is invocable without a scope error` | **Discovers** every surface, renders each, then **calls every handler** `bind()` registered and fails on `ReferenceError`. This is the click a render smoke test cannot perform. ~565 invocations across 13 surfaces. |
| `handler sweep discovers every surface without a hand-maintained list` | Guards the discovery itself, so a refactor cannot silently shrink the sweep to nothing while still passing. |

Surfaces are **discovered, not listed**:

- **Tabs** come from the view model's own `tabs` array, activated through each tab's `go`
  action — the test never needs to know a tab id. (The first version of this sweep hand-wrote
  `'upgrades'` and `'research'`; the real ids are `'up'` and `'res'`, so it swept the wrong
  tab twice and passed anyway. That is why discovery replaced the list.)
- **Modals and overlays** come from every boolean flag on `game.state`, each raised alone,
  plus one pass with all of them raised together to cover dependent pairs like
  `resetArmed` inside the settings modal.

So **adding a modal is enough**: give it a `show*` state flag as every existing modal does
and the sweep picks it up with no test edit. Verified — a new `showFakeModal` carrying a
deliberate bare-`g` handler was caught and reported as
`state.showFakeModal handler 43 — g is not defined` without touching `economy.test.mjs`.

The sweep ignores non-scope throws: a handler is free to fail for missing-DOM reasons in the
harness, and it runs against a throwaway fully-unlocked in-memory game, so destructive
actions are harmless. Both gates were also verified against a reintroduced copy of the
shipped PR #43 bug.

The residue: a surface driven by something other than a `game.state` boolean — a URL
parameter, say — would not be discovered. Nothing in the current UI works that way.

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
