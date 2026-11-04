#!/usr/bin/env bash
# PostToolUse on Edit and Write: runs the project's `checks.fast.edit` command for the edited file and hands its errors
# back to the agent (exit 2). Also marks the run as having edited code, for check-stop.sh.
set -uo pipefail
. "$(dirname "$0")/lib.sh"
[[ -n "${FACTORY_CHECKS:-}" ]] || exit 0
file=$(jq -r '.tool_input.file_path // empty')
[[ -n "$file" ]] || exit 0
root=$(git rev-parse --show-toplevel 2> /dev/null) || exit 0
# Both resolved, so a symlink in either path (macOS's /var) doesn't hide the file from the repo.
root=$(cd "$root" && pwd -P)
[[ "$file" == /* ]] || file="$PWD/$file"
file="$(cd "$(dirname "$file")" 2> /dev/null && pwd -P)/$(basename "$file")" || exit 0
case "$file" in
  "$root"/*) rel=${file#"$root"/} ;;
  /*) exit 0 ;;
  *) rel=$file ;;
esac
touch "$(state_dir)/factory-edited"
ext=""
[[ "$(basename "$rel")" == *.* ]] && ext=${rel##*.}
check=$(jq -c --arg rel "$rel" --arg ext "$ext" '
  [(.edit // [])[]
    | select(any(.paths[]; . as $p | $rel | startswith($p)))
    | select(.extensions == null or (.extensions | index($ext)) != null)]
  | first // empty' <<< "$FACTORY_CHECKS")
[[ -n "$check" ]] || exit 0
dir=$(jq -r '.dir // "."' <<< "$check")
target=$rel
[[ "$dir" != "." ]] && target=${rel#"$dir"/}
if ! output=$(run_check "$root" "$check" "$target"); then
  printf "The project's check failed on %s after your edit. Fix it before moving on:\n%s\n" "$rel" "$output" >&2
  exit 2
fi
exit 0
