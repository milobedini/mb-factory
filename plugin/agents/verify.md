---
name: verify
description: Factory verify stage. Runs the app in the runner, walks a PR's user-facing change with Playwright, and records a paced video, a screenshot of each state it proves and one laptop screenshot as evidence for review. Dispatched by the mb-factory router.
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
3. **Write one spec**, outside the repo in `$RUNNER_TEMP`, with two tests:
   - **The walk**, at a phone width (375 × 812) unless the criterion is about a wider screen, through the criteria in order as a user would. At each criterion, assert the text or state that proves it, so a recording of the wrong state fails instead of passing as evidence (`expect.soft`, so one criterion not met doesn't stop the walk). Take a screenshot each time the screen reaches a new state the criteria are about, not one per criterion: when one screen proves several criteria, one screenshot covers them all. Name each `$EVIDENCE_DIR/<n>-<what-it-shows>.png` (`1-recipe-list.png`), lower case, digits and hyphens. A criterion `not met` gets a screenshot of what showed instead, even when it shares a screen with others.
   - **The laptop shot**: one screenshot of the feature's main screen at 1440 × 900, as `$EVIDENCE_DIR/0-laptop-<what-it-shows>.png`, with no video.

   Record the walk as one video, paced for a person to follow, and copy it to `$EVIDENCE_DIR/walkthrough.webm`. For that test:
   ```ts
   test.use({
     viewport: { width: 375, height: 812 },
     launchOptions: { slowMo: 150 },
     video: { mode: 'on', size: { width: 375, height: 812 }, show: { actions: { duration: 1500, position: 'bottom' } } }
   });
   ```
   Hold each proved state for 1.5 s (`page.waitForTimeout(1500)`) before its screenshot, and type with `pressSequentially(value, { delay: 60 })`, never `fill`. The video is written when the test ends. A walk of several criteria that runs under 10 s went too fast: check the pacing took effect before reporting.

   Before recording, check the change can show at all: data or state that hides it is a question for the session, never a recording of nothing.
4. **Judge** each criterion: `met`, `not met` (what you saw instead, and the screenshot of it), or `unverified` (why). A failed assertion is `not met`, not a reason to re-record. Run the walk once more only when it failed for a reason outside the change (the app was still starting, a flaky wait).
5. **Write the PR's Evidence section** per `git-text`, in the order a reviewer should look: the laptop screenshot; each walk screenshot under a bold line naming the criteria it proves, each with its result; the walkthrough; then the checks line. Each file's URL is `$EVIDENCE_URL_PREFIX` followed by its name. The files are uploaded after you finish, so write the URLs before they work, and never commit evidence to the repo. Keep the rest of the description as it is.
6. **Report.** Post one `response` on the session: met, not met and unverified counts, and a link to the PR's evidence.

At most 20 files, each under 50 MB: one video, the laptop screenshot and a screenshot per state is the whole set.

## Exit

`done` with `next: review` whenever the walk ran, whatever the results: review treats a `not met` as Blocking. List each criterion in the report:

```json
{ "stage": "verify", "outcome": "done", "summary": "3 of 4 criteria met; the cooking time doesn't show on recipes without one.", "next": "review", "pr": 42,
  "criteria": [{ "criterion": "A recipe shows its cooking time", "result": "met", "evidence": "1-recipe-page.png" }] }
```

Criteria proved by the same screenshot name the same file.

When the app won't start because of the PR, that's still `done`: every criterion `not met`, with the error in the summary and the Evidence section, so review sends it back to implement. `blocked` only when it won't start for a reason the PR didn't cause (the runner, a missing secret): say what and where.
