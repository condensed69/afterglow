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

### Verification — pacing.mjs (deterministic, single run)

This PR also fixes pacing determinism (see below): the bot/offline path now draws **zero** randoms, so `pacing.mjs` is bit-identical across runs and one run is the verification.

| Milestone | Hit | Band |
|---|---|---|
| First building | 1.53m | 1.50–2.50m PASS |
| First crew | 7.83m | 3.75–10.00m PASS |
| 10 patrons | 5.70m | 4.50–7.50m PASS |
| First upgrade | 14.67m | 8.40–23.40m PASS |
| First research | 20.63m | 17.50–32.50m PASS |
| All upgrades | 39.97m | 31.50–58.50m PASS |
| Prestige delta | −1.87m | < 0 PASS (run2 faster) |

Side benefit: the cover cascade shifted first research and all upgrades **closer to their ~25m/~45m design intents** than before (the crowd income smooths the mid-game). All bands hold with margin.

### Determinism fix (review finding)

The bot and offline paths were seed-dependent in different ways: the pacing bot's `step()` path rolled **both** whales (ungated in `step()`) and special shifts (ungated in `advanceShift()`), while the offline `catchUp()` loop rolled **special shifts only** — its independent loop calls `advanceShift()` but never the whale block. Both rolls were documented as "live only" but the guard was missing, so milestone times varied run to run (~±2 min on the late milestones) and a "6-run range" was six different random experiments, not a verification. Both rolls are now gated behind `this._live` (the same convention the critic/golden events use), so:

- The pacing bot and offline catch-up never roll whales or specials — `pacing.mjs` is deterministic (two runs, byte-identical output).
- Offline away-time stays on the base 4-shift rotation; whales and specials are live-session texture only (as their docs always claimed).
- The bot-determinism test is tightened from all-miss rolls to a single all-hit roll (`withRandom([0.0], step)`) — if any roll leaked into the bot path it would fire the special/whale and fail the assertions, and a second draw would trip `withRandom`'s overrun throw. The special-shift mechanism tests set `_live = true` explicitly, since that path is now live-only.

### Gates

- `node --check game.js` ✅
- `node economy.test.mjs` ✅ (209 passed, 1 skipped, 0 failed — the old "no uncapped patrons×0.012" regression test is rewritten as "patrons pay door cover scaled by head count, empty room earns nothing"; the strike-alternation test now seeds patrons so cover revenue accumulates while underfunded; the bot-determinism test now spies `Math.random` and asserts **zero draws** in the not-live path, and five special-shift mechanism tests run with `_live = true`)
- `node pacing.mjs` ✅ (all milestones within band, prestige scenario passed; two runs bit-identical)

### Docs touched

- `DESIGN.md` §4.2 — non-crew cash formula + door-cover bullet (supersedes the "uncapped patrons do not pay outside the rail" note); strike-recovery wording "door trickle" → "door take"; §11.1 special shifts and §11.2 whale now document the `_live` gate
- `PLAN.md` §1.6 — amended with the v0.10.19 decision (delete `0.012`, replace flat `0.08` with per-head cover)
- `CHANGELOG` entry for `0.10.19` (two notes: door cover + determinism fix); `VERSION` → 0.10.19 / build 210 (sits above #62's 0.10.18/209)
- `.github/pr/63-patrons-pay-door-cover.md` — this durable body, committed with the branch

### SAVE_VER

- Unchanged (8) — income formula + roll gating only, no save shape change
