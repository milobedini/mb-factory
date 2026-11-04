#!/usr/bin/env bash
# SubagentStop: before the implement agent finishes a run that edited code, runs the project's `checks.fast.stop` commands
# for each area its branch changed, and keeps it working (exit 2) while one fails. After three refusals it lets the
# agent stop, so a check that can't pass doesn't use up the run's time limit.
set -uo pipefail
. "$(dirname "$0")/lib.sh"
[[ -n "${FACTORY_CHECKS:-}" && "${FACTORY_AGENT:-}" == implement ]] || exit 0
state=$(state_dir)
[[ -f "$state/factory-edited" ]] || exit 0
# Only the stage agent, not a helper it started.
type=$(jq -r '.agent_type // empty')
[[ -z "$type" || "$type" == "${FACTORY_AGENT:-}" || "$type" == "mb-factory:${FACTORY_AGENT:-}" ]] || exit 0
refusals=$(cat "$state/factory-stop-refusals" 2> /dev/null || echo 0)
(( refusals < 3 )) || exit 0
root=$(git rev-parse --show-toplevel 2> /dev/null) || exit 0
base=${FACTORY_BASE:-main}
changed=$(cd "$root" && {
  git diff --name-only "origin/$base"...HEAD 2> /dev/null
  git diff --name-only HEAD
  git ls-files --others --exclude-standard
} | sort -u | jq -Rsc 'split("\n") | map(select(length > 0))')
failures=""
while IFS= read -r check; do
  [[ -n "$check" ]] || continue
  if ! output=$(run_check "$root" "$check"); then
    failures+="$(jq -r '.run' <<< "$check") failed:"$'\n'"$output"$'\n\n'
  fi
done < <(jq -c --argjson changed "$changed" '
  (.stop // [])[] | select([.paths[] as $p | $changed[] | startswith($p)] | any)' <<< "$FACTORY_CHECKS")
[[ -n "$failures" ]] || exit 0
echo $(( refusals + 1 )) > "$state/factory-stop-refusals"
printf "The project's checks fail on your branch. Fix them before you report (attempt %d of 3):\n\n%s" "$(( refusals + 1 ))" "$failures" >&2
exit 2
