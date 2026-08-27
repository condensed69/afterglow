## Summary — escalate: challenge start silently wiped spendable + lifetime Renown

**RED-1 (currency loss).** `startChallenge` snapshots every account-meta field —
`legacy`, `legacyTotal`, `perks`, `prestiges`, `managers`, `managerPaused`,
`managerLevels`, `brand`, `brandLevel`, `challengeTiers`, `lifetimeEarned` — but
**not `renown` / `renownTotal`**. Since `fresh()` builds them as `0`, starting a
challenge zeroed both, silently, on a currency the game promises is permanent:

> "**Renown** is the brand's national footprint — it never wipes." — franchise-sale preview

Downstream, `metaUnlocked` keys on `renownTotal > 0`, so the Perks panel — the
only place with the "End challenge" escape hatch — vanished entirely after a
post-sale challenge start.

### Root cause (same class as the PR #77 brand wipe)

The reset-snapshot sweep: **ordinary prestige had the identical omission** —
`confirmPrestige`'s snapshot also lacked `renown`/`renownTotal`, so any prestige
wiped lifetime Renown too (the monotonic `franchise_5/10` counters, the Perks
reachability gate). Only `confirmFranchiseSale` carried them. Both paths now
snapshot and restore both counters, matching the sale's existing handling.

## Fix

- `startChallenge` snapshot + restore of `renown` / `renownTotal` (restored
  before `applyStartPerks`, same block as the brand/endorsement restores).
- `confirmPrestige` snapshot + restore of the same two fields. Prestige grants
  **Legacy**, not Renown — nothing is added, the counters ride through
  unchanged (the sale keeps its `+gain` grant, untouched).
- No `fresh()` / sanitize change (fields already fail-closed), no migration, no
  new persisted field → **SAVE_VER stays 13**.

## Tests (6 new, economy/save/prestige class)

- `startChallenge` preserves spendable + lifetime Renown (memory + disk).
- Renown survives a mid-challenge reload (`init()` from disk).
- Ordinary prestige preserves spare + lifetime unchanged.
- Franchise-sale → challenge → ordinary-prestige chain: `renownTotal` monotonic,
  spare preserved at every hop.
- Perks stays reachable post-sale after a challenge start (`metaUnlocked` view
  model — Legacy row present in `renderVals().resources`).

## Gates

| Gate | Result |
|------|--------|
| `node --check game.js` | pass |
| `node economy.test.mjs` | **316 passed, 0 failed** (309 baseline @ 4db1a91 + upstream #128/#129 additions + 6 new) |
| `node pacing.mjs` (full five scenarios) | pass — bands byte-identical, see table |

### Pacing bands (baseline @ 4db1a91 ≡ post-fix; the bot never holds Renown outside the sale)

```
Milestone                          Hit          Target            Band  Status
------------------------------------------------------------------------------
First building (rail)            1.53m     ~2 min ±25%     1.50m–2.50m  PASS
First crew                       7.70m    5–8 min ±25%    3.75m–10.00m  PASS
10 patrons                       5.70m     ~6 min ±25%     4.50m–7.50m  PASS
First upgrade (LED)             14.35m  12–18 min ±30%    8.40m–23.40m  PASS
First research                  19.85m    ~25 min ±30%   17.50m–32.50m  PASS
All upgrades owned              32.00m    ~32 min ±30%   22.40m–41.60m  PASS
All research owned             105.18m   ~105 min ±30%  73.50m–136.50m  PASS
------------------------------------------------------------------------------
```
Renown scenario: gate at 311.70m sim / 12 cycles / +14 Renown on sale (2h–8h band) ·
mid-band first brand perk @ 311.70m (296.11–327.29m) · endgame probe lifetime
$5.45M at the 8h cap, vision bonus +0%. Why bit-identical: Renown accrues only
from the sale, and `renownRun()`'s prestige loop always runs at renown 0 — the
restore changes nothing the bot reads (its post-sale asserts `renown === gain`
still hold exactly).

## Docs

Grep of `DESIGN.md` (§20 challenges, §22 renown, §9.2 reset matrix), `PRESTIGE.md`
(§10), `README.md` (Renown section), `REPLAY_ROADMAP.md` (§8.4 persists table):
**no doc text changed** — every doc already promises Renown "never wipes"; the
code now honors that promise. `CHANGELOG` + `VERSION` advanced to **0.11.29 / 242**
(main moved `4db1a91 → 443bb02` with the test-only #128/#129 while this branch was
cut — no version collision; `SAVE_VER` unchanged at 13).