## What

Adds a **Branches** section to `AGENTS.md` making the branch-base rule explicit,
placed near the top since branching is chronologically a contributor's first
action. Commits the `pre-push` and `new-branch.sh` hooks themselves into the
repo at `.githooks/`, instead of only describing hooks that live out-of-band in
the Hermes container — they're now reviewable in this diff and installable by
any clone with `git config core.hooksPath .githooks`.

Docs + tooling only. No game code, no `VERSION`/`CHANGELOG`/`SAVE_VER` movement.

## Why

On 2026-08-12 a branch was cut while still standing on another feature branch
(PR #55). That parent was squash-merged, so the carried commits became
content-duplicates with different SHAs and the PR went `mergeable_state=dirty`.
GitHub does not run `pull_request`-triggered workflows against an unmergeable
PR — it needs a synthetic merge ref to check out and can't build one for a
conflicted PR — so **no gates and no review ran at all.** The work looked
finished and nothing had verified it.

`AGENTS.md` already said "before opening a PR, rebase onto the latest `main`".
Prose alone did not hold. It is now backed by a `pre-push` hook that refuses
any push not rooted on the current `origin/main` and prints the exact repair.
This change is the prose half of that pairing, and — per review on the first
version of this PR — makes the hook itself part of the repo rather than trust
placed in an out-of-band container path.

## Review changes from v1

Two `claude` review passes on this PR (the second one after `docs/branch-base-rule`
was brought current with `main` via a merge commit) flagged:

- Hook/script lived only in the Hermes container, unreviewable and not portable
  to any other contributor. **Fixed** — `.githooks/pre-push` and
  `.githooks/new-branch.sh` are now tracked here, genericized off the
  container's hardcoded `/opt/data` paths.
- "GitHub creates no check runs at all for a conflicted PR" read as an
  unverified anecdote. **Fixed** — reworded to name the actual mechanism
  (`pull_request` workflows need a synthetic merge ref; GitHub can't build one
  against an unmergeable PR), which is documented GitHub Actions behavior, not
  a claim resting on forensics of the original incident's since-superseded
  commits.
- Section placement, at the end of the file, read oddly for something
  chronologically first. **Fixed** — moved above `## Verification gates`.

## Review changes from v2

A third `claude` review pass flagged:

- `pre-push` fails open (allows the push UNCHECKED) if it can't reach
  `origin/main` over ssh or https, undocumented. **Fixed** — the fallback is
  now documented in `AGENTS.md` next to `HERMES_ALLOW_STALE_BASE`, with the
  tradeoff (fail-open, not fail-closed) stated explicitly.
- `timeout` isn't guaranteed to exist; its absence would silently no-op the
  fetch guard. **Fixed** — degrades to running the fetch unwrapped instead of
  skipping it when `timeout` is unavailable.
- The https fallback URL was hardcoded. **Fixed** — derived from
  `git remote get-url origin`.
- `.pr-body.md` at repo root broke this repo's own `.github/pr/<n>-<slug>.md`
  convention. **Fixed** — moved to `.github/pr/56-branch-base-rule.md`, and
  `AGENTS.md`'s Pull requests section now names the convention explicitly
  instead of using `.pr-body.md` as an ambiguous example.
- A markdown line-wrap split "Fail-open" across a hyphen, rendering as
  "Fail- open". **Fixed** — reworded to avoid the hyphen break.
- Noted but not changed (design tradeoffs, not blockers): the DROP/KEEP
  heuristic matches on commit subject text only and could mislabel two
  unrelated commits sharing a subject; `git push --no-verify` bypasses the
  hook entirely and isn't called out; `core.hooksPath` opt-in is honor-system
  with nothing that fails loudly if unset.

## Gates

All three re-run after the merge from `main` and after the `.githooks/` addition:

- `node --check game.js` — pass
- `node economy.test.mjs` — pass (204 passed, 1 skipped, 0 failed)
- `node pacing.mjs` — pass (all milestones + prestige scenario)

## Docs touched

- `AGENTS.md` — `## Branches` section, moved above `## Verification gates`.
- `.githooks/pre-push`, `.githooks/new-branch.sh` — new, tracked hook scripts.

No other doc references branch creation, so no further docs pass was needed.
`DESIGN.md`, `PRESTIGE.md`, `PLAN.md`, `README.md` are unaffected — no constant,
count, or system changed.

## SAVE_VER

Unmoved. No persisted save shape change.

## Follow-up (not in this PR)

The Hermes container's `/opt/data/.git-helpers/` copy still exists separately
and is what's actually wired to the container's git config today. Re-pointing
it at this tracked `.githooks/` copy (`git config core.hooksPath .githooks`
inside the container, then retiring `/opt/data/.git-helpers/`) is a live
infra change on `.210`, out of scope for this docs PR — flagging so it doesn't
get lost.
