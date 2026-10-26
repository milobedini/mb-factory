---
name: docs-rubric
description: What the factory's docs check files and what it leaves alone — which docs count, what drift is, verification, severities and the finding fields the console files from. Preloaded into the docs agent.
---

# Docs rubric

Every finding becomes a Linear issue that a person has to read, accept or decline. File only what they would thank you for. A quiet day is a good result, not a failure to find something.

## The docs in scope

Docs that describe the project as it is now, and so can go stale:

- Every `README.md`, at any depth.
- `AGENTS.md` and `CLAUDE.md`: the agents follow these, so drift here turns into wrong work.
- `specs/lessons/*.md` (each lesson must still hold) and `specs/_template.md`.
- `.github/pull_request_template.md`, anything under `docs/`, and example config such as `.env.example`.

Ticket specs (`specs/<ISSUE>.md`) are records of what was decided at the time; they stay as written. Code comments and docstrings belong to the review stage.

## Drift

A statement in a doc that the range made false: someone following it now fails, or does the wrong thing.

- A command, script or flag that no longer exists or no longer works as written.
- A path, file or directory that moved or went.
- A tool, runtime or package version the doc states that the range changed.
- An environment variable or setting renamed, added as required, or removed.
- A setup step the range made necessary or unnecessary.
- A convention in `AGENTS.md` or `CLAUDE.md` the range replaced (a new library, a changed test approach).
- A lesson whose cause the range removed (an upgrade fixed the bug it works around): its fix is to delete or update the lesson.

In a whole-repo pass (`scope: repo`) there's no range: drift is any of these that `HEAD` makes false, however long ago it happened.

One finding per statement that drifted. Several wrong lines that one edit fixes (the same renamed command in three places in one file) are one finding.

## What not to file

- Missing docs for something new: a feature the README doesn't mention isn't drift.
- Wording, tone, typos, formatting, or a doc that could be clearer.
- Drift the range didn't cause: a doc that was already wrong before it (the weekly whole-repo pass catches those).
- A doc the range already updated correctly.

## Verify before reporting

For each candidate, check the doc against the code at `HEAD`: the script in `package.json` or `pyproject.toml`, the file on disk, the setting in config, the version in the lockfile. When it's cheap and safe, run the documented command with `--help` or a dry run to see that it fails as you claim. If you can't decide, drop it and mention it in `summary`; don't file a maybe.

## Severity

- `high`: `AGENTS.md`, `CLAUDE.md` or a lesson now tells the agents something wrong that would lead to broken or wrong work.
- `moderate`: a person following the doc fails: a command errors, a path doesn't exist, a required step is missing.
- `low`: the doc misleads without anything failing, such as a stated version that's now out of date.

Docs drift is never `critical`.

## The finding

| Field | |
| --- | --- |
| `fingerprint` | `docs:<path>:<topic>`, the topic a short kebab-case name for the thing described (`backend-test-command`, `node-version`, `database-url`). Stable: the same drift tomorrow gets the same fingerprint, so it isn't filed twice. |
| `kind` | `docs` |
| `title` | One line for the Triage inbox, under 70 characters: what the doc gets wrong now. |
| `severity` | `high`, `moderate` or `low` |
| `evidence` | The commit that changed things (short SHA, and its issue if the message names one), what it changed, and what the doc still says, quoted. Plain Markdown; it is the issue's body. |
| `fix` | The edit, specific enough for the implement stage: the file and the replacement text. |
| `size` | Usually `XS`; `S` when several docs need the same change. |
| `path`, `line` | The doc and the line of the statement. |

Write as you would for a colleague: plain, specific, British English.
