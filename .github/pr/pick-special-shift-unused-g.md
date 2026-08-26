# 🧹 remove unused parameter g from pickSpecialShift

## Summary
- 🎯 **What:** Removed unused parameter `g` from `pickSpecialShift()` method signature and comments in `game.js`, and updated its call sites in `game.js` and `economy.test.mjs`.
- 💡 **Why:** `g` was an unused parameter and explicitly commented as such. Removing it cleans up dead code and signature debt.
- ✅ **Verification:** Passed `node --check game.js`, `node economy.test.mjs`, and `node pacing.mjs`.
- ✨ **Result:** Improved maintainability and cleanliness without changing any behavior or save formats.
