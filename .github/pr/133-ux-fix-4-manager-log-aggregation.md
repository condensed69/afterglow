# #133 · YELLOW-5 — Manager log aggregation: one Night Log line per tick

**Branch:** `ux/fix-4-manager-log-aggregation` → `main`  
**Version:** 0.11.32 / build 245 · **SAVE_VER 13** (unchanged) · **Style freeze: no** (JS log wording only)  
**Ticket:** YELLOW-5 (uxFindings v0.11.28)

## What

`autoBuyManagers()` no longer floods the 40-entry Night Log with one line per manager per 0.1 s tick. Purchases now aggregate to **one** consolidated line per call:

> `Managers built N buildings for $X.`

Buy math is byte-identical — only the `opts.log` path changed. The pacing bot never passes `log` (live `step()` only), so all five pacing bands stay bit-identical. No new save fields, no cap/rate changes.

**Before:** `if (here>0 && log) push('Manager built <name> ×N for $Y')` inside the per-manager loop → N lines per tick when N manager types fire.  
**After:** `bought` + `totalSpent` accumulate across the loop; **one** `push()` after the loop when `bought>0 && log`.

## Why

The Night Log is the player's only feed of what happened — goals, achievements, the away report, shift/night lines — and it caps at 40 entries. At one `log:true` tick every 0.1 s, a single Lv2 manager buying 5 buildings per tick pushed 300 lines/minute, evicting everything else. The bankroll conversion itself is balance (out of scope); the actionable half is the log noise.

Offline catch-up (`catchUp()`) never passed `log:true` (it accumulates `managerBought` for the away message instead), so the consolidated line is exactly what a 1 h catch-up would surface via the live path — one line, not sixty.

## How tested

- `node --check game.js` · `node economy.test.mjs` (320 passed, this PR adds 3) · `node pacing.mjs` (full 5-scenario, not `--fast`) — all green, bands quoted below.
- New tests in `economy.test.mjs`:
  - `autoBuyManagers aggregates to one Night Log line per call when log:true` — Lv2 manager (level 2 → qtyCap 5) with $99 999 buys >1 buildings, asserts `g.log.length` delta is exactly 1 and message matches `/Managers built \d+ buildings for \$/`, not `/Manager built /`.
  - `two managers still one line, paused manager adds no line` — hires rail+bar, verifies still 1 line; pauses bar and verifies the next aggregated call is still 1 line from the unpaused manager.
  - `paused manager produces no line when nothing bought` — paused-only hire with `log:true` → delta 0.
- Pacing: run locally, bit-identical to baseline `0.11.31/244`.

```
(all five pacing scenarios PASS — first building 1.53m, 10 patrons 5.70m, first crew 7.70m,
 first upgrade 14.35m, first research 19.85m, all upgrades 32.00m, all research 105.18m,
 mid-band first brand perk 311.70m, endgame 5.45M / 54.5% of ★1 — identical to main)
```
*(runner: `node pacing.mjs`; no `--fast` — 5 scenarios including renownRun + endgameProbe)*

## Risk

Low. One `push()` site, counted string, behind the existing `opts.log` guard. The `totalSpent` accumulator formats once via `this.fmt()` (no per-manager formatting, no new branches in the price loop). Strike/cap/challenge-lock gates unchanged.

## Docs

`DESIGN.md` does not quote the Night Log wording (grep `manager|Night Log` — entries describe the manager system, not the log string), so no doc edit. `CHANGELOG` advanced in `game.js`.

## Gates

| Gate | Command | Result |
|------|---------|--------|
| syntax | `node --check game.js` | pass |
| economy | `node economy.test.mjs` | 320 passed |
| pacing | `node pacing.mjs` | all 5 PASS, bit-identical |

## SAVE_VER

13 — no persisted field added. `opts.log` is a transient caller flag.

## Checklist

- [x] `VERSION` 0.11.32 / build 245 + `CHANGELOG` entry
- [x] Economy math untouched (price loop byte-identical, `totalSpent` only for the message)
- [x] Tests co-shipped (same commit)
- [x] Docs grepped (`DESIGN.md` — no log-wiring lift)
- [x] Full `pacing.mjs` run, bands quoted
