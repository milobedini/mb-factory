---
name: git-text
description: How the factory writes branch names, commit messages, PR titles and PR descriptions, including the Decisions block, the Evidence section and Linear linking. Read before the first commit or PR text a run writes.
---

# Git text

The repo's own rules win: read `AGENTS.md` and `.github/pull_request_template.md` before writing.

## Everywhere

- British English. Specific, not vague: read the diff before writing, and name what changed.
- No AI attribution of any kind: no "Claude", no "AI", no AI `Co-Authored-By` trailer, no "Generated with" footer, even when a tool or harness adds one by default. Strip it. Traceability comes from the `factory` label and the console's run records. The only trailer allowed is the person the brief credits (see Commits).
- Write `and`, not `&`. No Oxford comma.

## Linear IDs

- This work's issue is written as its ID, `TAS-123`. Linear links any PR or commit that mentions it.
- The PR description says `Fixes TAS-123` on its own line. Merging the PR finishes the issue whatever the description says (the factory moves it to Done), so never offer to keep it open. A check that can only happen after merge (a scheduled workflow's first run, a restore trial) goes under an **After merge** heading in the description and in your report, for a follow-up issue.
- Any other issue (one this unblocks, depends on or follows up) is written `TAS-456 (<two to four word title>)`, never with a magic word in front, so it doesn't get closed by this merge.

## Branch

Use the issue's Linear branch name (the `branchName` field) when the spec stage hasn't already made a branch. Otherwise `<issue-id-lowercase>-<short-slug>`, e.g. `tas-123-show-cooking-time`.

## Commits

- **Summary:** imperative, capitalised (`Fix…`, `Add…`), about 50 characters, no full stop.
- **Body:** a blank line, then one or two plain sentences on why, wrapped at about 72 columns. Skip it for a trivial change. End with the issue ID: `TAS-123`.
- **Credit:** when the brief has a `co-author`, end every commit message with a blank line and `Co-authored-by: <co-author>`, copied exactly, including on a commit with no body. It credits the person the work is for. Never add any other co-author, and none when the brief has no `co-author`.
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

Evidence comes from CI, never from a local machine. The verify stage records it in the runner and writes it into the description; the implement stage leaves `Recorded by the verify stage.` in its place for a change a user will see, or `Not verified on screen: <why>.` when it reports `notOnScreen`. List files in the order a reviewer should look, each as a bold line saying what it shows, a blank line, then the image alone in its paragraph (`![what it shows](url)`). GitHub doesn't play videos from other sites inline, so a video is a link: `[Watch the walkthrough](url)`.

- **Feature:** each acceptance criterion a user can see as a bold line with its result (`met`, `not met: what showed instead`, `unverified: why`) and a screenshot of that state, then one video walking through them all.
- **Bug:** before, then after, then the failing test's name and its one assertion line from the run on unchanged code.
- **Chore:** "No visible change." and the checks line.

Always end with the checks line, using the real numbers from the last run: `Checks: lint clean · types clean · 14 tests passed`. Anything unverified gets a line saying what and why, never a silent gap.
