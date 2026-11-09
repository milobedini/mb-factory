#!/usr/bin/env bash
# Tests for factory-github-token and the gh and git beside it, against a stand-in console (a fake curl).
set -uo pipefail
bin=$(cd "$(dirname "$0")" && pwd)
failed=0
pass() { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; failed=1; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
fakes="$work/fakes"
mkdir -p "$fakes"
# The console: answers with $CONSOLE_ANSWER, or fails when it's empty, and counts its calls.
cat > "$fakes/curl" << 'EOF'
#!/usr/bin/env bash
echo call >> "$CONSOLE_CALLS"
[[ -n "${CONSOLE_ANSWER:-}" ]] || { echo 'curl: (22) 403' >&2; exit 22; }
printf '%s' "$CONSOLE_ANSWER"
EOF
# gh: says which token it was given.
cat > "$fakes/gh" << 'EOF'
#!/usr/bin/env bash
echo "gh saw $GH_TOKEN"
EOF
chmod +x "$fakes/curl" "$fakes/gh"

repo="$work/repo"
git init -q "$repo"
git -C "$repo" remote add origin https://x-access-token:ghs_first@github.com/milobedini/tastebook.git

real_path=$PATH
# git without the wrapper, for the test's own setup and checks.
real_git() { PATH=$real_path git "$@"; }
export PATH="$bin:$fakes:$PATH"
export RUNNER_TEMP="$work" GITHUB_WORKSPACE="$repo" CONSOLE_CALLS="$work/calls"
export FACTORY_GITHUB_TOKEN_URL=https://console.example/api/runs/1/github-token FACTORY_GITHUB_PASS=pass GH_TOKEN=ghs_first
cache="$work/factory-github-token"
calls() { [[ -f "$CONSOLE_CALLS" ]] && wc -l < "$CONSOLE_CALLS" | tr -d ' ' || echo 0; }
later=$(($(date +%s) + 3600))
soon=$(($(date +%s) + 300))

echo 'factory-github-token'
printf 'ghs_first\n%s\n' "$later" > "$cache"
[[ "$(factory-github-token)" == ghs_first && "$(calls)" == 0 ]] && pass 'keeps a token with time left' || fail 'should keep a token with time left'

printf 'ghs_first\n%s\n' "$soon" > "$cache"
export CONSOLE_ANSWER="{\"token\":\"ghs_second\",\"expiresAt\":$later}"
[[ "$(factory-github-token)" == ghs_second ]] && pass 'swaps a token near its hour' || fail 'should swap a token near its hour'
[[ "$(head -1 "$cache")" == ghs_second ]] && pass 'keeps the fresh token' || fail 'should keep the fresh token'
[[ "$(real_git -C "$repo" config --get remote.origin.url)" == https://x-access-token:ghs_second@github.com/milobedini/tastebook.git ]] \
  && pass "puts it in origin's URL" || fail "should put it in origin's URL"
factory-github-token > /dev/null
[[ "$(calls)" == 1 ]] && pass 'asks the console once' || fail "should ask the console once, asked $(calls) times"

printf 'ghs_first\n%s\n' "$soon" > "$cache"
export CONSOLE_ANSWER=''
[[ "$(factory-github-token 2> /dev/null)" == ghs_first ]] && pass 'keeps its token when the console refuses' \
  || fail 'should keep its token when the console refuses'
export CONSOLE_ANSWER='{"token":"bad token; rm -rf /","expiresAt":1}'
[[ "$(factory-github-token 2> /dev/null)" == ghs_first ]] && pass "ignores an answer that isn't a token" \
  || fail "should ignore an answer that isn't a token"

rm -f "$cache"
(unset FACTORY_GITHUB_TOKEN_URL && [[ "$(factory-github-token)" == ghs_first ]]) && pass 'outside a run, prints GH_TOKEN' \
  || fail 'outside a run, should print GH_TOKEN'

echo 'gh and git'
printf 'ghs_first\n%s\n' "$soon" > "$cache"
export CONSOLE_ANSWER="{\"token\":\"ghs_third\",\"expiresAt\":$later}"
[[ "$(gh pr view)" == 'gh saw ghs_third' ]] && pass 'gh gets the fresh token' || fail 'gh should get the fresh token'

real_git -C "$repo" remote set-url origin https://x-access-token:ghs_first@github.com/milobedini/tastebook.git
printf 'ghs_first\n%s\n' "$soon" > "$cache"
export CONSOLE_ANSWER="{\"token\":\"ghs_fourth\",\"expiresAt\":$later}"
git -C "$repo" status > /dev/null
[[ "$(real_git -C "$repo" config --get remote.origin.url)" == *ghs_fourth@* ]] && pass "git refreshes origin's URL first" \
  || fail "git should refresh origin's URL first"

exit "$failed"
