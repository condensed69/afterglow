## Patrons pay the door: per-head cover replaces the flat $0.08 trickle

### The problem

Patrons were decorative past the rail cap. Measured on the mid-game state (2 rails, 4 bars, 3 VIP, all upgrades):

| patrons | cash income |
|---|---|
| 12 | $61.01/s |
| 20–72 | $61.01/s (identical) |

The only patron→cash channel is rail tips, hard-capped at 6/rail, worth $0.72/s vs ~$60/s from buildings (~1.2%). The "door" was a flat $0.08 — an empty room and a packed room took the same door money. Regulars conversion (+0.00045/s/patron) is invisible per head. So filling the floor — the fantasy of the game — paid nothing.

### The fix

**Door cover: `patrons × $0.02/s`**, replacing the flat $0.08 trickle in `nonCrewCash`:

```
before: (0.08 + min(patrons, rail×6) × 0.06 + bar × 0.45) × cashMult × houseCut
after:  (patrons × 0.02 + min(patrons, rail×6) × 0.06 + bar × 0.45) × cashMult × houseCut
```

- **Never flatlines** — every head adds $0.02×cashMult×houseCut; a fuller floor always pays more.
- **No free money** — the cover *replaces* the door; an empty room earns ~nothing (0–4 patrons earn less than before), and the patron cap (built from structures) bounds the early game.
- **Supersedes PLAN §1.6** ("no uncapped patrons×0.012") — that decision rejected a flat per-patron rate stacked *on top of* the door; this cover *replaces* the door trickle instead. Patron tips still flow through the rail only.
- Help-copy updated so the effect is discoverable: "They pay cover at the door ($0.02/head), tip at Tip Rails, and slowly become Regulars."

### Verification — pacing.mjs, 6 runs each

| Milestone | Before (range) | After (range) | Band |
|---|---|---|---|
| First building | 1.52–1.57m | 1.53m | 1.50–2.50m PASS |
| First crew | 7.53–8.20m | 7.53–7.83m | 3.75–10.00m PASS |
| 10 patrons | 5.68–5.73m | 5.67–5.70m | 4.50–7.50m PASS |
| First upgrade | 14.62–15.05m | 14.02–14.62m | 8.40–23.40m PASS |
| First research | 17.90–19.05m | 19.80–20.52m | 17.50–32.50m PASS |
| All upgrades | 32.78–35.67m | 36.62–41.72m | 31.50–58.50m PASS |
| Prestige delta | −1.78 to −2.55m | −1.07 to −3.17m | < 0 PASS (run2 faster every run) |

Side benefit: the cover cascade shifted first research and all upgrades **closer to their ~25m/~45m design intents** than before (the crowd income smooths the mid-game). All bands hold with margin.

### Gates

- `node --check game.js` ✅
- `node economy.test.mjs` ✅ (210 passed, 1 skipped, 0 failed — the old "no uncapped patrons×0.012" regression test is rewritten as "patrons pay door cover scaled by head count, empty room earns nothing"; the strike-alternation test now seeds patrons so cover revenue accumulates while underfunded)
- `node pacing.mjs` ✅ (all milestones within band, prestige scenario passed)

### Docs touched

- `DESIGN.md` §4.2 — non-crew cash formula + door-cover bullet (supersedes the "uncapped patrons do not pay outside the rail" note); strike-recovery wording "door trickle" → "door take"
- `PLAN.md` §1.6 — amended with the v0.10.19 decision (delete `0.012`, replace flat `0.08` with per-head cover)
- `CHANGELOG` entry for `0.10.19`; `VERSION` → 0.10.19 / build 210 (sits above #62's 0.10.18/209)

### SAVE_VER

- Unchanged (8) — income formula only, no save shape change
