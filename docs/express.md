# Express

Express is an agent-first track through the factory. It comes with a slimming of the factory that both tracks share. It was agreed on 3 Nov 2026 in a grilling session with the user and is **Phase 5**. This document records why, the evidence, the research, the design and the rollout. [PLAN.md](PLAN.md) holds the short decisions and what to do **Next**.

## Why

The factory's stages, skills and gates were ported from the user's mb-skills and from Warp Factories. They were written for models that needed scaffolding:

- long agent prompts and rubrics
- a written spec approved before any code
- a separate verify stage that walks the app
- an adversarial review that asks a person whenever it's unsure
- a person's tap at spec, design and merge

Models from Opus 5.5 on handle more of this alone, and Anthropic's own guidance now says to remove scaffolding as models improve ([Research](#research)). Express bets on that, and measures the bet against the pipeline as it stood on 3 Nov.

The goals, in order:

1. **Fewer human waits** between delegating an issue and its merge.
2. **Build towards where models are heading**, and measure it against the current pipeline.

A smaller factory follows from these. Usage matters least: the plan is Ultra, with a weekly limit only.

**Not goals.** Taking the person out of taste: design and Design Review stay exactly as they are ("taste is human"). Taking the person out of risky or irreversible changes: those still wait for their merge.

**Express is the base for future factory changes.** It started at once rather than after Phase 4's planned two-week baseline. Phase 4's baseline was frozen at 3 Nov instead.

## The evidence

### What each stage and gate did (25 Oct–3 Nov 2026)

The data covers 719 runs, 98 work items and 93 `factory` PRs (91 merged, 1 closed, 1 open), at $680 API-equivalent cost. It comes from read-only queries of the factory database and GitHub.

#### Runs by agent

| Agent     | Runs | Median | Share of cost | Failed or blocked |
| --------- | ---- | ------ | ------------- | ----------------- |
| implement | 206  | 4 min  | 51%           | 5%                |
| review    | 186  | 2 min  | 22%           | 1.6%              |
| spec      | 75   | 4 min  | 18%           | 0                 |
| verify    | 86   | 3 min  | 5%            | 3 runs            |
| triage    | 95   | 1 min  | 3.5%          | 0                 |
| size      | 20   | <1 min | 0.4%          | 15%               |

Review costs about 27% once the implement runs fixing its findings are added: 43 runs to fix findings and 33 to act on answers.

**Verify:**

- It checked 571 criteria: 397 met, 174 unverified (30%), **0 not met**. It never caught a defect.
- Review overturned at least 5 "met" results whose screenshots didn't show the behaviour (TAS-80, 137, 106, 20, 44).

**Review:**

| | |
| --- | --- |
| Verdicts (186 runs) | 108 accepted, 44 needed a person, 29 needed revision |
| First pass | 42% of PRs accepted at the first review |
| Revise rounds | 61 PRs had none and 29 had one. None had two, so the cap was never reached |
| Findings | 54 Blocking, 50 Should fix, 78 Nit, 6 Could cut |

The 54 Blocking findings, classified:

