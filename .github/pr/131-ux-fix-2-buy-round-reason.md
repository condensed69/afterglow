## Summary — RED-2: "Buy a round" explains itself when disabled

A disabled **Buy a round** button was a silent dead zone in two visually
identical states: till short of `roundPrice`, and Room Energy at its hype cap.
A tap landing on a disabled render (the button flips enabled/disabled with
patrons at 10Hz) was a silent no-op. The hype-capped case read as *broken
forever*, not capped, because nothing anywhere said why.

## Fix (render-only, single source untouched)

- **`renderVals()`** derives `roundReason` next to the existing `roundOk`
  (unchanged math — the affordability source of truth stays one):
  - `"Room energy is full"` when `roundGain <= 0` (hype cap) — shown first:
    with money in hand, a full room reads as broken, while a shortfall is
    already visible in the price label itself.
  - `"Need $X more"` when `c.cash < roundPrice` (shortfall via `this.fmt`).
  - `null` when enabled or `tabStale` (same disabled semantics as before).
- **Template**: the disabled button gains `title` + `aria-label` (reason, or
  the label when enabled), and a full-width muted `.round-reason` line renders
  under the button row only while locked. `roundLocked` semantics identical.
- **CSS**: one global class (`.round-reason`, 11px, `#9c86ab`, full-width flex
  child of `.stage-cta`) — palette unchanged, neon untouched.

No `roundPrice` / `roundOk` / `buyRound` logic change; no save shape
(**SAVE_VER stays 13**). Hysteresis on the disable threshold was considered
and deliberately deferred — mechanical affordability states are standard in
the genre, and the visible reason kills the "broken?" read that flicker
amplified; the plan records this as an open question, not a silent omission.

## Tests (1 new, view-model)

- Cash-short → locked, reason contains the exact shortfall.
- Hype-capped (full room energy with cash in hand) → locked, reason is
  "Room energy is full".
- Affordable + headroom → unlocked, no reason.
The existing bound-handler sweep keeps covering the disabled button's
non-invocability; the "templates read the view model" scan covers the new
`title`/reason markup (view-model refs only).

## Gates

| Gate | Result |
|------|--------|
| `node --check game.js` | pass |
| `node economy.test.mjs` | **317 passed, 0 failed** (316 + 1 new) |
| `node pacing.mjs` (full five scenarios) | pass — bands byte-identical (bot reads `roundPrice` directly; render-only change) |

### Pacing bands (bit-identical reference quoted; verified post-fix)

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
Renown scenario: gate 311.70m / 12 cycles / +14 · mid-band 311.70m (296.11–327.29m) ·
endgame $5.45M / vision +0% — all as recorded at CHECKPOINT 0.

## Docs

`README.md` grep (`round`): no controls-section description of button states —
no doc change. `CHANGELOG` + `VERSION` → **0.11.30 / 243** (branch cut from
`1fb5be3` = post-#130 main; no collision). `SAVE_VER` unchanged at 13.