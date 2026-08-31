🎯 **What:** The code health issue addressed
Removed the unused parameter `g` in the `pickSpecialShift` method of `game.js`, updated the callsite in `advanceShift` method, and removed the obsolete comment.

💡 **Why:** How this improves maintainability
The unused parameter and comment added confusion. Removing them cleans up the function signature and removes unnecessary complexity without changing behavior.

✅ **Verification:** How you confirmed the change is safe
Ran test harness `economy.test.mjs`, simulation suite `pacing.mjs`, and Node syntax checks. Verified the changes locally, no regressions found, and a `#Correct#` rating received from code review.

✨ **Result:** The improvement achieved
A cleaner and more correct method signature for `pickSpecialShift`.
