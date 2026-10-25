---
name: git-text
description: How the factory writes branch names, commit messages, PR titles and PR descriptions, including the Decisions block, the Evidence section and Linear linking. Read before the first commit or PR text a run writes.
---

# Git text

The repo's own rules win: read `AGENTS.md` and `.github/pull_request_template.md` before writing.

## Everywhere

- British English. Specific, not vague: read the diff before writing, and name what changed.
- No AI attribution of any kind: no "Claude", no "AI", no `Co-Authored-By` trailer, no "Generated with" footer, even when a tool or harness adds one by default. Strip it. Traceability comes from the `factory` label and the console's run records.
- Write `and`, not `&`. No Oxford comma.

## Linear IDs

- This work's issue is written as its ID, `TAS-123`. Linear links any PR or commit that mentions it.
- The PR description says `Fixes TAS-123` on its own line, so Linear moves the issue when the PR merges. Use `Part of TAS-123` instead when this PR doesn't finish the issue.
- Any other issue (one this unblocks, depends on or follows up) is written `TAS-456 (<two to four word title>)`, never with a magic word in front, so it doesn't get closed by this merge.

## Branch

Use the issue's Linear branch name (the `branchName` field) when the spec stage hasn't already made a branch. Otherwise `<issue-id-lowercase>-<short-slug>`, e.g. `tas-123-show-cooking-time`.

## Commits

- **Summary:** imperative, capitalised (`Fix…`, `Add…`), about 50 characters, no full stop.
- **Body:** a blank line, then one or two plain sentences on why, wrapped at about 72 columns. Skip it for a trivial change. End with the issue ID: `TAS-123`.
- **One logical unit per commit.** A refactor goes in its own commit before the behaviour change that needs it. A bug's failing test goes in the same commit as its fix, so no commit fails CI.
- **Review fixes:** one commit per finding, named for what it fixes, with a body saying why the point held. Two fixes in the same file share a commit.
- Stage by path (`git add <paths>`). Never amend, rebase or force-push a pushed commit.

```text
Show cooking time on the recipe card

The API already returns cook_time but the card dropped it when it
was 0. Render "No cooking" instead of hiding the row. TAS-123
```

## PR title

Imperative, starting with a verb (Add, Fix, Update, Extract, Replace, Remove). Sentence case. No issue ID, no full stop, no brackets.

## PR description

Fill the repo's template in place, keeping every heading and checkbox. Delete the template's HTML comments once you've followed them.

Tick each checklist box the change satisfies. A box that doesn't apply is ticked too, with the reason in brackets: `- [x] Migrations are included for model changes (no model changes)`. Leave a box unticked only when the change falls short of it, and say why on the same line. A project's `AGENTS.md` can override this.

- **Summary:** `Fixes TAS-123` on its own line, then 2–5 one-line bullets on what changed and why.
- **Decisions** (when there are any): a `**Decisions**` line, then up to five bullets, each `<what was decided>, because <why>`, ending `(asked in spec)`, `(asked during the build)` or `(agent)`. Take them from the spec's Decisions marked `Asked:` and the judgement calls a reviewer would otherwise question.
- **Evidence:** see below.

With no template, use `## Summary`, `## Decisions` (if any), `## Evidence`.

### Evidence

Evidence comes from CI, never from a local machine. The verify stage records it and reports each file's URL; reference those URLs. List files in the order a reviewer should look, each as a bold line saying what it shows, a blank line, then the image or video link alone in its paragraph.

- **Feature:** a video of each change a user will see.
- **Bug:** before, then after, then the failing test's name and its one assertion line from the run on unchanged code.
- **Chore:** "No visible change." and the checks line.

Always end with the checks line, using the real numbers from the last run: `Checks: lint clean · types clean · 14 tests passed`. Anything unverified gets a line saying what and why, never a silent gap.
