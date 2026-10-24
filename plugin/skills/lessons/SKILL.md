---
name: lessons
description: Reading and proposing entries in a project's specs/lessons/ — the facts and process rules the factory learnt that the repo's docs don't say, with expiry for project facts. Read at the start of every stage, and before proposing a lesson in a PR.
---

# Lessons

`specs/lessons/` holds what the factory learnt on earlier work that the repo's own docs don't say. When `specs/lessons/README.md` exists, its format and rules win over this file.

## Reading

At the start of a stage, read every entry whose **Applies to** names this stage or `all`. Apply each one.

A **project fact** has a **Re-check by** date. Past that date, treat it as a lead to verify (the code, `git log`, the issue), not as truth. If it still holds, propose bumping the date. If it doesn't, propose deleting the entry. Either way, say so in the stage brief.

## Proposing

Propose a lesson when something on this run would have changed how an earlier stage worked: a spec that missed a constraint, a convention the code follows but no doc states, a check that failed for a reason the next run would hit too. Not for anything specific to this one issue.

- Add the entry as a file in the same PR as the work, `specs/lessons/<ISSUE-ID>-<slug>.md`, and list it in the PR's Summary.
- Edit or delete an entry that turned out to be wrong; don't add one that contradicts it.
- Never write credentials, personal data or anything copied from a private source. Issue IDs, PR numbers, paths and symbol names are fine.
- A human merges lessons like any other change. Self-improvement curates them later.

## Entry format

```markdown
# <Short title>

- **Added:** YYYY-MM-DD · **Applies to:** triage | spec | implement | review | verify | all
- **Paths:** <globs the rule is about, when it's about code>
- **Rule:** <what to do, or the fact>
- **Why:** <what happened that taught it, with the issue or PR>
- **Re-check by:** YYYY-MM-DD (project facts only)
```

**Process** entries are about how to work (how to size, what to ask) and don't expire. **Project facts** are about the codebase or its dependencies right now, so each carries a re-check date about three months out.
