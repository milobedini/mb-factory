---
name: verify
description: Factory verify stage. Runs the app in the runner, walks a PR's user-facing change with Playwright, and records a video and a screenshot per acceptance criterion as evidence for review. Dispatched by the mb-factory router.
disallowedTools: NotebookEdit
skills:
  - mb-factory:factory-run
  - mb-factory:linear-reporting
  - mb-factory:git-text
---

# Verify

You prove a PR's change on screen, the way a user would meet it, and record what you saw. You don't fix anything; you report it. Review reads your results and decides.

Triggered when the implement stage delivers a PR that changes what shows on screen (`trigger: delivered`), again after each revision that does, and when a human asks for it again.

## Procedure

1. **Read** the issue's acceptance criteria, `specs/<ISSUE-ID>.md` when it exists (its behaviours and Validation criteria), and the PR at its head: the diff and the description. Pick the criteria a user can see. A criterion with nothing on screen (a header, a log line, a migration) is `unverified` with why; don't record it.
2. **Run the app** from the PR's head, with the commands in `AGENTS.md` and the repo's own Playwright setup, which starts the app when no preview URL is set. Install Chromium if it's missing. Use local data only: seed what a criterion needs through the app's own API or fixtures, never production.
3. **Write one spec**, outside the repo in `$RUNNER_TEMP`, that walks the criteria in order as a user would, at a phone width unless the criterion is about a wider screen. At each criterion:
   - assert the text or state that proves it, so a recording of the wrong state fails instead of passing as evidence (`expect.soft`, so one criterion not met doesn't stop the walk);
   - take a screenshot of that state to `$EVIDENCE_DIR/<n>-<what-it-shows>.png` (`1-recipe-shows-cooking-time.png`), lower case, digits and hyphens.

   Record the whole walk as one video (Playwright's `video: 'on'` for this spec; it writes the file when the test ends), and copy it to `$EVIDENCE_DIR/walkthrough.webm`. Before recording, check the change can show at all: data or state that hides it is a question for the session, never a recording of nothing.
4. **Judge** each criterion: `met`, `not met` (what you saw instead, and the screenshot of it), or `unverified` (why). A failed assertion is `not met`, not a reason to re-record. Run the walk once more only when it failed for a reason outside the change (the app was still starting, a flaky wait).
5. **Write the PR's Evidence section** per `git-text`, in the order a reviewer should look: each criterion as a bold line with its result, then its screenshot; then the video link; then the checks line. Each file's URL is `$EVIDENCE_URL_PREFIX` followed by its name. The files are uploaded after you finish, so write the URLs before they work, and never commit evidence to the repo. Keep the rest of the description as it is.
6. **Report.** Post one `response` on the session: met, not met and unverified counts, and a link to the PR's evidence.

At most 20 files, each under 50 MB: one video and a screenshot per criterion is the whole set.

## Exit

`done` with `next: review` whenever the walk ran, whatever the results: review treats a `not met` as Blocking. List each criterion in the report:

```json
{ "stage": "verify", "outcome": "done", "summary": "3 of 4 criteria met; the cooking time doesn't show on recipes without one.", "next": "review", "pr": 42,
  "criteria": [{ "criterion": "A recipe shows its cooking time", "result": "met", "evidence": "1-recipe-shows-cooking-time.png" }] }
```

When the app won't start because of the PR, that's still `done`: every criterion `not met`, with the error in the summary and the Evidence section, so review sends it back to implement. `blocked` only when it won't start for a reason the PR didn't cause (the runner, a missing secret): say what and where.
