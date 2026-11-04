---
name: git-text
description: How the factory writes branch names, commit messages, PR titles and PR descriptions, including the Decisions block, the Evidence section and Linear linking. Read before the first commit or PR text a run writes.
---

# Git text

The repo's `AGENTS.md` and `.github/pull_request_template.md` win: read them first.

## Everywhere

- No AI attribution of any kind: no "Claude" or "AI", no AI `Co-Authored-By` trailer, no "Generated with" footer, even when a tool adds one by default. The only trailer allowed is the person the brief credits.
- British English, specific about what changed. Write `and`, not `&`. No Oxford comma.

## Linear IDs

- This work's issue is written as its ID, `TAS-123`; Linear links any PR or commit that mentions it.
- The PR description says `Fixes TAS-123` on its own line. Merging finishes the issue whatever the description says, so never offer to keep it open. A check that can only happen after merge goes under an **After merge** heading in the description and in your report, for a follow-up issue.
- Any other issue is written `TAS-456 (<two to four word title>)`, with no magic word in front, so this merge doesn't close it.

## Branch

The issue's Linear `branchName` when the spec stage hasn't made a branch; otherwise `<issue-id-lowercase>-<short-slug>`, such as `tas-123-show-cooking-time`.

## Commits

- An imperative, capitalised summary of about 50 characters with no full stop; then, unless the change is trivial, a blank line and one or two sentences on why, wrapped at about 72 columns, ending with the issue ID.
- When the brief has a `co-author`, end every commit message with a blank line and `Co-authored-by: <co-author>`, copied exactly. No other co-author, and none without one in the brief.
- One logical unit per commit: a refactor before the behaviour change that needs it, a bug's failing test with its fix, so no commit fails CI. Review fixes get one commit per finding, named for what it fixes; two in the same file share one.
- Stage by path. Never amend, rebase or force-push a pushed commit.

```text
Show cooking time on the recipe card

The API already returns cook_time but the card dropped it when it
was 0. Render "No cooking" instead of hiding the row. TAS-123
```

## PR title

Imperative, starting with a verb, in sentence case. No issue ID, full stop or brackets.

## PR description

Fill the repo's template in place, keeping every heading and checkbox and deleting its HTML comments. Tick each box the change satisfies, and each that doesn't apply with the reason in brackets (`- [x] Migrations are included for model changes (no model changes)`). Leave a box unticked only when the change falls short, saying why on its line. With no template, use `## Summary`, `## Decisions` (if any) and `## Evidence`.

- **Summary:** `Fixes TAS-123` on its own line, then two to five one-line bullets on what changed and why.
- **Decisions**, when there are any: a `**Decisions**` line, then up to five bullets, each `<what was decided>, because <why>`, ending `(asked in spec)`, `(asked during the build)` or `(agent)`. Take them from the spec's Decisions marked `Asked:` and the calls a reviewer would otherwise question.
- **Evidence:** for a bug, the failing test's name and its assertion line from the run on unchanged code. Always end with the checks line, with the real numbers from the last run (`Checks: lint clean · types clean · 14 tests passed`), and a line for anything unchecked saying what and why.
