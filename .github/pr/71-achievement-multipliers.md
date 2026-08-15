## feat: achievement milk multiplier (+1% cash per achievement)

PR 1 of the replay/deepening roadmap (`REPLAY_ROADMAP.md` §3). Makes the 38
existing achievements a real progression path instead of a checklist.

### What this adds

`achievementMult(g)` — a Cookie-Clicker-style "milk" multiplier:

```js
achievementMult(g) {
  return 1 + 0.01 * (g.achievements ? g.achievements.length : 0);
}
```

- Applied to **passive** cash income in `rates()` (folded into `houseCut` alongside
  the existing House cut perk) and **active** clicks in `workCrowd()`.
- At the full 38 achievements that is **+38%** — meaningful, not broken.
- **Derived from `g.achievements.length`** — no save-shape change, no `SAVE_VER`
  bump. Existing saves are unaffected; the multiplier is computed live.

### Pacing re-baseline (required by the doc §3)

The pacing bot earns achievements deterministically as it plays, so the multiplier
grows during a run and shifts the late milestones. Re-measured the full milestone
table (deterministic — the special-shift roll is `_live`-gated, so `pacing.mjs` is
bit-identical across runs):

| Milestone | Before | After | Band |
|-----------|--------|-------|------|
| First building (rail) | 1.53m | 1.53m | 1.50–2.50m |
| First crew | 7.70m | 7.70m | 3.75–10.00m |
| 10 patrons | 5.70m | 5.70m | 4.50–7.50m |
| First upgrade (LED) | 14.67m | 14.35m | 8.40–23.40m |
| First research | 20.63m | 19.85m | 17.50–32.50m |
| All upgrades owned | 39.97m | **32.00m** | **22.40–41.60m** |

Only "All upgrades owned" shifted materially (~20% faster — the intended effect of
achievements mattering). Its band is re-centered from `~45 min ±30%` to
`~32 min ±30%` in `pacing.mjs`. Early milestones are untouched (no achievements
earned yet); "first research" and "first upgrade" moved <4% and stay well inside
their bands.

### Docs touched

| File | Change |
|------|--------|
| `game.js` | `achievementMult()` + wiring into `rates()`/`workCrowd()`; `VERSION` 0.11.4 / build 217; `CHANGELOG` entry. |
| `economy.test.mjs` | 2 tests: `achievementMult` = 1.00 @ 0 / 1.38 @ 38, and `rates().cash` scales by the multiplier. |
| `pacing.mjs` | "All upgrades owned" band re-centered ~45m → ~32m. |
| `DESIGN.md` | §4.2 (shared multipliers), §8.1 (Work the room click), §12 (milk multiplier note). |

### Verification gates

| Gate | Result |
|------|--------|
| `node --check game.js` | pass |
| `node economy.test.mjs` | 232 passed, 0 failed |
| `node pacing.mjs` | all milestones within band; prestige + second-room scenarios pass |

### Version / save format

- `SAVE_VER` **does not move** — stays **9** (the multiplier is derived, not stored).
- `VERSION` 0.11.3 → **0.11.4**, build 216 → **217**; `CHANGELOG` gains the 0.11.4
  entry (behavior change, so they advance together per AGENTS.md).
