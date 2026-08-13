## Balance: first research ~22m, all upgrades ~46m — two cost knobs

### The problem

Baseline audit (v0.10.17, `pacing.mjs` reference bot, 6 runs) against the design intents documented in `pacing.mjs` and the `game.js` rates comment ("Regulars / Clout paced for first-research ~25 min"):

| Milestone | Design intent | Baseline (mean of 6) | Gap |
|---|---|---|---|
| First research | ~25 min | **18.40m** | −25%, runs clipped the band floor (min 17.90 vs 17.50) |
| All upgrades | ~45 min | **34.15m** | −24%, lower third of band |
| First upgrade | 12–18 min | 14.84m | fine (center) |
| First crew | 5–8 min | 7.88m | fine |
| Prestige accel | run2 faster | delta −2.07m | fine |

Everything else passed its heuristic: cost growth 1.16–1.28, offline 50%/65%, prestige ratio ~0.85 (0.7–0.9 target).

### The fix (smallest knobs, cost over rate)

1. **Reputation Loop 8 → 12 Clout.** The first-research gate was undercut by front-loaded one-time Clout (achievement + goal rewards accumulate ~6 Clout before the first purchase), so the passive `regulars × 0.0011/s` rate never governed the timing. Raising the entry research cost restores the intended ~25m gate. (Changelog precedent: loop went 6→8 in 0.6.1 for the same reason — research kept running below the band floor.)

2. **Weekly Residency 5800 → 8000.** The pacing bot buys upgrades cheapest-first, so Residency is the last upgrade purchased and anchors "all upgrades owned". At 8000 it is ~12× a Dressing Room — inside the 10–100× tier-upgrade heuristic (was 9×), and the chain's multiplicative steps stay consistent (1700 → 3800 → 8000 ≈ 2.2×, 2.1×). Bottle Service stays 3800 — it doesn't gate any measured milestone, and changing it would stretch the mid-game cliff.

### Verification — `pacing.mjs`, 6 baseline vs 11 tuned runs

| Milestone | Baseline range | Tuned range | Band |
|---|---|---|---|
| First building | 1.52–1.57m | 1.52m | 1.50–2.50m PASS |
| First crew | 7.53–8.20m | 7.80–8.25m | 3.75–10.00m PASS |
| 10 patrons | 5.68–5.73m | 5.70–5.75m | 4.50–7.50m PASS |
| First upgrade | 14.62–15.05m | 14.73–16.32m | 8.40–23.40m PASS |
| First research | 17.90–19.05m | **21.63–23.07m** | 17.50–32.50m PASS |
| All upgrades | 32.78–35.67m | **43.92–52.30m** | 31.50–58.50m PASS |
| Prestige delta | −1.78 to −2.55m | −1.07 to −2.95m | < 0 PASS (run2 faster every run) |

The bot path is RNG-driven (special-shift rolls), so the report shows run distributions, not single runs. Both outliers now sit on their design intents; the early-game beats (rail, patrons) are untouched.

### Gates

- `node --check game.js` ✅
- `node economy.test.mjs` ✅ (209 passed, 1 skipped, 0 failed — includes new "pacing anchors" pin test: loop stays the cheapest research, residency the most expensive upgrade, so the milestone bottlenecks can't silently move)
- `node pacing.mjs` ✅ (all milestones within band, 11/11 runs; prestige scenario passed every run)

### Docs touched

- `DESIGN.md` §5.2 upgrades table (residency 5800 → 8000) and §5.3 research table (loop 8 → 12)
- `CHANGELOG` entry for `0.10.18`; `VERSION` → 0.10.18 / build 209
- `PRESTIGE.md` untouched — no perk/reset behavior changed
- `pacing.mjs` untouched — bands are the contract and did not move

### SAVE_VER

- Unchanged (8) — cost constants only, no save shape change
