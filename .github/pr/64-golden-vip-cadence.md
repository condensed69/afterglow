## Golden-ticket VIP cadence: 0.005 → 0.001 per live tick

### The problem

"Way too many VIPs." The floating "VIP booked the booth" golden-ticket offer spawns at `GOLDEN_CHANCE = 0.005` per live tick. The 0.10.2 changelog called it "rare", but 0.5% per tick at the 10Hz sim is ~3 spawn attempts a minute:

- roll per 0.1s tick: `0.005 × (0.1/0.1) = 0.005` → expected one offer every ~20s
- TTL is 30s, so the VIP badge + "VIP booked the booth" log line are on screen **~60% of a session** at hype > 0 (nearly always after the early game)

The whale (the comparable cash-burst event) runs on a 2–5 min cooldown; the critic is 2% per night. The VIP was 10–100× too frequent for a "rare treat".

### The fix

`GOLDEN_CHANCE 0.005 → 0.001` per live tick → expected one offer per ~2 min (badge up ~30s of every ~2 min ≈ 25% → effectively occasional, still a regular treat). One-line constant change; the slice-time scaling, TTL, one-at-a-time rule, and reward sizes are untouched.

### Verification

- Live-only event (`_live`-gated) — the pacing bot never rolls it, so `pacing.mjs` is unaffected and still bit-identical (rail 1.53m … all upgrades 39.97m, prestige delta −1.87m, all PASS).
- The `maybeGolden scales its roll by chunk` test updated to the new threshold (partial chunk 0.05s → scaled 0.0005, full chunk → 0.001) and still proves the whale-style slice scaling.

### Gates

- `node --check game.js` ✅
- `node economy.test.mjs` ✅ (209 passed, 1 skipped, 0 failed)
- `node pacing.mjs` ✅ (all milestones within band, deterministic)

### Docs touched

- `DESIGN.md` §11.4 — per-slice chance comment now 0.001 with the cadence rationale
- `CHANGELOG` entry for `0.10.20`; `VERSION` → 0.10.20 / build 211 (sits above #63's just-merged 0.10.19/210)

### SAVE_VER

- Unchanged (8) — event rate only, no save shape change
