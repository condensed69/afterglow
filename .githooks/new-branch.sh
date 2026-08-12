#!/bin/sh
# new-branch.sh <name> [-f] — start a branch from a freshly-fetched origin/main.
#
# Replaces the three-step ritual (checkout main; pull; checkout -b) that is easy
# to skip when you are already on a feature branch. Skipping it on 2026-08-12
# produced a conflicted PR with zero CI runs. The pre-push hook now refuses that
# push; this is the way to never trigger it.
#
#   .githooks/new-branch.sh ux/help-icons-jargon
#
# --no-track is deliberate: a branch tracking origin/main means a bare
# `git push` would target main.
set -eu

cd "$(git rev-parse --show-toplevel)"

NAME="${1:-}"
FORCE="${2:-}"
if [ -z "$NAME" ]; then
  echo "usage: new-branch.sh <branch-name> [-f]" >&2
  exit 2
fi

if git show-ref --verify --quiet "refs/heads/$NAME" && [ "$FORCE" != "-f" ]; then
  echo "error: branch '$NAME' already exists." >&2
  echo "  git checkout $NAME              # continue on it" >&2
  echo "  new-branch.sh $NAME -f          # reset it onto origin/main (DISCARDS its commits)" >&2
  exit 1
fi

DIRTY="$(git status --porcelain)"
if [ -n "$DIRTY" ]; then
  echo "error: working tree is dirty — commit or stash first:" >&2
  echo "$DIRTY" >&2
  exit 1
fi

# Explicit refspec: config-driven `git fetch origin main` has previously hung
# in the Hermes container (accumulated narrow refspecs — see
# docs/runbooks/hermes-github-push.md in the homelab repo).
git fetch --no-tags origin '+refs/heads/main:refs/remotes/origin/main'
git checkout -B "$NAME" --no-track origin/main
echo ""
echo "On '$NAME', based on $(git rev-parse --short origin/main) (current origin/main)."
