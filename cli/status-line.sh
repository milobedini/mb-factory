#!/usr/bin/env bash
# Claude Code status line wrapper: reports your plan usage to the factory console, then runs your own status line.
#
#   "statusLine": { "type": "command", "command": "/path/to/mb-factory/cli/status-line.sh npx -y ccstatusline@latest" }
#
# Reads the token from ~/.config/mb-factory/usage-token (override with MB_FACTORY_USAGE_TOKEN_FILE). Without it, or
# without jq, it only runs the wrapped command. Reports at most every two minutes, in the background.
set -uo pipefail

input=$(cat)
token_file="${MB_FACTORY_USAGE_TOKEN_FILE:-$HOME/.config/mb-factory/usage-token}"
console_url="${MB_FACTORY_CONSOLE_URL:-https://mb-factory-console.vercel.app}"
stamp="${TMPDIR:-/tmp}/mb-factory-usage-reported"

report() {
  local limits
  limits=$(jq -ce '.rate_limits | select(.five_hour or .seven_day) | {five_hour, seven_day}' <<< "$input" 2> /dev/null) || return
  if [[ -e $stamp && -z $(find "$stamp" -mmin +2 2> /dev/null) ]]; then
    return
  fi
  touch "$stamp"
  # The token goes in through curl's config on stdin, so it never appears in the process list.
  printf 'header = "Authorization: Bearer %s"\n' "$(< "$token_file")" |
    curl -sS -m 5 -K - -X POST -H 'Content-Type: application/json' --data "$limits" "$console_url/api/usage/local" \
      > /dev/null 2>&1
}

if [[ -r $token_file ]] && command -v jq > /dev/null; then
  report > /dev/null 2>&1 &
  disown 2> /dev/null || true
fi

if [[ $# -gt 0 ]]; then
  exec "$@" <<< "$input"
fi
