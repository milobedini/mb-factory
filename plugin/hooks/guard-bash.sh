#!/usr/bin/env bash
# PreToolUse on Bash: refuses what a stage run must never do, whatever the prompt said: push to the default branch,
# force-push, skip git hooks, merge a PR, or write AI attribution into a commit or PR. Text passed by file (`-F`,
# `--body-file`) isn't seen here; `git-text` still applies to it.
set -uo pipefail
command=$(jq -r '.tool_input.command // empty')
[[ -n "$command" ]] || exit 0
base=${FACTORY_BASE:-main}

deny() {
  jq -n --arg reason "$1" '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $reason}}'
  exit 0
}

# Each `git push` up to the end of its command, so a flag elsewhere in a chain isn't read as the push's.
while IFS= read -r push; do
  [[ -n "$push" ]] || continue
  if grep -Eq "([[:space:]:/+])${base//./\\.}([[:space:]]|$)" <<< "$push"; then
    deny "Never push to $base: push the work's own branch."
  fi
  if [[ "$(git branch --show-current 2> /dev/null)" == "$base" ]] && ! grep -Eq '[[:space:]]HEAD:[A-Za-z0-9]' <<< "$push"; then
    deny "You're on $base: switch to the work's branch before pushing."
  fi
  if grep -Eq '[[:space:]](--force|--force-with-lease|-f|--mirror|--delete|-d)([[:space:]=]|$)|[[:space:]]\+[A-Za-z0-9]' <<< "$push"; then
    deny "Never force-push or delete a branch: add a commit instead."
  fi
done < <(grep -Eo '(^|[^[:alnum:]_-])git([[:space:]]+-[^[:space:]]+)*[[:space:]]+push([[:space:]][^;&|]*)?' <<< "$command")
if grep -Eq '(^|[[:space:]])--no-verify([[:space:]]|$)' <<< "$command"; then
  deny "Don't skip the repo's git hooks: fix what they report."
fi
if grep -Eq '(^|[^[:alnum:]_-])gh[[:space:]]+pr[[:space:]]+merge([[:space:]]|$)' <<< "$command"; then
  deny "Never merge a PR: a person or the console merges."
fi
if grep -Eiq 'co-authored-by:[^"'"'"']*(claude|anthropic)|noreply@anthropic\.com|generated with[^"'"'"']{0,20}claude' <<< "$command"; then
  deny "No AI attribution in commits, PRs or comments: remove it (git-text)."
fi
exit 0
