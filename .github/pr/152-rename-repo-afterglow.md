## Summary
GitHub repo renamed `stripper-dance` → `afterglow` (same repo id). Update the three files that still named the old slug.

- `README.md` heading
- `github.md` `repo:` line (Jules/agent brief)
- `DESIGN.md` repo attribution

No game logic, version, or save-format change. No `VERSION`/`SAVE_VER` bump.

## Gates
Docs-only. `node --check game.js` PASS, `node economy.test.mjs` 323 passed, `node pacing.mjs --fast` PASS.
