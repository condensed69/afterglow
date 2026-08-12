# Repository instructions

This is a dependency-free static website.

- Do not run `npm install`, add a package manager, or introduce a build step unless the task explicitly requires it.
- Primary files: `index.html`, `style.css`, and `game.js`.
- Review only the changed behavior unless the diff exposes a consequential existing defect.
- Treat balance values as early-stage placeholders unless a task specifically concerns balance.

## Branches

- **Never run `git checkout -b`.** Start every branch with:

  ```sh
  .githooks/new-branch.sh <name>
  ```

  It fetches `origin/main` and cuts the branch from it. It refuses on a dirty
  working tree, and refuses to silently reuse an existing branch name.

- **Why this is mechanical and not a matter of care.** On 2026-08-12 a branch was
  cut while still standing on another feature branch. That parent was then
  squash-merged, so the carried commits became content-duplicates with different
  SHAs, and the PR went `mergeable_state=dirty`. GitHub does not run
  `pull_request`-triggered workflows against an unmergeable PR — it needs a
  synthetic merge ref to check the code out and can't build one — so **no gates
  and no review ran at all.** The work looked finished and nothing had verified
  it. Prose alone ("rebase onto the latest `main`" — see Versioning below) did
  not hold.

- A `pre-push` hook now refuses any push whose branch is not rooted on the current
  `origin/main`. If you see `PUSH REFUSED`, it prints the exact repair — which
  commits to keep, which already landed on `main`, the `checkout -B` and
  `cherry-pick` lines, the gate commands, and the push that follows. **Follow it
  verbatim; do not improvise a fix.** Re-run all three gates afterward: the tree
  changed, so the previous pass is stale.

- **The hooks are tracked in this repo, at `.githooks/`** — reviewable in a diff
  like any other file, not trusted sight-unseen from a container path. They run
  only after a one-time opt-in per clone:

  ```sh
  git config core.hooksPath .githooks
  ```

  The Hermes agent container has this set already. Any other clone (human or
  agent) working on this repo needs to run it once, or the guard is silently
  inert — `git status` won't tell you it's missing.

- `HERMES_ALLOW_STALE_BASE=1` bypasses the `pre-push` hook. Do not use it. It
  exists for a human debugging the hook itself.

- **The hook fails open on network trouble.** If it can't reach `origin/main`
  over ssh or an anonymous https fallback, it prints a warning and allows the
  push unchecked rather than blocking it — a second, undocumented-until-now
  bypass path alongside `HERMES_ALLOW_STALE_BASE`. Flagged in review as the
  same failure mode this hook exists to prevent (a bad base slipping through
  undetected), just reached via a network blip instead of a bad branch. Fail-
  open was kept deliberately — failing closed would block every push whenever
  GitHub is briefly unreachable — but if you see the "allowing push
  UNCHECKED" line, treat it as a signal to verify the base by hand before
  opening the PR, not as a clean pass.

## Verification gates

Run all three before opening or updating a PR. A PR is not ready until they pass.

**CI runs these too, on every PR and every push to `main`** (`.github/workflows/gates.yml`),
and they are required status checks — a red gate blocks the merge button. Running them
locally first is still expected: it is faster than a CI round-trip, and "CI will catch it"
is how a broken `main` gets pushed. A `gates: pass` table in a PR body is a claim; the
check run is the evidence.

1. `node --check game.js` — syntax.
2. `node economy.test.mjs` — economy/save/offline suite. Exits non-zero on failure.
3. `node pacing.mjs` — reference-bot pacing bands. Exits non-zero when a milestone
   falls outside its band.

Any behavior change to the economy, save shape, offline catch-up, prestige, or
achievements must land with a test in `economy.test.mjs` in the same commit — not
as a review follow-up.

Both harnesses stub the DOM and load `game.js` by stripping its page-boot lines.
If you change the trailing boot block in `game.js`, update the strip regex in both
files or the harness exits 2.

**`withRandom` throws on script overrun.** A multi-value list is a per-draw script —
one value per `Math.random()` call, in order. Drawing past the end used to wrap to
`values[0]` and silently re-fire it; it now throws. If you hit it, count the draws
your code path actually makes and supply that many, or pass a single-value list to
pin the RNG to a constant for the whole block. Do not "fix" it by deleting the guard,
and do not append values blindly until the message stops — count the draws your path
makes, then supply that many. A `step()` call that crosses a shift boundary runs two
slices and rolls twice, and that count is the thing worth knowing. Supplying more
values than get drawn is legal; arriving at the number without looking is not.

