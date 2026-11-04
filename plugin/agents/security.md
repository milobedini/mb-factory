---
name: security
description: Factory security check, run on a schedule. Audits the project's dependencies for known advisories and reviews the commits on the default branch since the last check, then reports the findings for the console to file in Linear. Dispatched by the mb-factory scheduler.
disallowedTools: Edit, Write, NotebookEdit
skills:
  - mb-factory:factory-run
  - mb-factory:security-rubric
---

# Security check

## Goal

Find security problems that arrived since the last check: known advisories in the project's dependencies, and vulnerabilities in the commits that landed on the default branch. The console files each finding as a Linear issue in Triage (skipping ones it filed before) and posts the day's result in Slack.

Your brief carries `stage: security`, `job`, `trigger: scheduled`, `slot` (the moment this check stands for), `scope` and, for a `changes` check after its first, `since` (the newest commit the last check covered); no issue, session or Linear token. `scope: repo` is the weekly pass over the whole repository.

## Done looks like

- **The range** is set. `head` is `git rev-parse HEAD` on the default branch, with full history. With `since` and `git merge-base --is-ancestor <since> HEAD` true, it's `<since>..HEAD`; otherwise every commit in the 24 hours before `slot` (`git rev-list --since=<slot minus 24h> HEAD`). It can be 0 commits. With `scope: repo` the whole tree at `head` is in scope and `commits` is `null`.
- **Every lockfile is audited** with the tools, never from memory:
  - `pnpm-lock.yaml`: `pnpm audit --json` from its directory, and `pnpm audit --prod --json` for what ships.
  - `uv.lock`: `uv export --frozen --no-emit-project --format requirements-txt -o "$RUNNER_TEMP/requirements-all.txt"`, the same with `--no-dev` to `requirements-runtime.txt`, then `uvx pip-audit --disable-pip -r <file> --format json` on each. pip-audit gives no severity: read it from the advisory (`gh api /advisories/<GHSA-ID>`; for a `PYSEC-` or `CVE-` ID, its GHSA alias from `aliases`).
  - `package-lock.json`: `npm audit --json` and `npm audit --omit=dev --json`.
  - Any other lockfile, or a tool that fails or can't reach its registry, is a line in `gaps`, and the check carries on.
- **The code is reviewed** with `security-rubric`: the range's `git log` and `git diff`, then the changed files in context; only what the range changed or made reachable counts. With `scope: repo`, the whole codebase, entry points first (routes and views, settings, auth, anything reading user input, the workflows), then what they reach; a finding filed before is recognised by its fingerprint, so report it again while it holds.
- Every finding survived the rubric's verification.

## What you may touch

Read and run anything locally; change no code and post nothing anywhere.

## Report

Write the JSON with Bash (`cat > "$FACTORY_REPORT_PATH" <<'JSON'`), then stop.

```json
{
  "stage": "security",
  "outcome": "done",
  "summary": "Audited 267 npm and 25 Python packages; reviewed 3 commits. One finding.",
  "head": "<40-character SHA of HEAD>",
  "commits": 3,
  "gaps": [],
  "findings": [
    {
      "fingerprint": "advisory:django@6.1.0",
      "kind": "advisory",
      "title": "Django 6.1.0 has two known vulnerabilities",
      "severity": "high",
      "scope": "runtime",
      "evidence": "pip-audit: GHSA-xxxx-xxxx-xxxx (high, SQL injection in JSONField key lookups) and GHSA-yyyy-yyyy-yyyy (moderate). Fixed in 6.1.1.",
      "fix": "Bump django to 6.1.1 in backend/pyproject.toml and run uv lock.",
      "size": "XS"
    }
  ]
}
```

- `outcome`: `done` whenever the check ran, findings or not. `failed` only when it couldn't check anything (say why in `summary`).
- `head` and `commits` always, even on a quiet day: the next check starts after `head`. `commits` is `null` for `scope: repo`.
- `gaps`: one short line for each thing you couldn't check. Empty when everything ran.
- `findings`: the rubric's fields, at most 20, most severe first.
