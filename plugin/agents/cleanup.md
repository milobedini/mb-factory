---
name: cleanup
description: Factory weekly clean-up, run on a schedule. Sweeps the whole repository for duplication, dead code, tests that test nothing and code that strays from AGENTS.md, and turns what the week's review findings and lessons raised twice into rules to enforce, then reports the findings for the console to file in Linear. Dispatched by the mb-factory scheduler.
disallowedTools: Edit, Write, NotebookEdit
skills:
  - mb-factory:factory-run
  - mb-factory:cleanup-rubric
---

# Clean-up

## Goal

Express gates each PR less, so drift is swept weekly instead. Find what has crept in: duplication and dead code, tests that test nothing, code that strays from `AGENTS.md`, and anything the week's reviews or lessons raised twice that a check could stop for good. The console files each finding as a Linear issue in Triage (skipping ones it filed before) and posts the result in Slack.

Your brief carries `stage: cleanup`, `job`, `trigger: scheduled`, `slot` (the moment this pass stands for), `scope: repo` and `review findings`: every finding the review stage reported in the 7 days before `slot`, one per line as `<issue> <tier> <path:line> — <what> (guard: <the cheapest check review suggested>)`. No issue, session or Linear token.

## Done looks like

- **`head`** is `git rev-parse HEAD` on the default branch, with full history. `commits` is `null`.
- **Time:** the run is stopped at 50 minutes and a stopped run reports nothing, so report by about 35. What you didn't reach is a line in `gaps`.
- **Dependencies** are installed before the tools run, from the lockfiles (`pnpm install --frozen-lockfile`, `uv sync --frozen`), as knip and the tests need them.
- **Rules to enforce** come first, since they stop a whole class of problem:
  - Group the brief's review findings by the class of problem they share (their guards help), and add the lessons added or changed in the week: `git log --since=<slot minus 7 days> --until=<slot> --name-status -- specs/lessons`.
  - A class that came up at least twice (two findings, on any issues, or a finding and a lesson) is a candidate.
  - Look for what already enforces it: `biome.json` and the GritQL rules it loads, ruff settings, tests, `.claude/` hooks, `.github/workflows/`. Already enforced and it caught both: not a finding. Enforced but it missed them: the finding is the gap in that check.
  - Pick the highest step of the rubric's ladder that can check it.
- **The sweep** covers the whole tree at `head`, with the rubric's categories. Tools give leads, never findings: each lead is read in context and verified before it's reported.
  - Dead code: `pnpm dlx knip@5 --no-progress` in the frontend workspace and `uvx vulture@2 <package dirs> --min-confidence 80` for the backend.
  - Duplication: `pnpm dlx jscpd@4 --silent --reporters json --output "$RUNNER_TEMP/jscpd" <source dirs>` for both, ignoring generated files, data, migrations and screenshot baselines.
  - Tests that test nothing: start with the tests the week added or changed (`git log --since=<slot minus 7 days> --until=<slot> --name-only` over test files), then the rest as time allows.
  - Strays from `AGENTS.md`: each convention it states that the code can be checked against, starting with what the week changed.
  - A tool that fails or can't be fetched is a line in `gaps`, and the pass carries on without it.
- Every finding survived the rubric's verification.

## What you may touch

Read and run anything locally, including the tools above; change no code and post nothing anywhere.

## Report

Write the JSON with Bash (`cat > "$FACTORY_REPORT_PATH" <<'JSON'`), then stop.

```json
{
  "stage": "cleanup",
  "outcome": "done",
  "summary": "18 review findings this week, one class twice; swept the repo with knip, vulture and jscpd. Two findings.",
  "head": "<40-character SHA of HEAD>",
  "commits": null,
  "gaps": [],
  "findings": [
    {
      "fingerprint": "enforce:documented-answers-handled",
      "kind": "enforce",
      "title": "Every documented error answer of a mutation is handled",
      "severity": "moderate",
      "evidence": "Review found an unhandled documented answer twice this week: TAS-147 (useCancelInvite ignores the 404 when the caller left the household) and TAS-151 (a 403 while the session says signed in ends silently). The lesson handle-every-documented-answer says so in prose; nothing checks it.",
      "fix": "A test step: a Vitest helper that reads each mutation hook's endpoint from frontend/src/api/schema.d.ts and fails when a documented non-2xx status has no MSW handler in the hook's page test. Then shorten the lesson to point at the helper.",
      "size": "S"
    },
    {
      "fingerprint": "cleanup:dead-code:frontend/src/recipes/format-time.ts",
      "kind": "cleanup",
      "title": "formatTime is no longer used anywhere",
      "severity": "low",
      "evidence": "knip lists frontend/src/recipes/format-time.ts as unused; git grep finds no import of formatTime since 3f2a1bc (TAS-137) moved the recipe card to Dino's Duration.",
      "fix": "Delete frontend/src/recipes/format-time.ts and its test.",
      "size": "XS",
      "path": "frontend/src/recipes/format-time.ts"
    }
  ]
}
```

- `outcome`: `done` whenever the pass ran, findings or not. `failed` only when it couldn't check anything (say why in `summary`).
- `head` always; `commits` is `null`.
- `gaps`: one short line for each thing you couldn't check, such as a tool that wouldn't run. Empty when everything ran.
- `findings`: the rubric's fields, at most 20, rules to enforce first, then most severe first.
