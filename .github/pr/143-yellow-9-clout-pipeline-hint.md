## Summary

YELLOW-9 — the cold-start Clout pipeline is a dead end for a fresh save. The
Ledger's Regulars row notes `unlock Reputation Loop` when a player has fewer
than 5 regulars, and any Clout-short Research row shows *only* that it is short
— but nothing on screen says where Clout comes from or what makes a Regular, so
a new player staring at a locked Research tab has no path to it. Regulars come
from Tip Rails and VIP Booths; Clout accrues from Regulars. Neither fact was
stated anywhere in the UI.

Chose option (b) from the plan (in-place hints, no new state): two render-layer
copy replacements name the pipeline where the dead ends actually appear.

| Surface | Was | Now |
|---|---|---|
| Ledger Regulars note (no regulars yet) | `unlock Reputation Loop` | `made by Tip Rails + VIP Booths` |
| Research tab hint | `Research is paid in Clout, which accrues slowly from Regulars. Permanent, global effects.` | `Research is paid in Clout. Clout comes from Regulars. Regulars are made at Tip Rails and VIP Booths. Permanent, global effects.` |

`regularName(g,c)` (game.js:960) returns `null` under 5 regulars, which is
exactly what makes the old Ledger note the first-run dead end — verified in the
fresh-save path before editing. Grep confirmed neither old string nor a stale
pipeline description survives in `DESIGN.md` / `PLAN.md` / `PRESTIGE.md` /
`README.md`.

## Approach

Render-layer copy only: two string replacements in `game.js` (plus the
`VERSION`/`CHANGELOG` bump). No state, no save shape, no balance, no pacing
paths touched — the pacing bot never sees these strings.

## Verification

- `node --check game.js` PASS
- `node economy.test.mjs` → **323 passed, 0 skipped, 0 failed**, exit 0
- `node pacing.mjs --fast` → exit 0, all 7 milestones in band on the main run,
  prestige scenario (run2 first LED faster), second-room scenario (annex first
  LED faster) — copy-only change, bands bit-identical
- Edit applied with per-string uniqueness assertions; `git diff` shows exactly
  the two copy lines + version/changelog lines

## Save version

**Unchanged (SAVE_VER 13).** `VERSION` advanced 0.11.39 → 0.11.40 / build 253
with a matching `CHANGELOG` top entry.

## Docs updated

- `DESIGN.md` — §1 **Spec target** advanced `through 0.11.38` → `through
  0.11.40` (0.11.39's scroll-render-defer fix from #142 was never reflected in
  the target line; this is the honest sweep term for both).

## Files

- `game.js` — Ledger Regulars note + Research tab copy, VERSION, CHANGELOG
- `DESIGN.md` — §1 spec target
- `.github/pr/143-yellow-9-clout-pipeline-hint.md` — this body