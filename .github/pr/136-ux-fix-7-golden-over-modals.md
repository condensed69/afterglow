# #136 · YELLOW-8 — Golden-ticket badge above modal backdrop

**Branch:** `ux/fix-7-golden-over-modals` → `main`
**Version:** 0.11.35 / build 248 · **SAVE_VER 13** (unchanged)

## What
Golden ticket spawns live regardless of open modals; badge rendered inside stage at `z-index:5` and banner at no z-index, both below modal backdrop `60` → 30s TTL expires unseen. Now: stage badge `5→65` and both `goldenTicketBanner` variants `position:relative; z-index:65` (above modals 60, below Look 70) plus challenge HUD banner at same level so a pending offer stays visible/tappable even with Settings/Perks/Changelog open. Keeps compact non-blocking form.

## Why
Event visibility — rare +10 patrons / +$ cash offer must not silently lapse behind chrome.

## How tested
- `node --check game.js` · `node economy.test.mjs` 323 passed · `node pacing.mjs` 5/5 PASS bit-identical (golden is live-only, bot never drives it; banner is pinned above `shell-grid` so not in scrollable region).
- Manual: open Settings modal while `g.golden` set → banner/badge remains tappable; `takeGoldenCash/Crowd` still guard `tabStale`.

## Risk
Low. 3 inline `z-index` bumps + 1 comment update. No economy, no save, no stacking fight with Look (70) or stage CTA (20).

## Pacing
Bit-identical — live-only + CSS. `node pacing.mjs` quoted: 1.53m / 5.70m / 7.70m / 14.35m / 19.85m / 32m / 105.18m / 311.70m / 5.45M 54.5% ★1.

## Gates
| Gate | Result |
|------|--------|
| `node --check game.js` | pass |
| `node economy.test.mjs` | 323 passed |
| `node pacing.mjs` | all 5 PASS |

## SAVE_VER
13 — `g.golden` / banners are transient UI, never persisted; z-index is presentation.

## Skipped
Alternative fallback (pause spawn while `show*` modal open) — bigger diff, don't ship unless z-index collides with modal chrome. Add when banner fights layout.
