## Summary

**PR 1 of Afterglow 2.0 (`AFTERGLOW_2.0_PLAN.md` / `IMPLEMENTATION_PLAN.md`)**:
Introduces a fine-grained, zero-dependency reactive core engine (`src/core/reactive.js`) and refactors the monolithic render loop in `game.js` to eliminate innerHTML root destruction.

### Problem
Previously, the 10Hz game tick performed root-level innerHTML overwrites on every render pass. This caused:
- Destruction of active button elements under pointers during fast clicking.
- Loss of form/button focus and subtle mobile scroll rubber-banding.
- Unnecessary garbage collection churn from repeatedly tearing down the whole DOM tree.

### Solution
1. **Reactive Core Engine (`src/core/reactive.js`)**:
   - Lightweight, zero-dependency reactive primitives: `createSignal`, `createComputed`, `createEffect`, `createStore`, and `batch`.
   - Targeted fine-grained DOM reconciler utilities: `bindText`, `bindAttr`, and `bindKeyedList`.
   - Universal browser and Node.js export compatibility (`window.ReactiveCore`, `globalThis.ReactiveCore`, and CommonJS/UMD).
2. **Fine-Grained DOM Updating (`game.js`)**:
   - Separated template generation (`renderTemplate(v)`, `renderOwnersList(v)`, `renderModals(v)`) from element mutation (`updateDom(v)`).
   - `render()` mounts the UI skeleton once on initial load (`_mounted = true`), and on subsequent ticks performs fine-grained in-place element text and attribute mutations without wiping persistent DOM nodes (`header`, `stage`, `aside`, `buttons`, scrollers).
   - Preserves scroll positions, button pointer event continuity, and touch event boundaries.
3. **Pacing & Save Format Invariants**:
   - Zero gameplay or economy alterations: `SAVE_VER` remains 13.
   - Pacing is bit-identical to baseline across all milestones and scenarios.

## Verification

- `node --check game.js` — PASS (exit 0)
- `node economy.test.mjs` — 329 passed, 0 skipped, 0 failed (including new tests for reactive signals, computeds, effects, stores, batching, and DOM node persistence across ticks)
- `node pacing.mjs --fast` — PASS (all milestones within target band, prestige and second-room scenarios confirmed)
- `node pacing.mjs` — PASS (full milestone and scenario suite bit-identical)

## Save version

`SAVE_VER` stays 13. Version bumped to `0.12.0` (build 256, channel `alpha`, codename `Neon Syndicate`).
