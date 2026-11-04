#!/usr/bin/env bash
# Tests for the stage hooks: each feeds a hook the JSON Claude Code would and checks what it decides.
set -uo pipefail
hooks=$(cd "$(dirname "$0")" && pwd)
failed=0
pass() { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; failed=1; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
export FACTORY_STATE_DIR="$work/state"
mkdir -p "$FACTORY_STATE_DIR"
repo="$work/repo"
git init -q -b main "$repo"
git -C "$repo" -c user.name=t -c user.email=t@t commit -q --allow-empty -m init
git -C "$repo" update-ref refs/remotes/origin/main HEAD
git -C "$repo" checkout -q -b tas-1-work
mkdir -p "$repo/frontend" "$repo/backend"

guard() { (cd "$repo" && jq -n --arg c "$1" '{tool_input: {command: $c}}' | FACTORY_BASE=main "$hooks/guard-bash.sh"); }
denied() { [[ "$(guard "$1" | jq -r '.hookSpecificOutput.permissionDecision // empty')" == deny ]]; }

echo 'guard-bash'
for command in 'git push origin main' 'git push origin HEAD:refs/heads/main' 'git push --force origin tas-1-work' \
  'git push -f' 'git commit --no-verify -m x' 'gh pr merge 42 --merge' \
  $'git commit -m "Fix it\n\nCo-Authored-By: Claude <noreply@anthropic.com>"' 'gh pr create --body "🤖 Generated with [Claude Code](https://claude.com)"'; do
  if denied "$command"; then pass "denies: ${command%%$'\n'*}"; else fail "should deny: $command"; fi
done
for command in 'git push -u origin tas-1-work' 'git push origin tas-12-main-page' 'git push origin tas-1-work && rm -f tmp.txt' \
  $'git commit -m "Fix it\n\nCo-authored-by: Milo <milo@example.com>"' 'git status' 'pnpm test'; do
  if denied "$command"; then fail "should allow: $command"; else pass "allows: $command"; fi
done
git -C "$repo" checkout -q main
if denied 'git push'; then pass 'denies a bare push from main'; else fail 'should deny a bare push from main'; fi
git -C "$repo" checkout -q tas-1-work

export FACTORY_CHECKS='{"edit":[{"paths":["frontend/"],"run":"grep -q good {file}"},{"paths":["backend/"],"extensions":["py"],"dir":"backend","run":"test -f {file} && ! grep -q bad {file}"}],"stop":[{"paths":["frontend/"],"run":"! grep -rq broken frontend"},{"paths":["backend/"],"run":"false"}]}'
edit() { jq -n --arg f "$1" '{tool_input: {file_path: $f}}' | (cd "$repo" && "$hooks/check-edit.sh" 2>&1); }

echo 'check-edit'
echo good > "$repo/frontend/a.ts"
if edit "$repo/frontend/a.ts" > /dev/null; then pass 'passes a file its check passes'; else fail 'should pass frontend/a.ts'; fi
[[ -f "$FACTORY_STATE_DIR/factory-edited" ]] && pass 'marks the run as edited' || fail 'should mark the run as edited'
echo bad > "$repo/frontend/b.ts"
output=$(edit "$repo/frontend/b.ts"); status=$?
[[ $status == 2 && "$output" == *frontend/b.ts* ]] && pass 'hands a failure back (exit 2), naming the file' || fail "should fail frontend/b.ts (got $status)"
echo bad > "$repo/backend/c.py"
edit "$repo/backend/c.py" > /dev/null; [[ $? == 2 ]] && pass 'runs in the check'\''s dir with the path relative to it' || fail 'should fail backend/c.py'
echo bad > "$repo/backend/notes.md"
edit "$repo/backend/notes.md" > /dev/null && pass 'skips a file without a listed extension' || fail 'should skip backend/notes.md'
echo bad > "$repo/README.md"
edit "$repo/README.md" > /dev/null && pass 'skips a file no check covers' || fail 'should skip README.md'
echo good > "$repo/frontend/x; touch pwned.ts"
edit "$repo/frontend/x; touch pwned.ts" > /dev/null
[[ ! -e "$repo/pwned.ts" && ! -e "$repo/frontend/pwned.ts" ]] && pass 'passes the file name quoted' || fail 'a file name ran as a command'
rm -f "$repo/frontend/x; touch pwned.ts" "$repo/frontend/b.ts" "$repo/backend/c.py" "$repo/backend/notes.md" "$repo/README.md"

stop() { jq -n --arg t "$1" '{agent_type: $t}' | (cd "$repo" && FACTORY_AGENT=${2:-implement} "$hooks/check-stop.sh" 2>&1); }

echo 'check-stop'
echo broken > "$repo/frontend/a.ts"
output=$(stop mb-factory:implement); status=$?
[[ $status == 2 && "$output" == *'attempt 1 of 3'* ]] && pass 'keeps the agent working while a check fails' || fail "should refuse (got $status)"
[[ "$output" != *false* ]] && pass 'runs only the checks for areas the branch changed' || fail 'ran the backend check'
stop Explore > /dev/null && pass 'leaves a helper subagent alone' || fail 'should ignore Explore'
stop mb-factory:triage triage > /dev/null && pass 'leaves stages other than implement alone' || fail 'should ignore triage'
stop mb-factory:implement > /dev/null; stop mb-factory:implement > /dev/null
stop mb-factory:implement > /dev/null && pass 'lets it stop after three refusals' || fail 'should give up after three'
rm -f "$FACTORY_STATE_DIR/factory-stop-refusals"
echo fine > "$repo/frontend/a.ts"
stop mb-factory:implement > /dev/null && pass 'lets it stop once the checks pass' || fail 'should pass'
rm -f "$FACTORY_STATE_DIR/factory-edited"
echo broken > "$repo/frontend/a.ts"
stop mb-factory:implement > /dev/null && pass 'skips a run that edited nothing' || fail 'should skip an unedited run'

exit "$failed"
