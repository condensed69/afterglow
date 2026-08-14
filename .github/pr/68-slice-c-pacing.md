# Second-room pacing scenario + Second Location completion (Slice C)

The final slice of the Second Location plan: a reference-bot proof that **account progress carries into the fresh second room**. The feature itself (annex gate, switcher, crew rebalance, ledger label) shipped in 0.11.1; this PR proves the economy supports the design's core claim and marks the plan complete.

## What changed

- **`pacing.mjs` `secondRoomRun()`** — new third scenario beside the milestone bands and the prestige scenario:
  1. Run 1: fresh bot, no perks → **t1 = first LED** (the no-account-progress baseline, 14.67m), then plays to the prestige gate.
  2. Prestige 1 → cash10 rank 1; run 2 in main (faster with the perk) → prestige 2 → **cash10 rank 2** (asserted `perk === 2`) **+ rail manager** (10 Legacy — the gate's manager requirement).
  3. **Seed research** after the final prestige (which resets `g.r` via `fresh()`): buy the two cheapest research items, verify ≥2 seeded.
  4. Gate check (`canOpenRoom()`), `confirmOpenRoom()`, `setActiveClub('annex')` — assert `activeClub === 'annex'` and ≥2 research items persist after the switch.
  5. Run 3: the same bot plays the annex → **t2 = first LED** (11.22m, **delta −3.45m**).
  6. **Assert t2 < t1**, fail loudly with a named cause if any step breaks (gate unreachable, manager unaffordable, annex not created, switch not verified, research not preserved, perk purchase not confirmed).
- **Measurement note (documented in the scenario, SECOND_LOCATION.md, DESIGN.md):** the rail manager is **paused** for run 3. Managers auto-buy unbounded on their building (rail has no `max`), so an active manager redirects the shared till and the run would measure the manager's spend pattern (rail 8 by first LED), not whether account progress makes the fresh room faster. Probe: unpaused manager → delta **+0.25m**; paused → **−3.45m**. Delegation is exercised in live play; the scenario isolates the carry-over.
- Docs: SECOND_LOCATION.md (status → shipped, §13 checklist [x]), DESIGN.md §17 pacing-guard bullet, PLAN.md Deferred → shipped. VERSION 0.11.2 / build 215 + CHANGELOG (no gameplay change).

## Gates (run on `db2a27e`)

- `node --check game.js` — pass
- `node economy.test.mjs` — **228 passed, 0 failed** (unchanged — no game.js behavior change beyond version)
- `node pacing.mjs` — **all 3 sections pass**: milestone bands in range; prestige delta **−1.87m** (bit-identical); second-room delta **−3.45m** (annex first LED 11.22m < fresh 14.67m, 2 research items seeded post-prestige); re-run 3× for RNG variance — all green

## Docs

- `SECOND_LOCATION.md` — status/scope header, §10 scenario reconciled with implementation (seeded research, switch assertion, reporting format), §13 checklist (Slice C [x], remaining items are v1 non-goals)
- `DESIGN.md` — §17 pacing-guard bullet
- `PLAN.md` — Deferred: Second location **shipped**
- `game.js` — VERSION 0.11.2 / build 215, CHANGELOG entry

## SAVE_VER

**Unchanged (9)** — harness-only change; no save-shape impact.
