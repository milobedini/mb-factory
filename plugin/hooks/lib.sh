# Shared by the hooks. FACTORY_CHECKS, FACTORY_AGENT and FACTORY_BASE come from the stage workflow's start step;
# FACTORY_STATE_DIR (tests) or RUNNER_TEMP holds what one hook leaves for another.
state_dir() { printf '%s' "${FACTORY_STATE_DIR:-${RUNNER_TEMP:-/tmp}}"; }

# Runs a check's command in its directory, with `{file}` as the quoted path in FILE. Prints its output's tail.
run_check() {
  local root=$1 check=$2 file=${3:-}
  local dir run output status
  dir=$(jq -r '.dir // "."' <<< "$check")
  run=$(jq -r '.run' <<< "$check")
  run=${run//\{file\}/\"\$FILE\"}
  output=$(cd "$root/$dir" && FILE="$file" bash -c "$run" 2>&1)
  status=$?
  printf '%s' "${output: -6000}"
  return "$status"
}