The throw fires only when the block returns normally. If a test both fails an
assertion and overruns, you see the assertion — that ordering is deliberate, and
there is a test-order check for it in PR #49. Do not move the throw out of that guard.

**Interactive surfaces sweep themselves.** The `every bound click handler is
invocable without a scope error` test discovers tabs from the view model and
modals/overlays from the boolean flags on `game.state`, then clicks every bound
handler. A new modal with a `show*` state flag — the way every existing modal is
built — is covered with no test edit. This is what stops the `g`-in-template bug
from shipping a third time; see `DESIGN.md` §14.4.

### When a gate fails

A non-zero exit is a result, not a transient error. Re-running an unchanged
command cannot change it.

- Read the **first** failure only. Later failures are usually downstream of it.
- Fix that root cause, then re-run the gate **once**.
- If the same failure survives two fixes, stop and report: name the failing
  assertion, the value you got, the value expected, and what you tried. A
  described blocker is worth more than another attempt.
- Never re-run a gate you have not changed anything for.
- If a change breaks a large share of the suite at once, you have violated an
  invariant, not found many bugs. Revert to the last green state and re-approach
  in smaller steps rather than patching failures one by one.

## Project invariants

- This is an incremental/idle nightclub-management game using plain HTML, CSS, and JavaScript.
- Saves use `localStorage`; offline progress and existing saves must remain reliable.
- Preserve the neon-noir visual language unless a task explicitly changes it.
- The stage carries no performer figure. The CSS/DOM dancer and pole were removed in v0.7.0 by
  operator decision; do not reintroduce them. The stage is lighting, haze, crowd silhouettes and
  the stage lip.
- Pacing must stay deterministic. Random/burst events are live-session-only and must not
  shift the pacing bands `pacing.mjs` measures.
- The sim steps at 10Hz; full re-render is throttled independently. Do not couple
  simulation correctness to render cadence.

## Incremental-game design lens

When a task is open-ended ("improve", "add content", "balance"), judge the change
against these before writing code:

- **No dead zones.** Every stretch of play should have a visible next purchase,
  unlock, or milestone within roughly one active session.
- **Curves, not cliffs.** Costs and rates scale multiplicatively; a new source of
  income must not flatten an existing one into irrelevance.
- **The prestige loop is the spine.** New content should either shorten a run,
  deepen a run, or give a reason to reset — say which in the PR body.
- **Caps are design, not bugs.** `caps(g)` and `rates(g)` encode intended ceilings.
  Raising one is a balance decision that needs a pacing run, not a bugfix.
- **Offline progress is a first-class path.** Anything that accrues live must have a
  defined offline behavior, and elapsed time must never be double-counted.

## Versioning and changelog

- `VERSION`, the visible build number, and `CHANGELOG` must advance together for behavior changes.
- Bump `SAVE_VER` only when the persisted save shape changes.
- Preserve backward compatibility with existing `localStorage` saves unless the change explicitly requires a reset.
- **Parallel branches collide here.** Before opening a PR, rebase onto the latest
  `main` and renumber your version/build to sit above whatever landed while you
  worked. Never resolve a `VERSION`/`CHANGELOG` conflict by merging both entries.

## Documentation

Docs ship *with* the feature, in the same PR — never as a follow-up. Before opening
a PR, grep the docs for every constant, count, or system you changed:

- `DESIGN.md` — systems, numbers, achievement counts.
- `PRESTIGE.md` — anything touching Legacy, perks, or reset behavior.
- `PLAN.md` / `IMPLEMENTATION_PLAN.md` — tick off or amend the item you implemented.
- `README.md` — only if player-visible setup or controls changed.

A partial docs pass is the single most common review finding on this repo. Search,
don't recall.

## Pull requests

- Write the PR body to `.github/pr/<number>-<slug>.md` and commit it — an
  untracked `.pr-body.md` never reaches the remote, and the PR ships with a
  stale or empty description. This file is the durable record and is not
  deleted after merge; see `.github/pr/` for existing examples.
- The body must describe *this* branch. Copying a prior PR's body has happened; check it.
- State explicitly in the body: gates run and their result, docs files touched, and
  whether `SAVE_VER` moved and why.