| Kind | Count | Examples |
| --- | --- | --- |
| A real defect CI wouldn't catch | 10 (19%) | **TAS-107** (#105): after a two-factor reset, an older session gets admin back (review reproduced it). **TAS-108** (#106): the household query survives sign-out, so the next account sees the last one's household. **TAS-114** (#118): joining a household cascade-deletes the joiner's private recipes. TAS-26 (#24): a `deployment_status` workflow could leak secrets to fork PRs. TAS-104 (#102): IPs and email hashes kept forever (GDPR) |
| A check that had already failed, repeated | 22 (41%) | Lighthouse, flakes, screenshot baselines red on `main`: TAS-91, 79 and 81 each flagged the same Combobox baselines |
| A cancelled, rate-limited or failed Vercel preview | 8 (15%) | TAS-31 and TAS-33 were blocked for a preview unrelated to the diff |
| Evidence or process | 10 (19%) | A placeholder Evidence section, a screenshot not showing the criterion, "Recorded by verify" when verify never ran (TAS-49 to 51) |
| Style or a rule | 4 (7%) | `let` in a test filed as Blocking (TAS-140) |

Should fix held more real bugs:

- TAS-136: Escape closes the whole filters sheet.
- TAS-116: a PATCH answers 500.
- TAS-80 and TAS-83: focus is lost.
- TAS-151: a 403 on Save shows no message.
- TAS-137, TAS-33 and TAS-111: tests that test nothing.

**Questions to a person:**

- 199 were asked, and the suggested answer was picked 154 times (80%).
- **Spec: 88%.** The 12% overridden were real product calls: TAS-17 (cuisine), TAS-91 (no new App), TAS-20 (an off switch).
- **Review: 55%.** About 27 of its 48 questions were about CI or infrastructure (baselines, Lighthouse, Vercel), not the code.

**Human gates:**

- **Spec Review:** 34 of 37 specs approved unchanged. TAS-15, TAS-47 and TAS-116 changed.
- **Design Review:** 12 designs, 1 recorded change (TAS-116's variants). Revisions made on the canvas aren't recorded, so this undercounts.
- **The merge gate:**
  - It never rejected a PR. The only close was TAS-35, after the person found the approach didn't work.
  - It saw 4 substantive change requests (TAS-12, TAS-27, TAS-95 twice) and 13 "fix the nits" taps after an accept.
  - The only human push was TAS-90. The 21 human-authored commits are design hand-offs and merges of `main`.

**Cycle time (77 merged items):**

- Median from delegation to merge: **68 minutes**. 45 with no spec, 87 with a spec, 143 with spec and design.
- Of the total time:
  - Awaiting Merge: **63%**. Waiting on review's questions alone was **28%** of all time. The final merge wait had a median of 5 minutes and a p90 of 41.
  - Agent run time: **17%**.
  - Design Review: 4%.
  - Spec Review: 2%.
  - The rest is mostly CI, previews and Actions overhead (inferred).

Caveats: design runs record no cost or duration. Stage times for 13 early items come from a backfill. The classification of findings is a judgement made from their summaries.

### How big a factory PR really is

Measured file by file across the 91 merged `factory` PRs:

- **Raw lines changed:** median 716, p90 2,651. 58 of 91 PRs are over 500, so a raw line cap would send most PRs to a person.
- **What those lines are:**
  - 16% app source
  - 47% generated output and data: screenshot baselines, `pnpm-lock.yaml`, `uv.lock`, `backend/schema.yml`, `frontend/src/api/schema.d.ts`, the recipe catalogue JSON
  - 19% docs and specs
  - 17% tests
- **Source lines only:** median 149, p75 280, p90 432. 22 PRs over 300, 12 over 400, 7 over 500. The largest were #124 (recipe editing, 1,434), #122 (821) and #28 (the styleguide, 806). Only 2 PRs touched more than 20 source files.
- **Folders:** 34 of 91 PRs touched `backend/households`, `backend/config`, migrations or workflows. Fencing off whole folders would send a third of PRs to a person.

### Tastebook's protection and rules (3 Nov)

- **Branch protection on `main`:** 1 approving review (stale reviews dismissed); the Frontend, Backend, API contract and End-to-end checks; the branch up to date; admins not bound.
- **Rules:**
  - two custom Biome rules (`tools/biome/no-arbitrary-radius.grit`, `no-let.grit`)
  - 36 lessons in `specs/lessons/`
  - about 60 rule bullets in `AGENTS.md`
  - no Claude Code hooks
  - no coverage or mutation measure

## Research

This is web research from 3 Nov 2026, solid evidence first. Each finding ends with what it changed here.

1. **Anthropic's [Claude Code best practices](https://code.claude.com/docs/en/best-practices)** has a "What you can stop doing" table: IMPORTANT and ALL CAPS ("mostly makes Claude over-apply the rule"), "loop until done / don't be lazy", architecture notes in CLAUDE.md, subagents just for a better answer. Anything that "has to happen every time" goes in hooks, deny rules or CI, and "keep the enforced set small". Its checklist for unattended runs: does the run know what done is, can it check itself, what may it touch, what stops it, and who signs off ("a person approving the merge, the deploy, or anything else you can't take back").
   - **Here:** the four-part agent shape, must-never rules moved to hooks, and a person's merge for what can't be taken back.
2. **The Opus 5 and 5.5 prompting guides** ([Opus 5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5), [Opus 5.5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5)): remove "legacy harness scaffolding that adds separate verification steps", which over-verifies "with no loss in quality" once removed. Opus 5 "performs best when given the complete task specification up front and left to run".
   - **Here:** verify goes from both tracks. In express the issue is the specification.
3. **A separate reviewer is the one exception Anthropic keeps.** The [Fable 5 guide](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5) says fresh-context verifiers "tend to outperform self-critique", and that skills written for earlier models "are often too prescriptive". The best-practices page says a fresh reviewer helps "because it hasn't seen your reasoning", but warns "a reviewer that's asked to find problems will always find *something*": tell it to skip style and check against the spec.
   - **Here:** review stays, narrowed to correctness and security against the issue.
4. **[Harness design for long-running apps](https://www.anthropic.com/engineering/harness-design-long-running-apps)** (Anthropic, 24 Mar 2026): they removed context resets with Opus 4.5 and sprint decomposition with 4.6. A separate evaluator became "unnecessary overhead" for tasks the model handles alone, but still paid off "when the task sits beyond what the current model does reliably solo". The key line: "every component in a harness encodes an assumption about what the model can't do". Also [Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents): "smarter models require less prescriptive engineering".
   - **Here:** the [stage assumptions](#what-each-stage-assumes) table, re-checked at each model release.
5. **[Warp Factories](https://docs.warp.dev/factories/how-factories-work/)** has no fast mode. The foreman skips triage and planning for "small, well-understood changes", and the stages are "responsibilities, not a fixed pipeline". Spec sign-off is on by default, review is "advisory", and it "never merges on your behalf". Scorers must be checked against human review before being trusted ([measure and improve](https://docs.warp.dev/factories/measure-and-improve/)).
   - **Here:** skipping stages per issue is Warp's way. Auto-merge goes beyond Warp.
6. **[PostHog](https://posthog.com/newsletter/code-review-tips)** (9 Jul 2026): several reviewer agents on different models. Its approval agent, StampHog, approves about 1 in 3 merged PRs and refuses anything over 500 lines or 20 files, anything on a high-blast-radius deny-list, and anything touching auth, secrets, billing or a public API. Its rules: LLMs "can tighten gates but never loosen them", and "observation scales better than review".
   - **Here:** the risk routing and the tighten-only rule.
7. **Amp** ([via StartupHub](https://www.startuphub.ai/news/quinn-slack-amp-killed-mandatory-code-review), second-hand) dropped mandatory pre-merge review. It kept CI and added scoped short-lived credentials and agent-watched rollouts with auto-rollback.
   - **Here:** the watch after merging.
8. **[Pragmatic Engineer](https://newsletter.pragmaticengineer.com/p/what-is-happening-with-code-reviews)** (8 Sep 2026): "more talk about dropping human code reviews than… evidence". Duckbill reportedly dropped review except for auth, schema, public API and skills, with an 85% coverage floor and end-to-end tests. Anthropic and OpenAI reportedly skip human review for low-risk changes, but a person still presses merge at Anthropic (second-hand).
9. **Agent-written code drifts.** An [ICML 2026 paper](https://icml.cc/virtual/2026/82761) found follow-up tasks resolve 1 to 13 points less often on agent-written code. A [March 2026 study](https://arxiv.org/abs/2603.28592) found 24.2% of AI-introduced issues still present at the latest revision. Only the abstracts were read.
   - **Here:** fewer per-PR gates are traded for a weekly clean-up job.

**Weak or contested:**

- Self-check against a separate reviewer: a preprint on Sonnet 4.5 (arXiv 2608.18167, not peer-reviewed) found them tied. Only adversarial back-and-forth gained, at about 4.5× the tokens. No controlled study on Opus 5.x was found.
- Incidents blamed on agents (Amazon Kiro, a Cursor agent deleting PocketOS's database) are about agents holding production credentials, not about missing review.

**What every fast team keeps:**

- CI and branch protection
- a person or deterministic gate on migrations, auth and secrets
- caps on size and scope
- scoped credentials
- monitoring after deploy, with rollback

**Where this design differs from the research:**

- **Less far than "drop review":** the evidence above shows review catching TAS-107, 108 and 114.
- **Further than Warp:** low-risk PRs auto-merge.

## The design

### Two tracks

- **The setting.** `track: express | careful` in each project's `factory.yaml`, overridden per issue by the Linear labels `express` and `careful`. Tastebook's default is `express`.
- **The careful track** is the pipeline as it was, with the shared slimming below: verify removed, review narrowed, the slimmed prompts.
- **Switching mid-flight.** The router reads the label whenever it picks the next step, so a switch takes effect there and nothing running is cancelled.
  - Moving an express item to `careful` after implement gives it the person's merge, and lets review ask. No spec is written after the fact.
  - Moving a `careful` item to express while it waits at Spec Review skips the gate and starts implement.

Rejected:

- one global switch, because risk varies by issue more than by project
- triage picking the track by itself, an extra judgement call to add later if wanted
- separate prompts per track, two copies to keep in step

### The express flow

`triage → (design → Design Review, when needed) → implement → review → auto-merge, or the person's merge`

- **Triage** researches, sizes and routes as before. It also:
  - **makes the design call** the spec makes in careful, with the same rules. Design is needed for a new screen or flow, a new or changed Dino component, or a visible layout change. It's skipped when existing components are reused with no visual change, when a small UI change stays within `docs/design.md`, or when the reference boards already draw it.
  - **can move an issue to `careful`** ([tighten only](#who-merges)).
- **There's no spec stage and no Spec Review.** The Linear issue is the specification. Implement writes its plan and decisions into the PR description's Decisions block (`git-text`). Slicing projects and PRDs are unchanged.
- **Design and Design Review are unchanged**, variants and canvas included. With no spec branch, design's hand-off commits `specs/<ID>/design/` to the work's own branch.
- **Implement asks the spec's questions, and waits.** Before it codes, implement asks what the spec would have asked: product calls and the technical approach, each with a suggested option. Settled on 4 Nov: the user wants a say on approach, not only product, and the questions make them think the feature through. Only the spec document and Spec Review go.
  - Infrastructure and CI questions take the suggested option. The thread says what was chosen and why, and a reply changes it as a follow-up.
- **Review never asks in express.** It fixes its Blocking findings through the usual revise round and files Should fix findings as follow-up issues.

### Changes in both tracks

- **Verify is removed:** the stage, `verify.paths`, `notOnScreen`, `verifyAgain` and the Evidence section rules.
- **One visual per UI PR**, replacing per-criterion evidence. The user only used the screenshots and walkthroughs to see quickly what changed, not as a review stage.
  - **What:** implement makes one collage of the changed screens at phone width, with before beside after where an existing screen changed. When the change is an interaction or flow, it records a short video instead.
  - **Where:** it's uploaded to the evidence Blob store and goes at the top of the PR. In the Slack thread it's posted as an image with Ready to merge, or with "Merged" when auto-merged.
  - **Non-UI PRs** get two plain lines on what changed.
  - **How** (settled 4 Nov on a [canvas](https://claude.ai/artifact/E4g3r5Xym15rN2eftMrdYX)): implement records the screens or the walk at 375 × 812 and names them in `visual.json`. A `visual` job builds the rest with no agent and no secret (`.github/scripts/visual.sh`), so every visual looks the same, and ImageMagick and ffmpeg never read the agent's files beside the store's token. The evidence job uploads the finished files and reports the run.
    - A collage holds at most four screens on Tastebook's dark ground, each captioned, a changed screen's before beside its after, set apart by a divider.
    - A video is converted to mp4 so it plays on a phone. Its poster is three of its frames with a play badge and its length.
    - Slack shows the image under review's text, before *Before merging* and the buttons. A video's "Play the walkthrough" link is a context line rather than a button, so it stays when the buttons are cleared at merge.
    - The console reads the visual from the newest implement run that has one, so a revision that changes nothing on screen keeps it. It reads only the store's public URLs, which the evidence job writes over whatever the agent put there.
- **Review is narrowed:**
  - It checks correctness and security against the issue (or spec), in a fresh context.
  - It never reports a failing check or a Vercel preview: the router already handles CI.
  - Nit and Could cut go. Settled on 4 Nov: it keeps correctness, the issue and spec, security and privacy, workflows, accessibility as a user meets it, and untested behaviour; fundamentals, concision and the design-system rubric go.
  - In careful it may still ask the person, about the code only.
  - If review catches nothing for several weeks of express, revisit it.
- **Slimmed agents and skills** ([Slimming](#slimming)).
- **Fast-feedback hooks** in every stage run ([Keeping it clean](#keeping-it-clean)).

### Who merges

**By default, the factory merges an express PR itself once every check passes.** The PR goes to the person's merge (the Approve and merge tap, as today) when any of the rules below holds. All of them are deterministic and read from the diff, except the last.

1. **Size.** More than **400 source lines** or **20 source files** changed.
   - Generated output, data, docs, specs, tests and baselines don't count. The patterns live in `factory.yaml` beside the thresholds, so each project names its own generated files.
   - On the data above, about 1 in 8 Tastebook PRs is over the cap.
2. **Risky paths**, as globs in the project's `factory.yaml` (`express.humanMerge`):
   - migrations, every one: production database changes are approved each time
   - auth and session code (allauth settings, sign-in, two-factor, permission classes)
   - `backend/config/` settings
   - CI workflows
   - `factory.yaml`
   - dependency majors

   Not whole feature folders such as `households`.

3. **Weakening the safety net:**
   - a test deleted or skipped
   - lint, type or test configuration changed
   - a threshold changed (Lighthouse, screenshot tolerance)
   - a suppression added (`biome-ignore`, `noqa`, `@ts-expect-error`, `# type: ignore`)

   With auto-merge, loosening a check is the cheapest way to go green.

4. **Tighten only.** Review, or triage reading the issue, may send a PR to the person's merge when it sees security or data risk the rules missed. It must give a reason, which the thread shows. Nothing an agent says lets a PR skip a rule.

Of review's three serious catches, TAS-107 falls under rule 2's auth code and TAS-114 came with a migration. TAS-108 (frontend cache) matches no rule, which is why review stays.

**How the bot merges.** Tastebook's protection becomes two GitHub rulesets on `main`:

- **Checks:** the required checks plus up-to-date. No bypass, the bot included.
- **Review:** one approving review. The factory App (`mb-factory-bot`) is its only bypass actor.

So the bot can merge without an approval but never without green checks, and every other PR stays protected as before. Auto-merge also waits for every check run and status on the head, Vercel's preview checks included. That's the reading the merge gate already uses (core `merge.ts`), and the same bring-up-to-date rules apply. The person makes the protection change, since auto mode blocks Claude from changing it.

Rejected:

- dropping the review rule for everyone
- a second App to approve the first one's PRs
- a raw line cap: most PRs would wait
- whole-folder paths: a third of PRs would wait

### After merging

- **The watch.** For 30 minutes after an auto-merge, the console checks the production deploy succeeded and looks for new Sentry issues.
- **On a problem**, it posts in the item's thread with a **Revert** button, which opens a revert PR and merges it. A revert is low risk, so it auto-merges under the rules above.
- **No automatic revert.**
- **It needs a deploy signal** the console doesn't get today (see the factory backlog's "Spend and deploys"): the App's webhook events or a read-only Vercel token. That's a person's step.

### Keeping it clean

- **A weekly clean-up job** (`cleanup`, Mondays, Sonnet, scope `repo`). It looks for:
  - duplication and dead code
  - tests that test nothing
  - drift from `AGENTS.md`

  It files issues into Triage, as the security and docs jobs do. This is the trade for fewer per-PR gates: drift gets swept weekly instead of blocked per PR.

- **Mutation testing** in that job: Stryker for the frontend and mutmut for the backend, on the week's changed files only. Surviving mutants in new tests become issues.
  - It answers TAS-137, 33 and 111.
  - A coverage floor was rejected: a test that tests nothing still raises coverage.
  - Drop it if the runs are too slow.
- **The promotion ladder.** A rule is enforced at the highest of these steps that fits:
  1. a type or lint rule (Biome GritQL, ruff)
  2. a test
  3. a Claude Code hook
  4. a CI check
  5. prose (a lesson or `AGENTS.md`), only for what nothing above can check

  The clean-up job reads the week's review findings and new lessons, and files an "Enforce …" issue for anything that came up twice.

- **A one-off audit, now.** Each of Tastebook's 36 lessons and about 60 `AGENTS.md` bullets becomes a check, stays as prose, or goes as expired.
  - Some are lint-shaped already: `biome-rejects-aria-listbox-on-list-elements`, `pressed-styles-lose-to-state-variants`, `request-field-defaults-are-required-in-the-schema`.
  - The audit also adds import boundaries: Dino imports no feature, and features don't reach into each other (Biome `noRestrictedImports` or GritQL; `import-linter` for Django).
  - It extends token-only styling from radius to colour, spacing and type.
  - It reads the retired `design-system-rubric` (in git before 4 Nov) for what else can become a check: tokens matching the approved boards, a story per state, keyboard tests, components that know no feature.
  - It's filed as Tastebook issues that go through express, which tests the new track on real work.
- **Fast-feedback hooks in stage runs.**
  - A `PostToolUse` hook runs the project's linter on each edited file and returns the errors to the agent.
  - A `Stop` hook won't let the run end until typecheck and the affected tests pass.
  - The commands are each project's `checks.fast` in `factory.yaml`.
  - The must-never rules live here and in the workflow's allowed tools: no AI attribution, no push to `main`, no edits to workflows outside a PR that the person merges.

### Slimming

- **The four-part shape.** Each agent prompt becomes: the goal, what done looks like, what it may touch, and how it reports.
- **What goes:**
  - IMPORTANT and capitals
  - "be thorough", loops and self-checks
  - anything Claude can read from the repo
- **Rubrics** keep only the project-specific points Claude can't infer.
- **Rules that must always hold** become hooks, allowed tools, lint or CI ([the ladder](#keeping-it-clean)).
- **Target:** the roughly 1,260 lines in `plugin/agents/` and `plugin/skills/` (3 Nov) about halved. **Done 4 Nov:** words 20,605 → 13,825 (33%). What's left is mostly contract with the console (report fields, question and gate formats, wording the router matches). `design.md` was left as it was: design stays unchanged, and its rules are recent lessons. `design-system-rubric` and `verify.md` went.
- **One set of prompts for both tracks.** A track changes only which stages and gates run.

## What each stage assumes

Every stage and gate encodes an assumption about what the model can't do. When a new model ships, check each row against fresh data and cut the stages whose evidence has gone stale.

| Stage or gate | Assumes | Evidence (25 Oct–3 Nov) | Express | Careful |
| --- | --- | --- | --- | --- |
| Triage | An issue needs research, a size and a route before work | 3.5% of cost, never failed | Kept, with the design call | Kept |
| Spec, Spec Review | The model needs a written plan a person approves before coding | 34 of 37 approved unchanged; 18% of cost; 42 minutes on the median | None | Kept |
| Questions before building | Product and approach calls need a person | 12% of spec answers overrode the suggestion, all real product calls; the user values the rest for thinking the feature through (4 Nov) | Kept, asked by implement; infrastructure ones defaulted | Kept |
| Design, Design Review | Taste is human | The user's call; 4% of cycle time | Kept, unchanged | Kept, unchanged |
| Verify | Implement's own tests miss on-screen behaviour | 0 not met in 571 criteria | Removed | Removed |
| Review | A fresh context finds correctness and security bugs the implementer missed | 10 real defects among 54 Blocking (TAS-107, 108, 114) | Narrowed, never asks | Narrowed, may ask |
| Review's questions | A person must settle what review can't | 27 of 48 were about CI or infrastructure; 28% of all cycle time | None | About code only |
| Merge gate | A person catches what review didn't | No PR rejected; 4 substantive asks in 91 PRs | Only by the [rules](#who-merges) | Kept |
| Revise cap (2 rounds) | Loops can run away | Never reached | Kept | Kept |

## Rollout

Four steps, each usable by itself. Each step's work is the factory's own (`mb-factory` isn't a factory project yet), committed to `main` once the user agrees it.

1. **Both tracks get lighter.**
   - Slim the agents and skills to the four-part shape.
   - Remove verify: the stage, router paths, config, card step and `factory-run` fields.
   - Narrow review.
   - Add the stage-run hooks and `checks.fast`.
   - Add the visual summary.

   Done when a careful run on Tastebook goes triage → spec → implement → review with no verify, and the PR and thread show one visual.

2. **The express track, with the person still merging.**
   - Add `track`, the labels and the router's track reading.
   - Remove the spec stage on express.
   - Implement asks the spec's questions before it codes; infrastructure and CI ones take the suggestion.
   - Move the design call to triage.
   - Make express Tastebook's default.

   Done when an express issue reaches Awaiting Merge with no spec, its questions asked by implement before any code, and none about infrastructure. Keeping the person's merge here lets them watch express PRs before letting go.

3. **Auto-merge.**
   - The size, path, safety-net and tighten-only rules.
   - The two rulesets: **the user** changes Tastebook's protection from `gh api` commands Claude writes.
   - The watch after merging and Revert, after **the user** gives the console a deploy signal.
   - The dashboard metrics.

   Done when a low-risk express PR merges itself, and a PR touching a migration waits for the person.

4. **Keeping it clean.**
   - The `cleanup` job with its promotion ladder and mutation testing.
   - The one-off audit of Tastebook's lessons and `AGENTS.md`, filed as express issues.

## Measuring it

- **The baseline** is 25 Oct–3 Nov 2026: Phase 4's dashboard data, frozen when Phase 4 closed.
- **What's recorded:** each work item records its track, so the dashboard can compare the two.
- **New metrics:**
  - **fixes or reverts within 7 days** of a merge: a later PR naming the same issue or reverting it, worked out for the baseline from git
  - **new Sentry issues tied to a PR** through the watch after merging
- **Phase 5's exit criteria:** two weeks of express against the baseline.
  - Cycle time and the person's taps per PR are down.
  - Fixes or reverts within 7 days, and new Sentry issues tied to a PR, are no worse.

## Rejected

- **Scrapping review entirely.** It would have shipped TAS-107, 108 and 114. Review's own run is cheap (2 minutes, about $0.80); the waste was its questions and repeated CI noise, which the narrowing removes.
- **Waiting for the two-week Phase 4 baseline.** Ten days of data was enough. Changing prompts mid-baseline would mix two pipelines.
- **A spec without a gate in express.** The issue is the specification, and the spec costs 18% for a plan nobody changed 92% of the time.
- **Auto-approving design variant A.** Taste is human.
- **Automatic revert.** A person taps Revert; the watch only raises it.
- **A coverage floor.** It rewards tests that test nothing; mutation testing doesn't.

## Still to settle while building

- **Rulesets:** check that a ruleset's bypass actor bypasses only that ruleset's rules (hence two rulesets), and that the bot's merge is still a merge commit co-authored as before. The bot's bypass must never let it push to the default branch, force-push or delete it: `plugin/hooks/guard-bash.sh` refuses those early but reads only the command's text, so GitHub's protection is what holds (security review, 4 Nov).
- **Deploy signal:** the App's webhook events or a read-only Vercel token (the factory backlog's "Spend and deploys").
- **The visual in Slack** (settled 4 Nov): a flow's video goes to Slack as a poster frame linking to it, since an image block plays no video and a GIF is heavy and blurry. Implement chooses and records what to show; an agent-free step builds and uploads it ([How](#changes-in-both-tracks)).
- **Which questions wait:** watch the first weeks of express for infrastructure questions that should have waited, and approach questions that were defaulted. Tune the line in `implement.md`.
- **Mutation testing:** run time on the runner.
- **Backlog items Express made moot** were removed from the plan when Phase 4 closed: triage's `next: verify` and verify on previews; review asking again about an accepted trade-off (TAS-81); review blaming a preview's setup (TAS-95); review reporting `human_decision_needed` with no question (TAS-95); a CI fix started for a failure kept at review (TAS-94).
