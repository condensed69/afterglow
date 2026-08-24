## Summary

- cap the OpenCode Go primary review step at 15 minutes so a stalled provider
  call can reach the existing fallback;
- cap the fallback at 15 minutes as well;
- replace the intermittently rate-limited GLM fallback with the currently
  catalogued, live-tested `openrouter/poolside/laguna-s-2.1:free` model.

The repository Actions copies of `OPENCODE_GO_API_KEY` and
`OPENROUTER_API_KEY` were also refreshed through GitHub's encrypted secret
store after both canonical credentials passed their provider checks. No secret
value is present in this branch.

## Why

PR #109's first two `/oc review` attempts failed immediately because the
repository secrets predated the current provider credentials. After refreshing
them, the primary authenticated successfully but remained in the Qwen step for
more than 25 minutes; recent successful primary reviews completed in at most
11m12s. The old fallback had also recently failed under an upstream free-tier
rate limit. This change bounds both paths and uses a fallback that completed a
live OpenCode inference before selection.

## Verification

- `git diff --check` — pass
- `node --check game.js` — pass
- `node economy.test.mjs` — 307 passed, 0 skipped, 0 failed
- `node pacing.mjs --fast` — pass; all baseline, prestige, and second-room
  milestones within band
- live OpenCode fallback probe — `openrouter/poolside/laguna-s-2.1:free`
  returned the exact requested response
- full `node pacing.mjs` — baseline, prestige, and second-room scenarios passed;
  the unchanged renown full-cap scenario hit its existing 5-minute local
  wall-clock budget at 235.85m simulated. CI intentionally uses `--fast` and
  skips renown, mid-band, and endgame full-cap scenarios.

## Documentation and save compatibility

- Documentation touched: this durable PR record only.
- `SAVE_VER` unchanged: this is a GitHub Actions workflow repair and does not
  alter game behavior or persisted state.
