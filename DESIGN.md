# DESIGN.md — Afterglow Club Idle

**Game:** Afterglow Club Idle (repo: afterglow)  
**Spec target:** all shipped systems through 0.16.4 — file save, Owner's List, balance + `pacing.mjs`, prestige, achievements, managers, special shifts, whales, multi-tab ownership, second room + rooftop, research tree, challenge tiers, manager levels, Renown/Brand perks/Endorsement, Vision ladder, location extras, ledger session strip (earned vs spent), challenge HUD chip, golden-over-modals, reactive UI signal store, mobile bottom-cockpit (.thumb-cockpit), canvas floorboard engine & procedural web audio synthesizer, 4-phase operational shifts & police heat engine, station subsystems (mixology bar inventory & DJ beat-sync), club personas & named talent roster 2.0, branching blueprint skill tree & district syndicate map, pluggable content pack engine & Season 1: Miami Vice '86, fluid widescreen layout, no-stage action layout, one scroller, resource strip + header diet, Books drawer, ticker→footer, purchase grid (CSS grid), Talent tab (dedicated surface), Owner's List collapsible goal card, night log strip (3-line collapsible) (`game.js` v0.16.4, SAVE_VER 16)  
**Source of truth for numbers:** `game.js` (`caps()`, `rates()`, constant tables) — re-diff this file when those change  
**Related:** `PRESTIGE.md` (prestige deep design, shipped 0.8.0), `PLAN.md` (logic-fix predecessor, shipped), `AGENTS.md` (repo gates). Workstream sequencing lived in a local orchestrator plan (not published in the repo tree).  
**Ancestry:** this branch stacks A (file save) → B (Owner's List) → C (`pacing.mjs` + balance) → D (`PRESTIGE.md`) → 0.7.x stage work → 0.8.x prestige/achievements/whale → 0.9.x managers/special shifts/perk tree → 0.9.5 legacyTotal fix → 0.10.x second room / burst events / golden ticket → 0.11.x research tree, challenges + tiers, manager levels, Renown unlocks, Vision ladder → 0.11.29 challenge-renown preserve, 0.11.30 buy-round reason, 0.11.31 mobile ledger/tabs, 0.11.32 manager-log aggregation, 0.11.33 session strip earned vs spent, 0.11.34 challenge HUD chip, 0.11.35 golden-over-modals, 0.12.0 reactive DOM, 0.12.1 dual surface, 0.12.2 canvas synth, 0.12.3 shifts heat, 0.12.4 station subsystems, 0.13.0 personas & talent roster, 0.15.1 fluid widescreen, 0.16.0 stage removal, 0.16.1 one scroller, 0.16.2 resource strip + books drawer, 0.16.3 purchase grid + talent tab, 0.16.4 night log strip, so every claim below is present in-tree.

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
| CSS/DOM stage | No stage panel since 0.16.0 (removed, not hidden) — no performer figure (removed v0.7.0 by operator decision, never restored) |

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

### 3.1 Police Heat Engine (`catalogs.js` / `rates(g)`) — 0.12.3

Club operation attracts law enforcement attention as shifts progress. Each location tracks independent `c.heat` ($0 \le \text{heat} \le 100$).

- **Base Heat per Shift:** Early Doors (`+0.02/s`), Peak Hours (`+0.08/s`), Last Call (`+0.05/s`), After Hours (`+0.12/s`).
- **Security Score Mitigation:** Each Door Staff (`b.door`) provides `-0.015/s` heat suppression:  
  $$\text{HeatRate} = \max(-0.04, \text{BaseHeat}(\text{Shift}) - 0.015 \times \text{DoorStaff})$$
- **Live Incidents:** During live sessions (`_live = true`), random disruptions (Bar Fight $+8$, Noise Complaint $+5$, Fire Marshal $+12$) occur dynamically.
- **Offline Semantics (`catchUp`):** Heat does not accrue while offline (live-session tension only). If Door Staff provides net negative heat rate ($\text{HeatRate} < 0$), heat decays naturally towards 0 during catchUp.
- **Bribe Chief:** Active CTA (`bribePolice()`) allows paying $\$30 + 4 \times \text{night}$ (min $\$25$) to instantly dissipate $-35$ Heat.
- **Police Raid:** Reaching $100\%$ Heat in live play triggers a police raid, fining cash ($\$20 + 5 \times \text{night}$) and resetting Heat to $45\%$.

### 3.2 Station Subsystems (Mixology Bar Inventory & DJ Beat-Sync) — 0.12.4

Active station mechanics enhance floor management:

- **Mixology Bar Stocking:**  
  The bar consumes inventory as drinks are sold to patrons ($0.05 \times \text{bar} \times \text{dt}$).  
  When `c.barStock > 0`, drink revenue receives a multiplier based on the active beverage tier:
  - *Well Spirits* (Tier 1, Cost \$15, Size 50): $1.20\times$ Bar Revenue.
  - *Craft Cocktails* (Tier 2, Cost \$45, Size 40, Req Bar 3): $1.35\times$ Bar Revenue.
  - *Top-Shelf Champagne* (Tier 3, Cost \$120, Size 30, Req Bar 5): $1.60\times$ Bar Revenue.
- **DJ Beat-Sync Frenzy:**  
  During live play (`_live = true`), clicking `djBeatSync()` triggers a Beat Sync Frenzy ($+15\%$ Total Cash multiplier, and track-specific duration & hype boost) with a 15-second cooldown:
  - *Neon Pulse* (120 BPM, Req DJ 1): 6s Frenzy ($+25\%$ Hype gain).
  - *Acid Rain* (128 BPM, Req DJ 3): 8s Frenzy ($+35\%$ Hype gain).
  - *Midnight Laser Storm* (140 BPM, Req DJ 5): 10s Frenzy ($+50\%$ Hype gain).
- **Pacing Invariant:** Pacing bot does not execute manual Beat-Sync or restock loops, keeping reference bot baselines 100% deterministic.

### 3.3 Club Personas & Named Talent Roster 2.0 — 0.13.0 (PR 6)

Introduces thematic club identity and collectible talent management with compounding synergy tags:

- **Club Personas (`catalogs.js: PERSONAS`):**
  Each club location can adopt an identity (`c.persona`) that applies distinct operational multipliers:
  - *Techno Bunker* (`techno_bunker`, tags: `techno, cyber, underground`): $+30\%$ Hype Gain, $+5\%$ Cash Flow, $-15\%$ Bar Revenue, $+10\%$ Heat Generation.
  - *Velvet VIP Lounge* (`velvet_lounge`, tags: `vip, lounge, luxury`): $-20\%$ Hype Gain, $+25\%$ Cash Flow, $+20\%$ Bar Revenue, $-10\%$ Heat Generation.
  - *Cyber Speakeasy* (`cyber_speakeasy`, tags: `speakeasy, mixology, stealth`): $-5\%$ Hype Gain, $+15\%$ Cash Flow, $+50\%$ Bar Revenue, $-50\%$ Heat Generation.
  - *Heat Multiplier Application:* `persona.heatMult` and `talentHeatReduction` scale heat generation strictly when $\text{rawHeat} > 0$; passive security cooling ($\text{rawHeat} \le 0$) is unaffected.
- **Named Talent Cards (`catalogs.js: TALENT`):**
  A global talent roster (`g.roster`) can be hired for cash and assigned up to 2 active performers per club (`c.activeTalent`):
  - *Nova Cyan* (Stage Headliner, Rare, \$250, tags: `techno, cyber`): Trait "Overdrive Beat" (+20% Stage Hype).
  - *Roxie Spark* (Lead Mixologist, Rare, \$200, tags: `mixology, speakeasy`): Trait "Craft Infusion" (+30% Bar Revenue).
  - *Blade Thorne* (Head of Security, Uncommon, \$150, tags: `stealth, underground`): Trait "Discreet Perimeter" (-30% Heat Gain).
  - *Velvet Vixen* (VIP Host, Legendary, \$500, tags: `vip, luxury, lounge`): Trait "Whale Magnet" (+35% Cash Flow).
  - *DJ Klaus* (Resident DJ, Uncommon, \$180, tags: `techno, underground`): Trait "Bass Resonance" (+15% Hype, +10% Cash).
- **Compounding Synergy Mechanic:**
  When an assigned talent's tags share at least one tag with the club's active persona, their trait effectiveness increases by $+50\%$ compounding (`synMult = 1.50`).
- **Slot Capacity & Multi-Club Assignment:**
  Each club supports up to 2 active talent slots. Attempting to assign into a full lineup is rejected with an explicit notification. Assigning a talent currently active in another venue automatically transfers them to the active club.
- **Save Migration & Pacing Invariants:**
  Bumps `SAVE_VER` from 13 to 14 with `MIGRATIONS[13]` (backfills `g.roster = []`, `c.persona = null`, `c.activeTalent = []`). Default unselected state preserves 100% bit-identical pacing benchmark output.

### 3.4 Branching Blueprint Skill Tree & District Syndicate Map — 0.14.0 (PR 7)

Introduces 4 specialized blueprint skill trees and an interactive city district syndicate network:

- **Branching Blueprint Skill Tree (`catalogs.js: BLUEPRINTS`):**
  Permanently unlocked using Legacy points with tier-gated prerequisites across 4 branches (`g.blueprints`):
  - *Audio Engine (`audio`):*
    - `sub_bass_acoustics` (Tier 1, Cost 1): +20% DJ Booth Hype generation across all clubs.
    - `drop_synchronizer` (Tier 2, Cost 2, Req: `sub_bass_acoustics`): +50% Hype bonus during DJ Beat-Sync Frenzy (x1.50).
    - `acoustic_overdrive` (Tier 3, Cost 4, Req: `drop_synchronizer`): +25% Stage Hype and +10% Cash Flow across all clubs.
  - *Mixology Lab (`mixology`):*
    - `craft_infusions` (Tier 1, Cost 1): +25% Back Bar cash flow.
    - `automated_pourers` (Tier 2, Cost 2, Req: `craft_infusions`): Bar restock yield +30% (+30% stock per batch).
    - `master_distillery` (Tier 3, Cost 4, Req: `automated_pourers`): +15% Bar Revenue across all venues.
  - *Crowd Psychology (`crowd`):*
    - `velvet_allure` (Tier 1, Cost 1): VIP regular conversion rate +25%.
    - `hype_viral_loop` (Tier 2, Cost 2, Req: `velvet_allure`): Buzz converts to patrons +40% faster and +20% Regular retention.
    - `whale_syndicate` (Tier 3, Cost 4, Req: `hype_viral_loop`): Whale visitor cash payout +50% (folded into total cash multiplier).
  - *Underground Syndicate (`syndicate`):*
    - `shadow_patrols` (Tier 1, Cost 1): Police heat generation -25%.
    - `bribe_networks` (Tier 2, Cost 2, Req: `shadow_patrols`): Police bribe cost -40%.
    - `black_market_logistics` (Tier 3, Cost 4, Req: `bribe_networks`): Bar restocking cost -50%.
- **City District Syndicate Map (`catalogs.js: DISTRICTS` & `DISTRICT_LINKS`):**
  Unifies multi-club venues into an interactive city map with toggleable syndicate logistics links (`g.districtLinks`):
  - *Districts:*
    - `downtown` (Downtown Neon Strip, venue `main`): Commercial nightlife corridor anchored by the Main Room.
    - `industrial` (Warehouse Underground, venue `annex`): Sub-bass rave district anchored by the Annex warehouse.
    - `uptown` (Sky Tower Promenade, venue `rooftop`): High-altitude luxury quarter anchored by the Rooftop.
  - *Syndicate Logistics Links:*
    - `vip_shuttles` (Downtown $\leftrightarrow$ Uptown, Cost \$500): +20% VIP Cash Flow in both connected clubs when unlocked.
    - `touring_djs` (Downtown $\leftrightarrow$ Warehouse, Cost \$450): +25% Stage Hype & DJ Frenzy in both connected clubs when unlocked.
    - `supply_corridor` (Warehouse $\leftrightarrow$ Uptown, Cost \$600): 30% discount on bar restocking across all venues when unlocked.
- **Prestige & Franchise Sale Matrices:**
  Blueprints and District Links persist across standard franchise prestige resets (`confirmPrestige`), and wipe back to `{}` upon a full Franchise Sale (`confirmFranchiseSale`).
- **Save Migration & Pacing Invariants:**
  Bumps `SAVE_VER` from 14 to 15 with `MIGRATIONS[14]` (backfills `g.blueprints = {}`, `g.districtLinks = {}`). Reference bot preserves 100% bit-identical pacing benchmarks.

### 3.5 Pluggable Content Pack Engine & Season 1: Miami Vice '86 (v0.15.0, SAVE_VER 16)

- **Pluggable Architecture (`src/core/packs.js`):**
  Content packs can be registered, activated, or uninstalled dynamically at runtime without editing core simulation equations.
  The engine provides pack lifecycle hooks for custom visual styling, additional venues, tracks, cocktails, and seasonal progression.
- **Season 1: Miami Vice '86 (`src/catalogs/packs/season1-miami.js`):**
  - *Theme:* Pastel neon aesthetic (hot pink `#ff71ce`, cyan `#01cdfe`, sunset gold `#fffb96`), CRT scanline overlay option.
  - *Venues:* South Beach Dayclub & Pool (`dayclub`, Ocean Drive daybed bottle service).
  - *Soundtrack:* 80s synthwave audio presets (`Synthwave Sunset`, `Ocean Drive Groove`).
  - *30-Tier Battle Pass Track:*
    Earn seasonal XP (100 XP/tier) via club activities (serving drinks +10 XP, beat drops +15 XP, bribing police +20 XP, buying rounds +25 XP, working room +1 XP).
    Unlocks tiered cash bundles, clout caches, and Legacy point grants.
  - *Grand Capstone Reward (Tier 30):*
    **Golden Flamingo Relic** (`golden_flamingo`): permanent art-deco 24k artifact granting +15% VIP cash flow and +10% prestige Legacy point yield.
- **Prestige & Franchise Sale Matrices:**
  Permanent relics (`g.relics`) and seasonal progression (`g.packs`) persist seamlessly across standard prestige deals (`confirmPrestige`), challenge starts (`startChallenge`), and full franchise sales (`confirmFranchiseSale`).
- **Save Migration & Pacing Invariants:**
  Bumps `SAVE_VER` from 15 to 16 with `MIGRATIONS[15]` (backfills `g.packs`, `g.relics`). Reference bot preserves 100% bit-identical pacing benchmarks.

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
houseCut  = totalCashMult(g)                              // multiplies ALL cash income
totalCashMult(g) = cashIncomeMult(g) × achievementMult(g)                       // House cut × milk
                 × (g.r.brand ? 1.10 : 1)                                      // Brand Licensing research
                 × (1 + challengeBonus(g).cashMult)                            // challenge permanent rewards
                 × (1 + 0.10 × brandRank(g, 'nationwide'))                     // Nationwide Reach brand perk
                 × (1 + 0.02 × brandLevel(g))                                  // Brand Endorsement
                 × (1 + visionBonus(g))                                        // Vision lifetime-value ladder
                 × incomeMod                                                   // active challenge incomeMult
cashIncomeMult(g) = 1 + 0.15 × cash10 perk rank
achievementMult(g) = 1 + 0.01 × owned non-burst achievements // milk multiplier (REPLAY_ROADMAP §3), unique ids only
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

> **Superseded by §19 (deep research tree, shipped 0.11.6):** research is now a
> 12-node, 3-tier tree with prerequisites (`req`). The flat four-item table
> below is historical — it is Tier 1 only.

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

- Blocked at **working** crew `>= caps().crew` (i.e. `crew − off`); parked Off-Shift crew do not block a hire.  
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
cash    += clickVal × totalCashMult(g)
buzz     = min(cap.buzz, buzz + 0.12)
clicks  += 1
```

No cooldown. Primary pink CTA in the action bar. Spawns a `+$` floater and a CTA brightness pulse (v0.7.2; retargeted from `#stage` to `#cta-work-crowd` in 0.16.0).

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

- **Gate:** active club's `regulars >= 25` (goal 14) — reads through `club(g)` (SAVE_VER 9). The **Franchise offer** button appears in the header once met; modal confirms.
- **Gain:** `legacyGain(g) = floor(sqrt(activeClub.regulars) + activeClub.night / 7)`.
- **Reset:** each club's run state resets to `fresh()` defaults **per club** — the `clubs` map keeps every key and `activeClub` stays on its club (SAVE_VER 9); cash/hype/buzz/patrons/regulars/buildings/research reset, and Owner's List state restarts (`clicks: 0`, `rounds: 0`, `goals: []`, same goal arc) — while **perks, managers, managerPaused, achievements, legacy, legacyTotal, prestiges** persist. Start perks seed the active club only.
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

### 9.2 Second prestige layer — Franchise → Renown (shipped 0.11.9)

Full locked design: **`REPLAY_ROADMAP.md` §8**; implementation: `renownGain`, `franchiseGate`, `openFranchise` / `confirmFranchiseSale`.

- **Fantasy:** once every prestige perk is maxed and both clubs are built out, a national conglomerate buys your whole operation — **sell the franchise**, reset *everything*, and keep **Renown**, a permanent meta-currency measuring the brand's national footprint (spent on Brand perks, PR 7).
- **Gate (account-level — `franchiseGate(g)`):** every `PRESTIGE_PERKS` perk at max rank (`perk(g, p.id) >= p.max`) **and** every `MANAGERS` entry hired **and** `g.clubs` has own keys `'main'` **and** `'annex'` (own-property lookup). Evaluated on the account, not the active club — the second prestige is "you've exhausted the first layer and proven the multi-club model."
- **Renown formula:** `renownGain(g) = Math.floor(Math.sqrt(g.legacyTotal || 0) + (g.prestiges || 0) / 3)` — mirrors `legacyGain` (sqrt of **lifetime** Legacy + linear prestige term). ~105 lifetime Legacy + ~15 prestiges → ~15 Renown on the first sale.
- **Reset scope (`confirmFranchiseSale`):** wipes vs persists —

| Wipes | Persists |
|-------|----------|
| `g.clubs` → `{ main: freshClubState() }`; `activeClub` → `'main'` (annex, rooftop re-lock; per-club `persona`/`activeTalent` wipe) | `g.renown` / `g.renownTotal` (+= gain) |
| `legacy`, `legacyTotal`, `perks`, `prestiges` → 0 / 0 / `{}` / 0 | `g.achievements` |
| `clout`, `r` → 0 / `{}`; `managers`, `managerPaused`, `managerLevels` → `{}` ×3 | `g.brand` — the PR 7 sink, the reason to sell again |
| `roster` → `[]`; `blueprints` → `{}`; `districtLinks` → `{}` | `g.brandLevel` (0.11.12 repeatable sink) and `g.lifetimeEarned` (0.11.15 Vision accumulator) — permanent like brand ranks |
| `crew` / `jobs`, `challengesDone` / `challenge` / `challengeTier` / `challengeTiers`, `goals` / `clicks` / `rounds`, `whalesCount` / `specialsCount` / `golden` → fresh / 0 | |

- **Save format (SAVE_VER 13, §13):** `fresh()` adds `renown: 0, renownTotal: 0, brand: {}` (SAVE_VER 10, `MIGRATIONS[9]`), `brandLevel: 0` (SAVE_VER 11, `MIGRATIONS[10]`), `challengeTier: 1, challengeTiers: {}` (SAVE_VER 12, `MIGRATIONS[11]`), and `lifetimeEarned: 0` (SAVE_VER 13, `MIGRATIONS[12]`); each migration defaults missing/malformed values only (**no-clobber** — valid values pass through); `sanitizeG` fail-closes (non-numeric → 0, clamped ≥ 0; non-object `brand` → `{}`; fractional `brandLevel`/`challengeTier` floored; unknown `challengeTiers` ids dropped — with a `challengesDone` → tier-1 backfill; non-finite `lifetimeEarned` → 0); `completeImportedG` adds `renown` / `renownTotal` to the numeric list and defaults `brand` to `{}`; `isValidSavePayload` does not require them (migration fills them).
- **UI (Perks panel):** after the first sale (`g.renownTotal > 0`) a **Renown** readout card ("`N spare · M lifetime`", meta "spent on Brand perks below"); at the gate a distinct cyan **"Sell the franchise"** card previewing "+N Renown · a bigger reset than the franchise deal". The `showFranchise` modal previews "You keep Renown (X spare · Y lifetime) · achievements · Brand ranks" and "You reset **EVERYTHING else** — both clubs, Legacy, perks, research, Clout, managers, crew, challenges". Confirm is **two-click armed** (`state.franchiseArmed` — first click arms, second sells) and **disabled while `tabStale`** ("Reload to adopt fresh save before selling").
- **Persist-before-replace:** the sale candidate is persisted with `localStorage.setItem` **first**; on throw → `saveState: 'franchise failed'` and the live state stays untouched (same rule as prestige above and import, §13.3).

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
bonus           = floor(50 × (1 + hype / 100) × totalCashMult(g))
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
take the $:    cash += floor(25 × totalCashMult(g))      // income-scaled tip
grow the crowd: patrons = min(cap, patrons + 10)          // capped
```

The roll scales by slice time like the whale (`chunk / SIM`), so a lag spike packing many `SIM` slices into one `step()` call cannot inflate the rate. `takeGolden` is idempotent, refuses on a stale (non-owning) tab, and resolves goals/achievements immediately. `g.golden` is additive UI state — `sanitizeG` fail-closes malformed offers (non-object/array/non-finite `at` → `null`), and it never forces a SAVE_VER bump.

**Presentation (0.10.5, moved to the action bar in 0.16.0):** the offer renders as a compact collapsible **VIP badge** in the action bar's second row, not a centered overlay — the idle sim stays visible and keeps ticking underneath. `this.state.goldenOpen` (transient, not persisted) tracks whether the choice is expanded; the claim actions are built in `renderVals()` as `v.takeGoldenCash` / `v.takeGoldenCrowd` so the template never touches the raw `g` (see §14.4). The crowd preview is rounded — `g.patrons` is fractional in the sim.

---

## 12. Achievements (`ACHIEVEMENTS`) — shipped 0.8.1 (23), density pass 0.10.1 (38), meta pass 0.11.14 (48), density pass 0.11.23 (53), challenge-tier pass 0.11.26 (57), mid-band pass 0.11.27 (61)

Permanent unlocks with small Clout/Legacy rewards. `checkAchievements(g)` iterates the catalog; on first pass of a satisfied check it pushes the id, pays the reward once, and logs **“Achievement: <name> — <desc>”** (`#ffd700`). Called per-slice in `step`/`catchUp` (so stat/night thresholds reached mid-window unlock), after every buy/hire action, after `spawnWhale` and the 0.10.2 burst handlers (`maybeCritic`, `takeGolden`), after prestige, and on load via migration v6→v7 backfill.

**Reward accounting rule (0.9.5, regression-tested):** achievement **Legacy rewards credit BOTH `g.legacy` (spendable) and `g.legacyTotal` (lifetime)** — matching how prestige gains are tracked — so `legacy_50` (Legacy Builder) and the Perks tab “Total Legacy earned” reflect achievement income. This matters in a single pass: `prestige_1` (+1) can push `legacyTotal` across 50 and unlock `legacy_50` (+2) in the same `checkAchievements` call.

**0.10.1 density pass:** catalog grew 23 → 38 — new building tiers (10 bars, 5 DJs, 3 marquees, 5 flyer crews, max door, 3 dressing rooms), stat tiers (200 hype, 100 patrons, 50 regulars, 25 nights), 10 rounds, and burst-event achievements driven by two additive counters: `g.whalesCount` (incremented in `spawnWhale`) and `g.specialsCount` (incremented in `advanceShift` when a special actually triggers). The four burst-event achievements reward **Legacy, not Clout**: they fire early and randomly, and Clout rewards would inject variance into research pacing (Clout is the research currency; see §11 and `pacing.mjs`).

**0.11.14 meta pass (PR 3):** catalog grew 38 → 48 — ten new achievements covering the post-sale meta: franchise sales (`franchise_1/5/10` checking `renownTotal`), Brand perks (`brand_1`, `brand_max`), the Rooftop club (`rooftop_1`, `heli_1`), challenge tiers (`challenge_1`, `challenge_all`), and Brand Endorsements (`endorse_5`). All reward Legacy only (no Clout), expanding the milk multiplier ceiling from +34% to +44% (44 non-burst of 48 total). None of these checks fire on the pacing bot's standard path (which never sells, never opens the rooftop, never starts challenges, never owns brand), so `pacing.mjs` bands remain bit-identical.

**0.11.23 density pass (post-polish PR 3):** catalog grew 48 → 53 — five new achievements fill the location-extras and endorsement-ladder coverage gaps: `vista_1` (own the Panorama Deck at the Rooftop, `g.clubs.rooftop.u.vista === true`), `heli_2` (2 Helipads at the Rooftop), and `endorse_10/25/50` (Brand Endorsement levels 10/25/50). All reward Legacy only (crediting both `g.legacy` and `g.legacyTotal` per the 0.9.5 accounting rule), expanding the milk multiplier ceiling from +44% to +49% (49 non-burst of 53 total). Club-level reads use the full `g.clubs.rooftop` path (not the active club's `b`/`u` view). None fire on the pacing bot's standard path (it never opens the Rooftop or buys Brand Endorsement), so `pacing.mjs` bands remain bit-identical.

**0.11.26 challenge-tier pass (post-polish PR 6):** catalog grew 53 → 57 — four tier-aware achievements celebrate the 12-run challenge ladder rather than the flat "4 done" count: `challenge_t2_one` / `challenge_t3_one` (any challenge at tier 2 / 3) and `challenge_t2_all` / `challenge_t3_all` (all 4 challenges at tier 2 / 3). All reward Legacy only (crediting both `g.legacy` and `g.legacyTotal`) and read `g.challengeTiers` — the post-0.11.13 source of truth — **not** the legacy `g.challengesDone` array (the flat `challenge_1`/`challenge_all` keep reading `challengesDone`). Expanding the milk multiplier ceiling from +49% to +53% (53 non-burst of 57 total). None fire on the pacing bot's standard path (it never starts a challenge), so `pacing.mjs` bands remain bit-identical.

**0.11.27 mid-band pass (ultra-review W2):** catalog grew 57 → 61 — four progression hooks for the 105m–311m dead zone (all-research owned → franchise gate). `prestige_15` / `prestige_25` (15/25 franchise deals, `g.prestiges`) and `legacy_125` / `legacy_250` (125/250 lifetime Legacy, `g.legacyTotal`) give the grind to the gate a visible target and extend targets past the first sale. All reward Legacy only (crediting both `g.legacy` and `g.legacyTotal` per the 0.9.5 accounting rule). The plain pacing bot never prestiges, so it cannot advance these monotonic counters — every main milestone band stays bit-identical; re-classified from 10/100 to 15/125 after the 11-cycle renown run breached the mid-band ±5% band. The milk multiplier ceiling expands +53% → +57% (57 non-burst of 61 total). No save-shape change — achievements are account-wide and already snapshot/restored in all three reset paths.

**Milk multiplier (REPLAY_ROADMAP §3):** every achievement adds +1% to all cash income (passive + active clicks) via `achievementMult(g)`, folded into the `houseCut` multiplier alongside the House cut perk (§4.2). `achievementMult(g)` counts **unique, non-burst** achievements: duplicate ids are deduped, and the 4 live-only burst achievements (`whale_1`, `whale_10`, `special_1`, `special_5` — driven by `g.whalesCount`/`g.specialsCount`, which the deterministic pacing bot can never earn) are excluded. At the full 57 deterministic achievements that is +57% (not +61% of 61 total) — the collection is a real progression path, not a checklist. The multiplier applies to **all cash income** — passive `rates()`, active clicks, the whale bonus (§11.2), and the golden-ticket tip (§11.4) — through the single `totalCashMult(g)` composition point, so it can't silently skip a source. Derived from `g.achievements`, so no save-shape change. The pacing bot earns achievements deterministically, so this re-centers the "all upgrades owned" milestone (~45m → ~32m) — see `pacing.mjs`.

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
| franchise_1 | First Sale | renownTotal ≥ 1 | 2 Legacy |
| franchise_5 | Serial Entrepreneur | renownTotal ≥ 30 | 5 Legacy |
| franchise_10 | Titan | renownTotal ≥ 60 | 8 Legacy |
| brand_1 | Brand New | any brand perk rank ≥ 1 | 2 Legacy |
| brand_max | Brand Portfolio | all 5 brand perks at their individual max ranks | 5 Legacy |
| rooftop_1 | Penthouse | rooftop club unlocked | 3 Legacy |
| heli_1 | Sky Hook | rooftop heli ≥ 1 | 3 Legacy |
| challenge_1 | Trailblazer | challengesDone ≥ 1 | 2 Legacy |
| challenge_all | Completionist | challengesDone ≥ 4 | 4 Legacy |
| challenge_t2_one | Hardened | any challenge tier ≥ 2 | 3 Legacy |
| challenge_t3_one | Ironclad | any challenge tier ≥ 3 | 3 Legacy |
| challenge_t2_all | Gauntlet | all 4 challenges tier ≥ 2 | 3 Legacy |
| challenge_t3_all | Legendary | all 4 challenges tier ≥ 3 | 3 Legacy |
| endorse_5 | Endorsed | brandLevel ≥ 5 | 3 Legacy |
| vista_1 | Panorama | rooftop `u.vista === true` | 3 Legacy |
---

## 11. Burst events & visitors

Three live-session burst opportunities keep active play rewarding:

### 11.1 The Whale (`spawnWhale`) — shipped 0.8.0

Spawns during live sessions with cash reward and particle bursts.

---

## 12. Achievements (`ACHIEVEMENTS`)

Permanent unlocks with small Clout/Legacy rewards.

---

## 13. Save system

| Field | Value |
|-------|--------|
| localStorage key | `afterglow.save` |
| SAVE_VER | **16** |
| Envelope | `{ saveVer, ver, build, g }` |
| Autosave | every 10 s (`save('auto')`) |
| Manual | Settings → Save now |

### 13.1 `g` shape (v16 — Content Packs & Miami Vice 0.15.0)

```
clubs: {
  main: {
    cash, hype, buzz, patrons, regulars, heat,
    barStock, barTier, djTrack, _frenzyT, _beatCooldown,
    persona, activeTalent,
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
managers: { id: bool }, managerPaused: { id: bool },
renown, renownTotal,        // 0.11.9 Renown meta (second prestige layer)
brand: { perkId: rank },    // 0.11.9 Brand-perk ranks (PR 7 spends Renown)
brandLevel,                 // 0.11.12 Brand Endorsement level (repeatable Renown sink)
challengeTier, challengeTiers, // 0.11.13 challenge tier ladder (SAVE_VER 12)
lifetimeEarned,             // 0.11.15 Vision ladder accumulator (SAVE_VER 13)
roster,                     // 0.13.0 Named Talent global roster (SAVE_VER 14)
blueprints: { id: bool },   // 0.14.0 Branching Blueprint Skill Tree unlocks (SAVE_VER 15)
districtLinks: { id: bool }, // 0.14.0 City District Syndicate Logistics Links (SAVE_VER 15)
packs: { active: id, progress: { id: { tier, xp, claimed } } }, // 0.15.0 Content Pack Engine & Seasonal Track (SAVE_VER 16)
relics: { relicId: bool }   // 0.15.0 Permanent seasonal relics (SAVE_VER 16)
```

Club-level run fields live under `g.clubs[<id>]`; account/shared fields stay top-level. `club(g)` reads/writes the active club (SECOND_LOCATION.md §5), so club fields must never be treated as top-level. Flat `g.cash`-style access exists only through the `wrapState` compat proxy (same shape on disk: `JSON.stringify` emits the real v16 layout).

Additive fields (`managerPaused`, the 0.10.1 counters `whalesCount` / `specialsCount`, and the 0.10.2 `golden` offer) default to 0/false/null when absent — not required by `isValidSavePayload`, so they never force a SAVE_VER bump on their own. The 0.11.9 Renown fields (`renown`, `renownTotal`, `brand`) are part of SAVE_VER 10 itself — `MIGRATIONS[9]` defaults them, `sanitizeG` / `completeImportedG` fail close on malformed values, and `isValidSavePayload` still does not require them (migration fills them). The 0.11.12 Brand Endorsement level (`brandLevel`) is part of SAVE_VER 11 — `MIGRATIONS[10]` defaults it, same fail-closed shape. The 0.11.13 challenge tier fields (`challengeTier`, `challengeTiers`) are part of SAVE_VER 12 — `MIGRATIONS[11]` defaults them and backfills tier 1 from `challengesDone` (the repo convention: a new persisted field bumps, even when additive — PR 6/PR 1 review precedent). The 0.11.15 Vision accumulator (`lifetimeEarned`) is part of SAVE_VER 13 — `MIGRATIONS[12]` defaults it to 0 (no-clobber) and the ladder starts measuring from the migration (history cannot be reconstructed). The 0.13.0 Personas & Talent fields (`roster`, per-club `persona`/`activeTalent`) are part of SAVE_VER 14 — `MIGRATIONS[13]` defaults and normalizes them. The 0.14.0 Blueprint and Syndicate fields (`blueprints`, `districtLinks`) are part of SAVE_VER 15 — `MIGRATIONS[14]` defaults and normalizes them. The 0.15.0 Content Pack and Relic fields (`packs`, `relics`) are part of SAVE_VER 16 — `MIGRATIONS[15]` defaults and normalizes them.

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
2. `isValidSavePayload` (saveVer finite; club resources cash/hype/buzz/patrons/regulars numeric — read from the active club (own-property lookup; fallback main → any own club → top-level) for clubs-map payloads (v9+), top-level for pre-v9; clout/crew numbers; jobs object)  
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
| 9 → 10 | Renown layer: `renown` / `renownTotal` / `brand` defaulted when missing or malformed — **no-clobber** (valid values pass through); `sanitizeG` re-checks the same shape after the chain |
| 10 → 11 | Brand Endorsement: `brandLevel` defaulted to 0 when missing/malformed — no-clobber |
| 11 → 12 | Challenge tiers: `challengeTier` / `challengeTiers` defaulted; tier 1 backfilled from `challengesDone` |
| 12 → 13 | Vision ladder: `lifetimeEarned` defaulted to 0 when missing/malformed — no-clobber (history cannot be reconstructed; the ladder starts measuring from migration) |
| 13 → 14 | Club Personas & Named Talent: `g.roster` defaulted to `[]` and filtered; per-club `persona` and `activeTalent` initialized and fail-closed |
| 14 → 15 | Blueprint Skill Tree & District Syndicate: `g.blueprints` and `g.districtLinks` defaulted to `{}` and filtered against catalogs |
| 15 → 16 | Content Packs & Relics: `g.packs` and `g.relics` defaulted, `packs` structure and tier progression normalized, relics filtered via RELICS catalog |

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
Main: `.app-root` is the single-column scroller (`height:100dvh; overflow-y:auto; grid-template-columns:minmax(0,1fr)`). Inside it, `.shell-grid` is a **2-column grid on desktop** (`minmax(440px,1fr) minmax(360px,480px)` — Actions · Systems) and **1-column on mobile** (`1fr`). The old 3-column shell-grid (Ledger · Stage · Systems) was replaced in 0.16.2 (PR C) by the header resource strip + Books drawer, and the Stage panel was removed in 0.16.0 (PR A). `padding-inline: 18px` on `.shell-grid` aligns the grid flush under the header and ticker bar. Above 2160px a media-query guard re-caps the layout at 2200px with `1fr 520px`.

| Region | Contents |
|--------|----------|
| Header | Afterglow wordmark, version badge (opens changelog), **resource strip** (Cash/Hype/Buzz/Patrons/Regulars/Clout with rates, color-coded, 2px cap bar), **Books drawer** toggle, **Franchise offer** (once the 25-regulars gate is met), **Open second room** + `[ Main ] [ Annex ]` switcher (once the §17 gate is met; a third `[ Rooftop ]` entry appears once the Rooftop Lease is bought, §22.2), shift name + bar + night/mult, settings ☰ |
| Ledger | **Removed in 0.16.2** (PR C). Contents moved to header resource strip + Books drawer. The collapsible aside (toggle ▸/▾) and per-room ledger detail no longer exist. |
| Systems | Tabs Club + Crew (always visible) / **Upgrades** (gated on first building owned) / **Research** (gated on first Clout earned) / **Perks** (gated on `prestiges > 0`) / **Talent** (0.16.3+); **Owner's List** as collapsible goal card under tabs; scrollable cards + crew assignments; purchase grid (0.16.3+) |
| Footer | full version string, save format, saveState, tick count; multi-tab takeover banner above when stale; ticker text |
| Modals | Changelog history; **Achievements**; Settings (save I/O + wipe + Look & feel incl. Ambient floor toggle) |

Typography (loaded in `index.html`): **Monoton** (wordmark), **Space Grotesk** (UI), **IBM Plex Mono** (numbers). Palette is magenta `#ff2d78`, cyan `#22d3ee`, gold `#ffc94a` on near-black `#07050c`.

**Surface layer — universal states & texture (0.11.18).** The sim UI is built with inline styles from `game.js`, so any property a button sets inline wins over a plain stylesheet rule — but `filter` / `opacity` / `transform` / `outline` / `transition` are set on almost no button, so the whole surface gained a universal layer from `style.css` without `!important`:

- **Focus** — `:focus-visible` ring (2px `#22d3ee`, offset 2px) on every button, link, `[tabindex]` control (including the inline help `?` icons) and Look-panel input. The surface previously had no visible focus indicator at all; this is the keyboard/AT requirement, not decoration.
- **Interactivity** — every button gets `transition: filter/opacity/transform .1–.15s`, `hover: brightness(1.10)` and `active: translateY(1px) + brightness(0.94)`; `.cta` keeps its stronger brightness. Disabled buttons read inert: `opacity:.6; cursor:not-allowed`. **0.11.21:** transitions and hover/active effects are now desktop-only (`@media (hover: hover) and (pointer: fine)`) — on mobile they caused severe scroll jank (content moved 1 frame, paused 3-4 frames) because the browser evaluated transitions for dozens of buttons during scroll. Touch devices don't have hover states, so the effects were pure overhead.
- **Texture** — a fixed, `pointer-events:none` film-grain overlay on `body::after` (inline SVG `feTurbulence`, `opacity:.035`, `mix-blend-mode:overlay`, `z-index:999`) breaks the flat panels without washing out the neon. The `still`/`easy` motion prefs do not interact with it (it is static).
- **Mobile CTA glare** — below 900px the primary CTA's 22px pink bloom is pulled tight to `0 3px 14px rgba(255,45,120,.22)` (`!important` beats the inline `box-shadow`); an idle game sits on OLED panels for hours and the wide bloom read as glare.

Purely CSS; the `game.js` render path, palette, and fonts are untouched, so the visual invariant above holds and `SAVE_VER` stays 13.

**One scroller at every width (v0.10.7 mobile-only, v0.16.1 everywhere).** The app root is `height:100dvh; overflow-y:auto` (with `100vh` fallback for browsers without dynamic viewport units) and is the only vertical scroller — Ledger, Night log and the Systems tab body carry no overflow of their own and simply size to content. Header, action bar and tab bar are sticky (`top:0` / `top:62px`, below 900px the tab bar pins to `top:0` because the header wraps) so controls stay in reach on long pages. Scroll save/restore keys per-tab positions off `data-scroll="main"` as `scrollSave["main_"+tab]`, so Club→Crew→Club returns to the same card. The v0.10.7 mobile-only override block (inner panels `overflow:visible !important`, shell `grid-auto-rows:min-content`) is deleted — the base layout now does what the override did. The scroll-defer guard (0.11.28, capture-phase listener on the stable root) already works for any scroller under the root, so it covers the app-root scroller unchanged. None of this is reachable by the three verification gates, which stub the DOM — it was verified in headless Chrome at 1366×768, 1920×1080 and 390×844 via `tools/screenshot.sh`.

**Narrow screens — native scrollbars (0.11.19).** The shell scroller keeps the **native overlay scrollbar** on touch devices: the custom 9px `::-webkit-scrollbar` styling now lives behind a `(hover:hover) and (pointer:fine)` gate. Styling the pseudo-element unconditionally forces Chrome Android to render a persistent classic scrollbar with a reserved gutter, and that gutter toggling as content height changed (log appends, Ledger expand/collapse) read as a stuck, jittery bar. Coarse pointers also get `overscroll-behavior-y:contain` (no pull-to-refresh / gesture hand-off at the edges) and `-webkit-overflow-scrolling:touch` for legacy iOS momentum. Relatedly, the 0.11.18 film-grain layer is **disabled entirely** on coarse pointers (0.11.20) — a fixed full-viewport layer with an SVG noise background forced per-frame repaints on mobile GPUs, which read as scroll stutter ("sticks when using thumbs"). Desktop keeps the overlay blend.

**Narrow screens — scroll-jank fix (0.11.22).** The render does full `innerHTML` replacement which blocks the main thread. On mobile, this caused scroll to stutter (move 1 frame, pause 3-4 frames) because the render ran every 250ms even during touch scroll. Now defers renders during touch scroll via a `scrolling` flag set by a passive scroll listener on `.shell-grid`, then catches up after scroll stops (150ms debounce). Also promotes `.shell-grid` to its own compositor layer with `will-change: transform` for GPU-accelerated scrolling. Purely performance — no behavior or save change. **0.11.28 follow-on:** `will-change: transform` turned out to establish a containing block, so the mobile `.stage-cta` (documented "stays pinned while the shell scrolls") resolved its `position: fixed` against the shell and scrolled away with content. The hint is now `will-change: scroll-position` — the canonical scroller hint, no containing block — restoring the true viewport pin. Same 0.11.22 perf intent; desktop untouched (the rule lives in the ≤900px block).

**Narrow screens — overscroll containment restored (0.11.42).** The 0.11.19 `overscroll-behavior-y:contain` on the shell scroller was silently lost when the 0.11.21 button-transition fix rewrote the adjacent comment block and dropped the declaration with it — since then, gestures at the scroll edges handed off to the browser again (rubber-band on iOS, pull-to-refresh hand-off on Android). Restored verbatim, and the expanded-Ledger scroller (`.ledger-detail`, also below 900px) gets `overscroll-behavior-y:contain` of its own so its edge cannot chain into the shell. Purely CSS; desktop (≥901px) never sees either rule; `SAVE_VER` stays 13.

**Narrow screens — stage art removed everywhere (v0.10.8 hidden, v0.16.0 removed).** Below the same 900px, `#stage` used to be `display:none` (v0.10.8, operator request): environment only, no controls, a screenful to scroll past before reaching *Work the room*. In 0.16.0 the panel was removed from the DOM at every width, so there is nothing left to hide — the Main Stage line, Room energy % and VIP badge live in the action bar's second row instead. The click brightness pulse and keyboard tip-floater anchor were retargeted to `#cta-work-crowd`; the anchor still size-checks its rect (below 900px the thumb cockpit replaces `.stage-cta`, so the button is truthy but measures 0×0 and would park the floater in the top-left corner).

**Narrow screens — collapsible Ledger (v0.10.16).** Below 900px the Ledger renders collapsed to the **CASH row only**, with a tap-to-expand chevron (▸/▾) for the full resource rows and the Floor block. The full Ledger — six resource rows plus Floor — measured **776px on a 390px phone**, taller than the whole viewport and first in the stacked column: *Work the room* (y≈703) and the Systems tabs (y≈1113) were both below the fold, so a new player scrolled past a wall of read-only numbers before reaching anything pressable. Collapsed it is ~70px, moving *Work the room* to y≈219 and the tabs to y≈331. **CASH stays visible collapsed** — it is the number idle players watch; the state flag `state.ledgerOpen` (transient, like `tab`, not persisted) drives the `ledger-collapsed` class, and the toggle button plus the collapse rule live entirely inside the ≤900px media query, so desktop keeps the always-expanded Ledger and never sees the chevron. **0.11.31:** the expanded `.ledger-detail` caps at `min(45vh, 420px)` with `overflow-y:auto` (RED-3 — expansion no longer pushes the tab row and Systems cards off-screen; the max-height collapse animation still runs to the cap). The tab bar pins to the viewport top below 900px (`position:sticky; top:0; z-index:10`, YELLOW-4) so it stays put while long tabs scroll — applied with `!important` because game.js bakes an inline `top:62px` into the `.tab-bar-wrap` div for the fixed-height desktop header, while the mobile header wraps to multiple rows (same override pattern as the 0.11.18 CTA-glow rule). Since 0.16.1 the inline style itself is sticky — the override only corrects the offset.

**Narrow screens — tap targets (v0.10.17).** Below 900px every button gets `min-height:44px; min-width:44px` via `#app button, #look-panel button:not(.lk-seg)`. The multi-buy ×1/×5/×10/×Max row — the most-tapped controls in an idle game — was **40×30px**: Barbara's thumb covered two at once and she bought the wrong thing twice. The tab bar was 38px tall, the ☰ menu 34×34, the job steppers 26×26, the version badge 33px. `min-height`/`min-width` beat the inline `height`/`width`/`padding` from `game.js` (a min-constraint overrides a fixed size), so one rule covers the shell, header, modals, and the Look panel (mounted on `body`); `!important` is needed only because the multi-buy buttons carry an inline `min-width:40px`. The Look panel's mood/motion segments (`.lk-seg`, game.js `paintLookPanel`) are exempt from the width floor — they carry an inline `min-width:0` so they can flex-shrink and ellipsize below content width, and a 44px floor would silently defeat that if a fourth option is ever added; they keep the 44px height floor. The rule lives inside the ≤900px media query, so desktop keeps its compact controls. Verified at 320px: the multi-buy row (194px = 4×44 + gaps) fits the 311px column on one line with no overflow.

**Contrast floor (v0.11.38).** The 2026-08-28 headless mobile audit (390×844) measured the dimmest text against the page background (`#07050c`): night-log timestamps `#4a3860` at **1.96:1**, locked/disabled control text and tab hints `#6f5885` at **3.29:1**, and the section micro-labels `#7b5f90` at **3.75:1** — all under the WCAG AA floor, on the exact small font sizes phones magnify least. All three tones collapse to one readable muted purple, **`#8f6f9c` (4.75:1 on the page, 4.49:1 on control backgrounds `#120c1c`/`#1f1430`)** — timestamps, locked crew-stepper/Buy-a-round labels, requirement and meta lines, tab hints, and the Ledger/Shift/House/Room-energy/Assignments micro-labels. The mobile-only 8px header labels (wordmark sub-line, version-button sub-text, `style.css` ≤900px block) rise to 9px. Affects desktop too — the same tokens render there — which is the point: contrast is a property of the palette, not the viewport.

**Responsive Dual-Surface Layout & Mobile Bottom-Cockpit (0.12.1, PR 2).** Implements the dual-surface responsive architecture:
- **Desktop Command Deck (≥901px):** Three parallel columns (`#ledger-aside`, `.stage-col` actions column, `#systems-column`). Centered backdrop-blurred modal overlays (`.modal-overlay` / `.modal-dialog`). `.thumb-cockpit` is `display:none`.
- **Mobile Bottom-Cockpit (≤900px):** Single-column stacked scroller (`.shell-grid` with `padding-bottom:140px`). Primary interaction CTAs (`Work the room` and `Buy a round`) and Systems tabs (`#thumb-tabs-container`) move to a bottom cockpit (`.thumb-cockpit`) pinned at `bottom: 28px` with notch/home-bar padding `calc(6px + env(safe-area-inset-bottom, 0px))`.
- **Slide-Up Bottom-Sheet Drawers:** Modals on mobile anchor to the bottom of the viewport with rounded top corners (`border-radius: 16px 16px 0 0`) and animate in via `slideUpDrawer`.
- **Zero Tap Latency:** `touch-action: manipulation` applied across all interactive controls (`button, input, select, textarea, a`) to eliminate 300ms mobile touch delay. Min hitboxes remain ≥44×44px.

### 14.2 Ambient floor (was: Main Stage panel — removed 0.16.0)

**No CSS/DOM performer, pole, or undressing progression — and since 0.16.0, no stage panel at all.** Operator removed the figure in v0.7.0 (“gimmicky”); operator removed the whole art panel in 0.16.0 (a height sink carrying no information — its only readouts already had a stage-less rendering). What survives:

- **Ambient canvas:** the 0.12.2 floorboard engine now paints `<canvas id="ambient-canvas">` behind `.app-root` (35% opacity, `pointer-events:none`, negative z-index inside an isolated app root so it sits above the background but below every card). Same `floorboard.update()` feed (patrons/regulars/hype/beam/sign-lit). Look-panel **Ambient floor** toggle (`afterglow.look`) removes the canvas entirely; Motion Easy/Still pauses its rAF loop.
- Main Stage *job* (`jobs.stage`, the assignment slot, `stageHype`, the "hire crew to open the stage" line) is sim/save and untouched — only the art panel went. Empty-stage badge text still routes crew assignment: hire / assign / nobody on stage (badge → Crew tab).
- **Canvas Floorboard Engine (`src/ui/floorboard.js`, 0.12.2, PR 3):** 60 FPS HTML5 Canvas floorboard. Simulates dynamic perspective neon floor grid, spotlight and laser sweeps, crowd particle physics responsive to patrons/hype, and interactive click/buy ripples. Automatically pauses requestAnimationFrame loop when `document.visibilityState === 'hidden'`.
- **Procedural Web Audio Synthesizer (`src/core/audio.js`, 0.12.2, PR 3):** Zero-asset Web Audio API synthwave generator (<4KB). Features 4-on-the-floor sub-bass kick, highpass noise hi-hats, and 24dB resonant lowpass modulated synth bass notes synced to club hype. Provides tactile pitch-envelope click SFX on "Work the room" and chime arpeggio on "Buy a round". Muted by default, user-toggled via header `#header-sound-btn` / Settings modal, persisted in `localStorage['afterglow.sound']`.

**Removed (do not restore without an explicit ask):** `dancerHTML()`, `perfStyle`, `#performer-stage` preservation, `state.stageH` / ResizeObserver fit, `.performer` / `.pole` / `dn*` CSS — and since 0.16.0, the `#stage` panel itself (beams, bulbs, neon sign, sweeps, spot, divider, lip, crowd row, in-stage golden wrap) plus the `bulb` / `sweepL` / `sweepR` / `hazeDrift` / `crowdBob` keyframes.

**Look prefs** (`localStorage['afterglow.look']`, chrome only — not in the save): House lights, Room mood, Motion (Full / Easy / Still), Ambient floor (On / Off). Panel mounts outside `#app` so the 10 Hz render loop does not destroy it.

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

### 14.5 Second-room header controls (0.11.1)

Once the second-room gate is met (`g.prestiges >= 1` **and** at least one manager — account-level, §17), the header gains an **"Open second room"** control next to the Franchise offer family; below the gate it is absent, not grayed. Clicking opens a confirmation modal (preview: fresh till/crowd/build, shared Clout/Legacy/research/crew/managers, first club untouched); confirm opens the **annex** as a one-time account unlock that is **not** a prestige. After unlock, a compact `[ Main ] [ Annex ]` switcher appears beside the shift badge (a third `[ Rooftop ]` entry joins once the lease is bought, §22.2) — instant switch, the inactive club pauses, and the Ledger's room label ("Main Room" / "Annex" / "Rooftop") tracks the active club. `tabStale` blocks both the unlock and the switch (no account progress written only to memory). **Responsive (0.11.1):** at ≤900px the header wraps to as many rows as it needs (`flex-wrap: wrap` with `height: auto` via `!important` over the inline styles), so the extra switcher buttons never push the shift block or ☰ offscreen; the app grid's auto header row grows and the shell keeps scrolling.

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

## 17. Second room (0.11.1, Slice B)

The full design lives in **`SECOND_LOCATION.md`** (fantasy, gate, club shape, simulation, UI, non-goals). This section is the as-shipped summary.

- **Save shape (SAVE_VER 9+, §13).** `g.clubs` maps club id → run state; `g.activeClub` names the club being played. Club-level fields (`cash/hype/buzz/patrons/regulars/b/u/elapsed/night/shift*/_special/_whale`) live per club; account fields stay top-level. The namespace is plain strings — new rooms never bump `SAVE_VER`.
- **Gate (locked, SECOND_LOCATION.md §2):** `g.prestiges >= 1` **and** at least one manager hired (`Object.values(g.managers).some(Boolean)`), evaluated on the account. Below the gate the header shows no second-room chrome; above it, an **Open second room** control appears.
- **Unlock (`confirmOpenRoom`):** one-time, **not** a prestige — the first club is untouched. Creates `g.clubs.annex` from a fresh club state (starting cash, empty build stack, shift clock baseline). `tabStale` blocks open and confirm.
- **Switcher (`setActiveClub`):** instant, re-renders; the inactive club pauses (no inactive offline window, no cross-club cash). Crew is shared — switching to a room with a smaller Dressing Room cap **evicts excess working crew to `off`** (floor → stage → VIP; no auto-restore); `moveJob` assignment (and the rendered lock state) enforces the same working-crew cap, so evicted crew cannot be reassigned straight back. If the destination room doesn't unlock the current tab (e.g. Upgrades on a fresh annex), the tab falls back to Club.
- **Ledger:** resources read the active club; Clout/Legacy stay account-level; the room label ("Main Room" / "Annex") tracks the active club.
- **Simulation:** `rates/caps/step/catchUp`, managers' auto-buy, and whale/critic/golden events all run through `club(g)` — active club only. A pending golden offer is **bound to its source club** (`g.golden.club`) and resolves there even after a switch — no cross-club transfer.
- **Club IDs:** validated on import to a safe identifier shape (`/^[A-Za-z][A-Za-z0-9_-]{0,24}$/`, and never an `Object.prototype` member) — crafted IDs cannot smuggle markup into the header buttons (labels are also HTML-escaped).
- **Non-goals (v1):** no travel map, no cash transfers, no inactive-club offline earnings, no per-club crew/research, max 2 clubs, no location-specific buildings.
- **Pacing guard (0.11.2):** `pacing.mjs` `secondRoomRun` — the bot prestiges twice (cash10 ×2 + one manager), unlocks the annex, and asserts the annex's first LED with account progress lands before a no-perk fresh run's first LED (measured −3.45m). The rail manager is paused for the measurement so its unbounded auto-buy does not redirect the till.

---

## 18. Flavor layer (`FLAVOR` / `REGULAR_NAMES`) — shipped 0.11.5

Ambient identity beyond numbers (REPLAY_ROADMAP.md §4). Two pure-display data
tables plus a ticker — **zero pacing impact**: nothing here is read by
`rates()`/`step()`, and the reference bot never renders it.

- **`FLAVOR`** — a catalog of `{ cond(g, c), text }` ticker lines keyed on state
  (regulars/hype/patrons thresholds, building counts, nights). `flavorLine(g, c, tick)`
  filters to the applicable lines and rotates through them on a ~3s cadence
  (`floor(tick / 30) % lines.length`, 30 sim frames at 10Hz). A catch-all entry
  ("The night is young.") guarantees a non-empty line.
- **`REGULAR_NAMES`** — a 20-name pool. `regularName(g)` derives the featured
  regular from the active club's regulars count: one new name every 5 regulars,
  `null` below 5. Surfaced in the Ledger's Regulars note ("Margo is a regular").
- **House strip (0.11.25, post-polish PR 5)** — a compact "House" readout in the
  Ledger with three derived, render-only reads: `houseReputation(g)` tiers a label
  from rounds bought ("Buys the first round" → "Neighborhood legend"), a
  special-shift record from `g.specialsCount` (★ N), and `weekendEnergy(g)` maps
  nights elapsed 0–1 (peaks at 30) to a cool→warm tint. The strip only renders
  once a chip is non-empty. `FLAVOR` also gains three back-half lines keyed on
  night 25, the first special shift, and the first Brand Endorsement.
- **Ticker UI** — a slim `TODAY` strip under the header (`.ticker-bar`), truncated
  with ellipsis on narrow screens. Render-only; `ticker` is computed in `renderVals`
  and never persisted.

**Non-goals:** no dialogue trees, no narrative arc, no new currencies, no
player-visible state — the ticker and names are derived, so there is no new
`g.*` field and no `SAVE_VER` bump.

## 19. Research tree (`RESEARCH`) — shipped 0.11.6

Deep research tree (REPLAY_ROADMAP.md §5): 12 nodes across 3 tiers with
prerequisites. `req` is existence-based (a research id — `g.r[req]` truthy),
mirroring the perk-req shape, NOT the UPGRADES object-req shape. Supersedes the
flat four-item list in §5.

- **Tier 1 — cheap multipliers, no prerequisites:** loop (12), latemenu (12),
  promo (20), cover (24), payroll (32). The cheapest item (loop, 12 Clout)
  anchors the "first research" pacing band.
- **Tier 2 — mechanic unlocks + stacking multipliers (req-gated):** host (45,
  req promo) unlocks the Floor Host job; scheduling (50, req payroll);
  concierge (55, req cover); playbook (60, req loop).
- **Tier 3 — expensive account-wide bonuses:** brand (90, req concierge),
  school (100, req scheduling), network (110, req playbook).

**Prerequisites are an action invariant:** `buyResearch()` rejects a node whose
`req` isn't owned (`g.r[req]` truthy) — never trust the UI alone. The research
card reports the same unavailable state via `reqLocked`/`reqName`
("requires X"). `pacing.mjs`'s `tryBuyCheapestResearch()` filters unmet
prerequisites so the bot advances the tree deterministically.

**Job catalog is the single source of truth for the shared roster.** Jobs gain
`unlock` (research id that gates the job) and `prio` (eviction order when a
club switch caps working crew). `fresh()`, `sanitizeG()`, save validation,
`moveJob()`, and `setActiveClub()` all iterate `JOBS` — no hardcoded four-id
list. A locked job holds zero crew, cannot receive crew via `moveJob()`, and is
evicted to Off Shift if a load/reset drops its unlock.

**Effects (all in `rates()`):** cover +50% door cover; concierge +50% VIP booth
income; scheduling −25% wages (stacks with payroll); playbook +25% regulars
conversion; brand +10% all cash; school +15% crew output; network +25% Clout;
the host job adds +0.04 patrons/s each.

**Pacing:** a new "all research owned" milestone (~105 min ±30%) joins
`pacing.mjs`. The cheapest item is unchanged, so "first research" and every
earlier band stay bit-identical (1.53 / 5.70 / 7.70 / 14.35 / 19.85 / 32.00 m).

**Non-goals:** no per-club research (stays account-level per SECOND_LOCATION.md);
no research that costs Legacy/Renown (Clout only). No save-shape change —
`SAVE_VER` stays 9.

## 20. Challenge runs (`CHALLENGES`) — shipped 0.11.7

Opt-in replay modifiers with permanent, derived rewards (REPLAY_ROADMAP.md §6).
UI lives at the bottom of the Perks panel.

- **`CHALLENGES`** — `{ id, name, desc, mod, reward, check }`. `check` is a
  completion predicate over the merged club view (like achievements); `mod` is
  the run modifier while active; `reward` is the permanent bonus.
- **Modifiers:** `startCash` (starting till override), `incomeMult` (all cash
  income ×N via `totalCashMult` — passive + active clicks + whale + golden,
  no click bypass), `locked` (building ids blocked in `buyBuilding`,
  `autoBuyManagers`, and the card).
- **Rewards are derived, not stored:** `challengeBonus(g)` aggregates
  `challengesDone` + the table into additive `cashMult` (+% all cash),
  `doorMax` (+N cap), `crewOut` (+% crew output). No Clout/Legacy rewards
  (Legacy-not-Clout rule).
- **State:** `g.challenge` (active id or null) + `g.challengesDone` (array) —
  additive; sanitize/import fail-closed (unknown ids dropped). `SAVE_VER`
  stays 9.
- **Lifecycle:** `startChallenge` (two-click armed) resets every club to fresh
  and re-locks the annex, preserving account meta; `checkChallenge` runs inside
  `checkAchievements` and records completion; `endChallenge` lifts the modifier
  without reward; prestige clears the active challenge but keeps `challengesDone`.

### 20.1 Challenge tiers (next-roadmap PR 2, 0.11.13)

Each challenge is now a **3-tier ladder** — the four modifiers become 12
replay runs. Tiers tighten the modifier and scale the permanent reward ×tier.

| Challenge | Tier 1 | Tier 2 | Tier 3 |
|-----------|--------|--------|--------|
| Tight Till | $0 start | + all income ×0.85 | + all income ×0.7 |
| Slim Margins | income ×0.5 | ×0.4 | ×0.3 |
| No Street Team | Flyer Crew locked | + Marquee locked | + Door Staff locked |
| Lean Night | Back Bar locked | + VIP Booths locked | + Tip Rails locked |

- **Data:** `CHALLENGES` entries gain `tiers: [{ mod, desc }]` — `tiers[0]` is
  tier 2, `tiers[1]` tier 3; tier 1 stays the table's `mod`. Mods are
  self-contained per tier (a tier 2 mod repeats tier 1's constraints plus the
  tighter one). `challengeTierMod(def, tier)` resolves them.
- **Rewards scale ×tier:** `challengeBonus(g)` reads the completed-tier map —
  `reward × tier` per challenge — so Tight Till tier 3 grants +15% all cash
  (0.05 × 3), Slim Margins tier 3 +3 Door Staff cap, crew tiers +15% output.
- **State:** `g.challengeTier` (the ACTIVE run's tier, 1–3 — persists across a
  mid-challenge reload) + `g.challengeTiers` (map `id → highest tier done`).
  Both additive, fail-closed in `sanitizeG`/`completeImportedG`. **SAVE_VER
  bumped to 12** (`MIGRATIONS[11]` no-clobber; **backfill**: a challenge in
  `challengesDone` without a tier record counts as tier 1, so pre-tier saves
  keep their rewards).
- **Sequential gating:** `startChallenge` starts `highestDone + 1` (1 when
  fresh, capped at 3); a completed challenge can only be re-run at a HIGHER
  tier. `challengeNextTier(g, def)` = 0 when maxed (card reads "Maxed").
- **Lifecycle:** completing tier N records N in `challengeTiers` (and keeps
  `challengesDone` for compat); prestige and challenge starts preserve earned
  tiers; **the franchise sale wipes them** (challenges re-lock, consistent
  with `challengesDone` §8.4). The active tier's modifier routes through the
  same `challengeMod` composition point (incomeMult → `totalCashMult`,
  locked → `buyBuilding`/`autoBuyManagers`/card).

**Non-goals:** no Clout/Legacy rewards; no timed real-world challenges (all
in-game-clock); challenges are opt-in, so the pacing bands are untouched.

## 21. Upgradeable managers (`g.managerLevels`) — shipped 0.11.8

Automation as a progression (REPLAY_ROADMAP.md §7). Managers stay a binary hire
in `g.managers`; an additive `g.managerLevels` map (`buildingId → 0–3`) scales
how many buildings each manager auto-buys per tick in `autoBuyManagers()`:

| Level | Quantity per tick | Cost to reach (Legacy) |
|------:|-------------------|------------------------|
| 0 (hired) | 1 | — |
| 1 | 1 | 10 |
| 2 | 5 | 20 |
| 3 | max affordable | 30 |

- **`buyManagerLevel(def)`** — Legacy purchase from the Perks panel; requires
  the manager hired, caps at 3, `managerLevelCost = 10 × (level + 1)`.
- **`autoBuyManagers`** reads the level for the per-tick quantity cap
  (`1 / 5 / Infinity`); `managerPaused` and challenge locks apply at every
  level. Level ≥ 2 logs one line per fire ("×N") instead of one per building.
- **Ordinary prestige preserves levels** — `confirmPrestige` snapshots and
  restores `g.managerLevels` alongside the manager/pause whitelist; only the
  PR 6 franchise sale wipes them.
- **State:** additive map, fail-closed in sanitize/import (unknown ids → 0,
  clamped to 0–3). `SAVE_VER` stays 9.

**Non-goals:** no auto-prestige, no auto-assign-crew, no auto-buy-rounds.

## 22. Renown unlocks (`BRAND_PERKS`, `LOCATION_EXTRAS`, rooftop) — shipped 0.11.10

Renown from selling the franchise (§9.2) becomes a spendable sink
(REPLAY_ROADMAP.md §9): brand perks bought with Renown, a third club, and
per-location content.

### 22.1 Brand perks (`BRAND_PERKS`)

Data table mirroring `PRESTIGE_PERKS` — `{ id, name, cost, max, desc, req? }`.
Each rank costs the table cost again (flat, not scaling). Ranks live in the
account-level `g.brand` map (`brandRank(g, id)`, fail-closed to 0), bought via
`buyBrandPerk`, and **persist through the franchise sale** — they are the
reason to sell again. Ordinary prestige also preserves them (`confirmPrestige`
snapshots brand and restores it BEFORE `applyStartPerks`, so Loyalty seeds the
new run's regulars), and so does a challenge start (`startChallenge` snapshots
the brand map like the managers — a challenge run must not wipe
Renown-purchased perks; Loyalty seeds the challenge run's regulars the same
way).

| Perk | Cost (Renown) | Max | Effect per rank |
|------|--------------:|----:|-----------------|
| Nationwide Reach | 5 | 3 | All cash income +10% (folded into `totalCashMult`) |
| Loyalty Program | 4 | 3 | Start each run with +1 Regular |
| R&D Lab | 4 | 3 | Research costs −10% (via `researchCost`, floored at 1 Clout) |
| Night Owl Network | 3 | 3 | Offline progress +10% (multiplies the catch-up rate) |
| Rooftop Lease | 10 | 1 | Unlocks the Rooftop — a third location |

Effects are account-wide. `researchCost(g, def)` is the single source for both
the buy action and the card; `nationwide` routes through `totalCashMult(g)` so
passive income AND clicks/whale/golden all scale.

### 22.2 Third club — the Rooftop

`Rooftop Lease` rank ≥ 1 opens `canOpenRooftop()`; `confirmOpenRooftop()` creates
`g.clubs.rooftop` via `freshClubState('rooftop')` — the same account-level
unlock pattern as the annex (§17). No new save shape beyond PR 6. The club
switcher gains a third entry and the Ledger labels the active room.

### 22.3 Location extras (`LOCATION_EXTRAS`)

Each club id has a small set of **location-specific buildings/upgrades**
appended to the shared catalog (supersedes SECOND_LOCATION.md §11's
"no location-specific buildings" non-goal):

| Location | Buildings | Upgrades |
|----------|-----------|----------|
| `main` | Neon Pool (+$0.60/s, +6 patron cap) | — |
| `annex` | Rooftop Bar (+$0.90/s, +8 patron cap) | Skyline View (×1.25 all cash, req Rooftop Bar ×2) |
| `rooftop` | Helipad Lounge (+$1.50/s, +12 patron cap) | Panorama Deck (×1.40 hype, req Helipad ×2) |

Extras are additive: the shared `BUILDINGS`/`UPGRADES` catalogs still apply
everywhere, and `locationExtras(loc)` / `extraBuildings(loc)` /
`extraUpgrades(loc)` append per club. `freshClubState(loc)` initializes each
location's extra ids; `sanitizeG` / `completeImportedG` backfill them for
existing saves. Every extras read is `|| 0` / `=== true` fail-safe: a club
missing an extra id prices it as 0 owned — the NaN-price infinite loop in
`buildingMaxAffordable`/`buyBuilding` (NaN < cash is false, so the buy loop
never broke) is fixed by this.

### 22.4 Brand Endorsement — the repeatable Renown sink (0.11.12)

The five Brand perks are a finite sink (~58 Renown maxes them in ~5 sales).
**Brand Endorsement** is the repeatable one: +2% all cash per level, forever,
at an escalating cost — `endorsementCost(g) = floor(15 × 1.35^level)` (15, 20,
27, 37, 50, 67…). Each sale's Renown always has a spend target, so the sell
loop keeps its reason to reset; the 1.35 cost growth outpaces the linear +2%,
so the sink never needs a cap.

- Level lives in the account-level `g.brandLevel` (additive integer ≥ 0,
  fail-closed in `sanitizeG`/`completeImportedG`, default 0 in `fresh()`).
  **SAVE_VER bumped to 11** for the new persisted field (repo convention,
  PR 6 precedent) — `MIGRATIONS[10]` defaults `brandLevel` to 0 for v10
  saves, no-clobber.
- The multiplier folds into `totalCashMult(g)` — passive AND
  clicks/whale/golden — via `(1 + 0.02 × brandLevel(g))`.
- **Persists through every reset, like brand ranks** (the PR #77 lesson:
  every reset-style action carries its own snapshot list — `confirmPrestige`,
  `startChallenge`, and `confirmFranchiseSale` all snapshot and restore
  `brandLevel` alongside `brand`).
- UI: a Brand Endorsement card under the five Brand perks in the Perks panel,
  always visible — "N Renown short" is itself a goal line before the first
  sale. Renders `owned` as `N levels`, button shows the next cost.
- The pacing bot never buys it (`buyAllMeta` untouched), so every main-run
  band stays bit-identical; `renownRun()` is unchanged.

**Non-goals:** still max 3 clubs; no cross-club cash transfer; no per-club
research; brand perks and the endorsement are Renown-only (no conversion
from/to Clout/Legacy — the endorsement is a permanent multiplier, never a
Renown → cash exchange).

## 23. Endgame horizon — Vision lifetime-value ladder (next-roadmap PR 4, 0.11.15)

The old goal line — **3 clubs + $1e12 net worth** (0.11.11) — was probe-measured
~3.6 sim-years of play past a decked account, i.e. unreachable as a design
target. **PR 4 retargets the Vision to a cumulative lifetime-value ladder** that
the post-§9 loop can actually reach, with a real payoff per rung:

- **`g.lifetimeEarned`** — a monotonic account-level accumulator of **gross
  cash earned across all time** (net cash + wages per sim slice — the
  away-report semantics, so a wage drain can't hide behind net). Credited
  exactly once per slice in `step()` and once per slice in `catchUp()`
  (offline accrues at its scaled rate — offline is first-class). Survives
  every reset: prestige, challenge starts, and the franchise sale — lifetime
  is the brand's cumulative footprint, not run state. **SAVE_VER bumped to
  13** — `MIGRATIONS[12]` defaults it to 0 (no-clobber) for v12 saves; history
  cannot be reconstructed, so the ladder starts measuring from the migration.
  Fail-closed everywhere: missing/malformed reads as 0 (tiers stay locked,
  never NaN).
- **`VISION_TIERS`** — `$10M / $100M / $1B` gross earned. Each tier crossed
  grants a permanent all-cash bonus (`+1% / +1% / +2%`, **+4% total** at the
  top), folded into `totalCashMult(g)` at the single composition point. The
  bonus is **derived** from `lifetimeEarned` on every read (`visionBonus(g)`) —
  no per-tier state to save, migrate, or restore, so a tier can never re-fire,
  and the accumulator is monotonic so a bonus can never un-grant.
- **Surfaced as the "Vision — the long game" block** under the active goal in
  the Owner's List (renderVals `horizon`): `Lifetime value $X / $1B`, three
  star markers (crossed = gold), `next ★ at $Y (+N% all cash)`, and a progress
  bar against the top target. Readout only — every value is derived at render
  time.
- **Bonus is cash%, not Renown** — a Renown grant on crossing would cannibalize
  the sale loop (the spine). Documented rejection.
- **Pacing-neutral by construction, probe-pinned**: `pacing.mjs` gains
  `endgameProbe()`, which plays the plain reference bot for the FULL 8h wall
  cap and asserts its lifetime earned stays **strictly below ★1 ($10M)** — so
  `visionBonus(g)` is exactly 0 on every bot path (the prestige-loop bound is
  asserted separately inside `renownRun()`) and every band is bit-identical to
  the 0.11.14 reference. The sim-loop FP-residue guard cannot shift those
  bands: `simulate()` drives `step(1)` (whole SIM steps), and the clamped
  phantom slice would accrue income at ~1.4e-16s of time — below sim
  resolution and far below the probes' measurement noise (verified
  empirically by the passing gates).

**Pacing guard (same-achievements control, §10):** `renownRun()` in
`pacing.mjs` now proves the third club's location content is not dead weight on
an account with preserved achievements. After the §8/§9 assertions (sale →
reset shape → lease → rooftop → extras verified live via `rates()` toggles),
it snapshots the post-sale account and measures the rooftop's first LED twice:
once played by the standard bot (extras are not in the shared catalog, so it
never buys them — the control) and once with Helipad Lounge + Panorama Deck
seeded (the player bought them). The extras run must win by **at least 15%**
(`t3Extras < t3Control * 0.85` — the run is deterministic, so a plain strict
`<` would pass a regression that merely narrows the advantage). A
no-achievement fresh control would pass on achievement carryover alone, which
is exactly the comparison §10 forbids.

**Mid-band anchor (post-polish PR 7):** `pacing.mjs` gains
`midBandRun()`, which closes the §1.3 dead zone (all-research ~105m → first
franchise sale ~312m) at its far edge. The bot plays the prestige loop to the
franchise gate, sells for the first Renown, and buys the first Brand perk (the
first Renown-sink event — `offline`, 3 Renown). The milestone is pinned at the
reference first sale (**311.70m**, ±5% → 296.12m–327.29m): the first Brand perk
is bought the instant Renown exists, so its time is the gate time. The bot's
standard per-second policy never buys Brand perks or Endorsements, so the
explicit purchase cannot shift the other scenarios' bands; the five existing
scenarios stay bit-identical.

## Doc maintenance

- Rewrite claims against `game.js`, not against stale plans.  
- Keep Owner's List UI copy aligned with formulas when both change in the same PR (rail goal `why` matches tip rate +$0.06/s). Do not silent-fix economy numbers to match stale copy.  
- After any balance PR: re-check §4–§8 tables and run `pacing.mjs`.  
- Save-path order is load-bearing: import is log → persist → replace (§13.3); load offline is claim → conditional catch-up → post-catch-up write (§13.6); prestige must match import's persist-before-replace rule (§9).

**End of DESIGN.md**
