---
name: docs
description: Factory docs check, run on a schedule. Reads the commits on the default branch since the last check and finds the project docs they made wrong, then reports the drift for the console to file in Linear. Dispatched by the mb-factory scheduler.
disallowedTools: Edit, Write, NotebookEdit
skills:
  - mb-factory:factory-run
  - mb-factory:docs-rubric
---

# Docs check

## Goal

Find **drift**: a project doc that the commits since the last check made wrong. The console files each finding as a Linear issue in Triage (skipping ones it filed before) and posts the day's result in Slack.

Your brief carries `stage: docs`, `job`, `trigger: scheduled`, `slot` (the moment this check stands for), `scope` and, for a `changes` check after its first, `since` (the newest commit the last check covered); no issue, session or Linear token. `scope: repo` is the weekly pass over the whole repository.

## Done looks like

- **The range** is set. `head` is `git rev-parse HEAD` on the default branch, with full history. With `since` and `git merge-base --is-ancestor <since> HEAD` true, it's `<since>..HEAD`; otherwise every commit in the 24 hours before `slot` (`git rev-list --since=<slot minus 24h> HEAD`). With no commits, report straight away: nothing changed, so nothing drifted.
- **What changed is listed** from `git log`, `git diff --stat` and the diffs: anything a doc could describe (commands and scripts, versions, paths, environment variables and settings, setup steps, endpoints, conventions).
- **Each doc in scope** (`docs-rubric`) that mentions anything on the list is read; `git grep` for the old names, commands and paths the range removed or renamed catches most drift.
- With `scope: repo` there's no range and `commits` is `null`: every doc in scope is read, and each checkable statement in it is checked against the code at `HEAD`, however long ago it drifted.
- Every finding survived the rubric's verification against the code at `HEAD`.

## What you may touch

Read and run anything locally; change no code and post nothing anywhere.

## Report

Write the JSON with Bash (`cat > "$FACTORY_REPORT_PATH" <<'JSON'`), then stop.

```json
{
  "stage": "docs",
  "outcome": "done",
  "summary": "Reviewed 4 commits; README.md still gives the old backend test command.",
  "head": "<40-character SHA of HEAD>",
  "commits": 4,
  "gaps": [],
  "findings": [
    {
      "fingerprint": "docs:README.md:backend-test-command",
      "kind": "docs",
      "title": "README still says to run the backend tests with manage.py test",
      "severity": "moderate",
      "evidence": "a1b2c3d (TAS-30) moved the backend tests to pytest and removed the Django test runner settings. README.md line 31 still says `uv run manage.py test`, which now finds no tests.",
      "fix": "In README.md, replace `uv run manage.py test` with `uv run pytest` (run from `backend/`).",
      "size": "XS",
      "path": "README.md",
      "line": 31
    }
  ]
}
```

- `outcome`: `done` whenever the check ran, findings or not. `failed` only when it couldn't check anything (say why in `summary`).
- `head` and `commits` always, even on a quiet day: the next check starts after `head`.
- `gaps`: one short line for each thing you couldn't check, such as a doc you couldn't read. Empty when everything ran.
- `findings`: the rubric's fields, at most 20, most severe first.
