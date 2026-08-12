# Handoff — Afterglow

**Repo:** `condensed69/stripper-dance` | **/opt/data/stripper-dance** | **main: `2a06d1e`** (v0.10.4/195)

## Ship code
- `/opt/data/.git-helpers/new-pr.sh "title" [body] [base]`
- Force-push: `--force-with-lease=<branch>:<sha>` (bare `--force-with-lease` fails — single-branch clone)
- Review comments: `curl /issues/<n>/comments` (MCP tools return `[]`)
- `.pr-body.md` is gitignored

## Gates
`node --check game.js && node economy.test.mjs && node pacing.mjs` — 191/191 tests, all milestones PASS. VERSION+build+CHANGELOG together. SAVE_VER=8.

## Complete (all merged)
5→docs refresh, 6→responsive, 7→achievements 38, 8→critic+golden, 9→cash10 balance, 10→render throttle, 41→throttle test follow-up

## Next: Phase 11 — second location
Design doc `SECOND_LOCATION.md` **first**, code after. Plan: `.hermes/plans/2026-08-08_023100-rest-of-implementation.md` line 257. Legacy-gated franchise, shared Clout/Legacy/Research, independent cash/buildings per club, SAVE_VER 9 `g.clubs` map, `pacing2.mjs`.

## Pitfalls
- Sequential `game.js` patches silently revert — grep after multi-patch
- Token env name gets redacted in display (`GITH...KEN`) — never paste that into patches
- `git remote set-branches origin --add` accumulates refspecs — dedupe occasionally
