🎯 **What:** Extract the save-version decision from `init()` into `tryMigrateSave(p)`. The helper returns the loaded game state plus explicit `upgraded` and `wiped` flags; `init()` keeps ownership of parsing, timestamps, persistence, offline catch-up, and player messaging.

💡 **Why:** The migration branches were deeply nested inside `init()`. Naming that decision makes the load path easier to read without changing save behavior.

✅ **Verification:**
- `node --check game.js` (pass)
- `node economy.test.mjs` (pass)
- `node pacing.mjs` (pass)
- Docs files touched: `.github/pr/158-code-health-try-migrate-save.md` only; no player or system documentation changes are needed for this internal refactor.
- `SAVE_VER` unchanged at 13 because the persisted save shape is unchanged.
- `VERSION` and `CHANGELOG` unchanged because this is a behavior-preserving refactor.

✨ **Result:** `init()` has a flatter save-loading path while preserving current-save loading, chained migration, failed-migration wipe, malformed/future-save handling, and exception behavior.
