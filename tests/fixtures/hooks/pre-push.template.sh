#!/bin/sh
# Structure-review pre-push gate (installed by /gate install).
# structure-gate: managed hook — replaced automatically from this template when it changes.
# Do NOT hand-edit an installed copy under .git/hooks; edit this template instead.
# Refuses a push while this repo has code changes pending review. A passing Claude review clears the
# marker, which lets the push through. Catches pushes made outside Claude too.
# Matches BOTH marker files: the queue (.structure-review-pending) and a review's claimed snapshot
# (.structure-review-pending.inflight). A review in flight must still block the push — during it the
# queue file is momentarily absent, and checking only that name would let an unreviewed push slip out.
root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
# Docket item gate — OPT-IN per clone. `docket gate install --repo .` sets docket.gateLauncher (and
# docket.gateNode) in the repo's local git config; a clone without that key runs exactly the steps
# below as they were before. Opted in, stdin (the pushed ref list) is buffered once to a temp file and
# replayed to each consumer, because LFS and Docket both need to read all of it.
docket_launcher=$(git config --get docket.gateLauncher 2>/dev/null)
# Stdin (the pushed ref list) is ALWAYS buffered once and replayed to each consumer: LFS, Docket and the
# outgoing-commit check below all need to read all of it, and a pipe can only be read once.
push_refs=$(mktemp "${TMPDIR:-/tmp}/structure-push-refs.XXXXXX") || exit 1
trap 'rm -f "$push_refs"' EXIT
trap 'exit 1' HUP INT TERM
cat > "$push_refs" || exit 1
# Git LFS: this managed hook occupies pre-push, so it must run LFS's upload step itself, or a push
# sends LFS pointers without their objects. Runs first (before any opt-out exit); only in repos that
# track files with LFS. It reads the ref list on stdin, which the structure gate below never needs.
if grep -qs 'filter=lfs' "$root/.gitattributes" && command -v git-lfs >/dev/null 2>&1; then
  git lfs pre-push "$@" < "$push_refs" || exit 1
fi
# Docket runs after LFS and BEFORE the structure opt-out/pause exits: those govern structure review,
# not item validity. The launcher lives outside the checkout (last-good install), validates every
# pushed tip with `check --ref`, and fails closed if it is missing.
if [ -n "$docket_launcher" ]; then
  docket_node=$(git config --get docket.gateNode 2>/dev/null)
  [ -n "$docket_node" ] || docket_node=node
  if [ ! -f "$docket_launcher" ]; then
    echo "  docket: gate launcher not found: $docket_launcher" >&2
    echo "     Reinstall with: docket gate install --repo .   (or: git config --unset docket.gateLauncher)" >&2
    exit 1
  fi
  "$docket_node" "$docket_launcher" "$root" "$@" < "$push_refs" || exit 1
fi
[ -f "$root/.structure-review-optout" ] && exit 0
[ -f "$root/.structure-review-paused" ] && exit 0
# Block only if a CODE edit is pending. The marker also records doc edits (as "k":"doc" lines, so a
# review knows the docs moved), but a docs-ONLY change needs no review and must not gate the push.
# Gate on content — a non-doc, non-empty marker line — not on the file merely existing, matching the
# CLI/Claude-hook logic. (A bare legacy path line has no "k" field and counts as code.)
for m in "$root"/.structure-review-pending*; do
  [ -e "$m" ] || continue
  if grep -v '"k":"doc"' "$m" 2>/dev/null | grep -qE '[^[:space:]]'; then
    echo "" >&2
    echo "  ✋ structure-review: CODE changes in this repo are PENDING REVIEW." >&2
    echo "     Have Claude review them (a passing review clears the marker), then push." >&2
    echo "     Temporary bypass: touch .structure-review-paused  (or /gate pause)." >&2
    echo "" >&2
    exit 1
  fi
done
# Commits being pushed that no passed review covered (a merge, a pull, a subagent's worktree commits)
# never touch the marker above, so judge the outgoing range itself. Fails open if node or the checker
# is unavailable: the marker check above is still the floor.
checker="$HOME/.claude/hooks/structure/pre-push-check.js"
if [ -f "$checker" ] && command -v node >/dev/null 2>&1; then
  node "$checker" "$root" < "$push_refs" || exit 1
fi
exit 0
