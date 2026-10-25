# mb-factory — Plan

A reusable software factory, modelled on [Warp Factories](https://docs.warp.dev/factories), that runs on a Claude **subscription** rather than paid API usage. Work arrives from Linear or Slack, moves through triage → spec → implement → review, and comes back as a pull request for a human to merge.

Demo project: **Tastebook** (recipe hub). The project itself is defined later; the factory comes first.

## Status

_Last updated 2026-10-25._ **Current phase: 1 (First loop, run log and governor).** Phase 0 closed 2026-10-24.

### Done

- Monorepo: `apps/console` (Next.js 16), `packages/core` (config, usage governor, stage machine, webhook verification, secret encryption; Vitest). Tooling: Biome 2.6 + TypeScript 7, Husky + lint-staged, VS Code workspace settings.
- GitHub: <https://github.com/milobedini/mb-factory> (public). Pushes to `main` deploy the console.
- Vercel: project `mb-factory-console` (Hobby, team `milobedinis-projects`), root directory `apps/console`, link at the repo root (`.vercel/`). Console: <https://mb-factory-console.vercel.app>.
- Neon Postgres `mb-factory-db` via the Marketplace. Drizzle schema in `apps/console/db`; tables `events` (one row per delivery), `linear_installations` (tokens AES-256-GCM encrypted), and since 2026-10-25 `work_items`, `runs` (with `prompt` since `0003`), `usage_readings` and `queue`. Their enum values come from `packages/core` (`STAGES`, `RUN_STATUSES`, `PRIORITIES`, …). Migrations: `pnpm --filter @mb-factory/console db:generate` / `db:migrate` (source `apps/console/.env.local` first).
- Linear: workspace "Tastebook", team key **`TAS`**, factory statuses and Triage set up. Agent app `@Tastebook` installed (`actor=app`, `app:assignable`, `app:mentionable`) through `/api/linear/oauth/start`. Delegating an issue records an `AgentSessionEvent` and posts a "Picked this up" thought within 10 s. Tokens refresh automatically (24 h expiry). Test issue: TAS-5.
- Slack: app `@Tastebook` from `projects/tastebook/slack-manifest.yaml`, events verified, channel `#tastebook-factory` (`C0CBSE2Q6FQ`). Mentions are recorded.
- Production env vars: `CONSOLE_URL`, `DATABASE_URL*` (Neon), `TOKEN_ENCRYPTION_KEY`, `LINEAR_CLIENT_ID`, `LINEAR_CLIENT_SECRET`, `LINEAR_WEBHOOK_SECRET`, `LINEAR_ALLOWED_ORGANIZATION_ID`, `SLACK_SIGNING_SECRET`, `SLACK_BOT_TOKEN`, `GITHUB_WEBHOOK_SECRET`.
- Tastebook repo: <https://github.com/milobedini/tastebook> (public). `frontend/` (React 19, Vite 8, TanStack Query, react-router 8, Vitest + MSW 3, Playwright), `backend/` (Django 6.1, DRF, drf-spectacular, Postgres 18 via `compose.yaml`, uv, ruff, pytest), `tools/openapi` (generates `frontend/src/api/schema.d.ts` from `backend/schema.yml`). CI jobs Frontend, Backend, API contract (fails on a stale schema or stale types) and End-to-end, all green. Branch protection on `main`: those four checks, one approving review, resolved conversations, no force pushes; admins can bypass so you can merge your own PRs. `AGENTS.md` (with `CLAUDE.md` importing it), `specs/_template.md`, `specs/lessons/README.md`, PR template. The old 2022 `TasteBook` repo was renamed to `tastebook-ga` and archived.
- Notion: hub page **Tastebook** at the root of the Tastebook teamspace, with Vision (skeleton), PRD template, and the PRDs, Decisions, Weekly factory reports and Run log databases. IDs are in `projects/tastebook/factory.yaml` under `notion`.

### Next (Phase 1)

Phase 0 exit check passed 2026-10-24 (TAS-6). Spike done 2026-10-25 (tastebook PR #1, closed); results under Things learnt.

1. ~~Tables `work_items`, `runs`, `usage_readings`, `queue`.~~ Done 2026-10-25 (migrations `0001`, `0002`).
2. ~~Reusable `.github/workflows/stage.yml` and its caller in `tastebook`.~~ Done 2026-10-25: TAS-7 (page not found) ran end to end, dispatched by hand. tastebook PR #4 merged and TAS-7 went to Done.
3. ~~Router.~~ Done 2026-10-25: TAS-8 (tab titles) went from delegation to tastebook PR #5 with no hand step. See "The router" below.
4. ~~Governor job and local reporter.~~ Done 2026-10-25: the first manual tick released with nothing waiting and no probe, and the status line's first report recorded both windows as `local` (4% and 2%, matching the run readings). The probe path in Actions hasn't run yet; step 6's forced pause exercises it. See "The governor job" below.
5. **Console login and the Usage page: built 2026-10-25, not yet deployed.** Waiting on the GitHub OAuth app and the governor token (below). See "The console login and Usage page" below.
6. Exit check: a real small TAS change through the router, and a forced pause that queues and releases a dispatch. (The first criterion, a small real change landing as a PR with its run recorded, was met by TAS-7 by hand.)

#### Where things stand (2026-10-25)

- **Stage runs work.** The console renders a brief (`buildDispatchPayload` in `packages/core/src/brief.ts`), the project's `.github/workflows/factory.yml` receives a `factory-stage` repository dispatch and calls `milobedini/mb-factory/.github/workflows/stage.yml@main`. That workflow runs `.github/actions/factory-setup` from the project, calls `POST /api/runs/<id>/start` (GitHub OIDC; returns the Linear token and session), runs `claude-code-action` (pinned to commit `925afb5`, v1.0.262) with a thin main thread that spawns `mb-factory:<agent>`, then posts the stage report and the `rate_limit_event`/`result` events to `POST /api/runs/<id>/report`. `summariseRun` in `packages/core/src/run-report.ts` turns that into the run's status, outcome, usage and `usage_readings`.
- **The router is live** (below). First routed run, TAS-8: dispatched 230 ms after the session event; Actions started the run 33 s later; implement on Opus took 86 s, 3 turns, an API-equivalent $0.46, leaving the 5-hour window at 4% and the week at 2%. The session got the "Working on it" thought and the issue moved to Building; `claude[bot]` opened PR #5 with the `factory` label.
- TAS-7's work item (`c74a7e77…`) and run (`11adc1b4…`) were inserted by hand before the router existed.

#### The router (step 3)

Decisions are pure functions in `packages/core/src/router.ts` (tested); `apps/console/lib/router.ts` does the I/O.

- **Trigger:** `AgentSessionEvent` `created` upserts `work_items` by Linear issue ID (a new session replaces the old one), opens the Slack thread, creates an implement run (`delegated`, `feature`, `queued`) and runs it through the governor. `prompted` (a reply in the session) creates an implement run with `trigger: prompted`, priority `in_flight` and the reply in `runs.prompt`, which goes into the brief's `prompt` at dispatch. Phase 1 has no triage.
- **Stop:** the agent doesn't watch for Linear's `stop` signal, so the router handles it: it cancels the work item's queued and active runs (and their Actions runs, which needs Actions write on the token) and posts the final `response` Linear requires.
- **Governor:** `governDispatch` wraps `decideDispatch`. Until the step 4 probe exists, stale or missing readings **fail open** (logged as `governor decided on stale usage readings`); thresholds and the concurrency cap still apply to whatever readings exist. A second run on an issue that already has one going is held as `work_item_busy`. A hold inserts a `queue` row and posts "Queued until <time>: <reason>" (in `factory.yaml` `timeZone`) to Linear and Slack, once per hold.
- **Release:** every run report calls `releaseQueue`, which re-runs the governor on held runs, highest priority first. So concurrency and busy holds release on their own; usage holds release on the next report until step 4's scheduled job calls it too.
- **Dispatch:** claim the run (`queued` → `dispatched`, so a second dispatcher loses), send the repository dispatch, then post "Working on it: implement run started.", reply in Slack and move the issue to `Building` (status names from `factory.yaml`, resolved to IDs on each move; issues in a completed or canceled state stay where they are). A rejected dispatch marks the run `finished`/`failed` and posts a Linear `error`.
- **After the report:** if the run was `finished` and the agent posted no `response`, `error` or `elicitation` since it started, the router posts one (`error` for `failed`/`blocked`). Slack gets the outcome, summary, PR and run log. `limit_hit` creates a resume run (`trigger: rerun`, `in_flight`, parent run set), which the governor holds until the window resets; a resumed run that hits the limit again posts an `error` instead, so a misread window can't loop. An implement run that ends `done` with a PR moves the issue to `Awaiting Merge` (`stageAfterRun`): Phase 1 has no review stage, so the PR is waiting on the human. Phase 2 sends it to In Review instead. Linear's GitHub integration moves it to Done on merge.
- **Config:** `factory.yaml` is bundled into the console as text (a Turbopack `type: 'text'` rule for `*.yaml` in `next.config.ts`) and parsed by core in `apps/console/lib/projects.ts`. Core's tests parse the same file. New fields: `timeZone` (default `UTC`) and `slack.channelId` (`chat.postMessage` needs the ID).
- **Claiming is atomic:** the `queued` → `dispatched` update runs in one Neon HTTP transaction (drizzle `batch`) behind a `pg_advisory_xact_lock`, and only matches while the cap and the one-run-per-issue rule hold. A run that loses the claim goes through the governor once more, which holds it.
- **Known gaps:** removing the delegation doesn't cancel anything yet (Phase 2, with the Issue webhooks).  `work_items.stage` doesn't follow status changes a human makes in Linear (Phase 2, with the Issue webhooks).

`GITHUB_DISPATCH_TOKEN` (production) is a fine-grained token limited to `milobedini/tastebook` with Contents and Actions read and write.

Not yet exercised: holds and release, `prompted`, `stop` (and the Actions cancel), `limit_hit` resume, and the router's own closing activity. Step 6's forced pause covers holds and release.

#### The governor job (step 4)

- **Why so few probes:** usage only grows within a window until it resets, so a stale reading understates usage and a probe can never release a hold early. A probe only matters just before held work is released, to catch usage that grew in the meantime (mostly the user's own). A window past its reset already counts as empty.
- **`.github/workflows/governor.yml`** (this repo, every 15 minutes at :04/:19/:34/:49, or by hand): `POST /api/governor/tick` with `{probed: false}`. The console answers `probe: true` when runs are waiting and a reading is stale (`needsProbe`, by the strictest `staleAfterMinutes` across projects); otherwise it runs `releaseQueue`. On `probe: true` the job installs Claude Code (pinned, 2.1.310), runs one `claude -p` on Haiku with no tools, posts its `rate_limit_event`/`result` events to `POST /api/governor/readings` (recorded as `probe`), then ticks again with `{probed: true}`, which releases even if the probe failed (fail open). Both endpoints accept only a GitHub OIDC token from `governor.yml` on `refs/heads/main` in this repo (`checkGovernorClaims`).
- **Probe cost** (measured 2026-10-25, Claude Code 2.1.310): about 4.4k tokens, nearly all cache, an API-equivalent $0.00075, roughly 1/600 of an implement run. A quiet day probes zero times.
- **Local reporter:** `cli/status-line.sh` wraps your status line command (`ccstatusline`). It sends `rate_limits` from Claude Code's status line input to `POST /api/usage/local` (bearer `USAGE_REPORT_TOKEN`, token file `~/.config/mb-factory/usage-token`), at most every two minutes, in the background; a render still returns in about 0.25 s when the console is unreachable. An unchanged local reading only refreshes its `takenAt`, so the table doesn't grow while you work. It sees Claude Code on this Mac only, not claude.ai chat or other machines.
- **New webhook dispatches still fail open** on stale readings: the console can't run Claude itself. The local reporter keeps readings fresh while you're working, which is when they move.
- Scheduled workflows in a public repo stop after 60 days without repository activity; GitHub emails before it disables them.

Set up 2026-10-25: `CLAUDE_CODE_OAUTH_TOKEN` (Actions secret in this repo), `USAGE_REPORT_TOKEN` (Vercel production, and `~/.config/mb-factory/usage-token`, mode 600), and the status line `command` in `~/.claude/settings.json` (`/Users/milobedini/Documents/git/mb-factory/cli/status-line.sh npx -y ccstatusline@latest`).

#### The console login and Usage page (step 5)

- **Login:** Sign in with GitHub (an OAuth app, no scopes, state and PKCE), allowed only for the GitHub user IDs in `CONSOLE_GITHUB_USER_IDS` (`89992629`, set). IDs, not logins, because a login can be renamed and taken. The console gives the GitHub token back as soon as it knows who signed in. The session is a 30-day HS256 JWT in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie, signed with a key derived from `TOKEN_ENCRYPTION_KEY` (HKDF, purpose `console-session`), so there's no new secret. The allow-list is checked on every read, so removing an ID ends its sessions.
- **No `proxy.ts`:** the Next 16 docs advise against it where there's another way. Every page reads its data through a loader that checks the session first (`loadUsageView` → `requireConsoleUser`), behind `<Suspense>`, and every Server Action checks it again. The static shell holds no data. The API routes keep their own auth (signatures, OIDC, bearer).
- **Usage page (`/usage`):** for each project, the governor state (Open, Throttled, Paused) and both windows as gauges with the throttle, pause and weekly-pace markers, the reset countdown, and the reading's age and source (stale readings in amber). Then the queue, with **Allow once** on runs held by usage or the pause, the **Pause the factory** / **Resume** switch, the last 12 readings, and **Refresh (probe)**.
- **Pause** (`pauses` table, one open row at most): every dispatch holds as `manual_pause` ("Queued: the factory is paused from the console"). The governor job still releases runs someone allowed once, but doesn't probe. Resuming releases the queue straight away.
- **Allow once** sets `runs.usage_override_by`: that run skips usage holds and the pause from then on, but not the run cap or the one-run-per-issue rule, and keeps its configured model (no downshift).
- **Refresh** dispatches `governor.yml` with `probe: true` (`GITHUB_GOVERNOR_TOKEN`); readings arrive about a minute later.
- **Not built (Phase 4):** usage over time with runs overlaid, the factory/you split.

**User actions:**

1. Create a GitHub OAuth app at <https://github.com/settings/applications/new>: name `mb-factory console`, homepage `https://mb-factory-console.vercel.app`, callback `https://mb-factory-console.vercel.app/api/auth/github/callback`, device flow off. Generate a client secret. Then `vercel env add GITHUB_OAUTH_CLIENT_ID production` and `vercel env add GITHUB_OAUTH_CLIENT_SECRET production`.
2. For Refresh: a fine-grained token limited to `milobedini/mb-factory` with **Actions: read and write** only, then `vercel env add GITHUB_GOVERNOR_TOKEN production`. A separate token from `GITHUB_DISPATCH_TOKEN`, so the console can't push to this repo.

#### Open follow-ups (not step 3)

- Evidence hosting for the verify stage (Phase 2): see Open questions.
- Narrower Linear credential for runs, and transcript storage: see Open questions.
- `factory init` must create the `factory` label in GitHub and Linear (both exist for Tastebook now).
- Usage readings in hand-written SQL need `"window"` quoted (reserved word); Drizzle quotes it.

### Things learnt during setup

- Linear's "Agent session events" options appear only after the OAuth app is first saved.
- One Slack mention arrives as both `message` and `app_mention`. Start work only on `app_mention`; use `message` only for replies in a thread that already has a work item.
- Vercel Hobby: crons run at most once a day. The usage probe and queue release run as scheduled GitHub Actions instead.
- Vercel Standard Protection does not cover the production `*.vercel.app` alias: the console is public, so every page checks the GitHub sign-in (step 5).
- pnpm 12 fails installs on unapproved build scripts: list them in `pnpm-workspace.yaml` `allowBuilds`.
- Vercel Marketplace installs add provider agent skills; the Neon one told agents to send feedback silently and was removed. Review any auto-installed skill before committing.
- Linear also offers client-credentials tokens (app actor, ~30 days, no refresh). Candidate for giving Actions runs their own token (Phase 1).
- `openapi-typescript` needs the TypeScript JS API, which TypeScript 7 doesn't ship, and pnpm overrides don't reach peer dependencies. It lives in its own workspace package (`tools/openapi`) with `typescript` aliased to `@typescript/typescript6`, as in the Xelix front end.
- MSW 3 renamed `onUnhandledRequest` to `onUnhandledFrame`. `openapi-fetch` keeps the `fetch` it saw at creation, so the client passes `fetch: (request) => globalThis.fetch(request)` for MSW to intercept it in tests.
- Biome formats YAML. Exclude generated files (`backend/schema.yml`) or the contract check fails. The same goes for `pnpm-lock.yaml`: lint-staged had reformatted it, so every install rewrote the whole file.
- `astral-sh/setup-uv` publishes no major tags: pin the full version (`@v10.3.2`).
- zsh treats `config[url]=…` as a glob: quote bracketed `gh api -f` fields.
- `vercel env update` asks for confirmation even with a value on stdin; pass `--yes`. A hidden secret can't be read back, so rotating means generating a new value and setting it in both places from one shell.
- Reading a secret out of Vercel inside an agent session (even without printing it) is blocked as credential materialisation. Secrets that external services need go in through your own terminal.
- An agent's `skills:` are preloaded only when it runs as a **subagent** (Agent tool), under either `mb-factory:<skill>` or the bare name. Run as the main thread with `--agent`, nothing is preloaded. So a stage run is a thin main thread that hands the brief to the `mb-factory:<stage>` subagent.
- `claude-code-action`: job-level `env` reaches Claude's Bash tool despite the action's own `env:` block, and so does `env` in the `settings` input. `--plugin-dir` in `claude_args` loads the plugin from a clone of this repo. `execution_file` (`$RUNNER_TEMP/claude-execution-output.json`) is a JSON array of the `stream-json` events: `system/init` (agents, skills, plugins), `rate_limit_event` (`rate_limit_info.unifiedWindows.five_hour` / `seven_day`) and `result` (tokens, `total_cost_usd`, `duration_ms`, `num_turns`, `modelUsage`). Run telemetry needs no extra probe.
- `claude-code-action` revokes the Claude App token in its own last step, and skips the App token exchange when the workflow file differs from the default branch's. Use `github_token: ${{ github.token }}` unless the App identity is needed.
- `gh pr comment --attach` rejects `GITHUB_TOKEN` ("unsupported authentication type"), both inside the agent run and in a plain step. The Claude App token is the same kind of installation token, so it is expected to fail the same way (not tested).
- **Stage run design** (2026-10-25): the console dispatches `factory-stage` with `{run_id, model, prompt}` (`buildDispatchPayload` in core). The project's `factory.yml` passes those to `stage.yml`, which checks them, runs the project's optional `.github/actions/factory-setup` composite action, then calls `POST /api/runs/<id>/start` with a GitHub OIDC token (audience: the console URL). The console checks the repository, the stage workflow path, the `repository_dispatch` event and the run's status, records the Actions run, and returns a Linear token valid for at least 90 minutes. Nothing secret travels in the public dispatch payload, and there is no shared secret. The agent never sees the OIDC request variables (the action removes them). `POST /api/runs/<id>/report` uses a fresh OIDC token bound to the same Actions run.
- First stage run (TAS-7, 2026-10-25): the Claude App token exchange works from a reusable workflow called by a `repository_dispatch` caller on `main`. Pushes and the PR come from `claude[bot]` and trigger CI. Implement on Opus took about 2 minutes, an API-equivalent $0.52, and 2% of each usage window. The agent's final `response` reached the Linear session.
- A project needs a `factory` label in both its GitHub repo and its Linear team before the first run; `factory init` should create them.
- The Linear connector acts as the user, so status changes made through it appear under the user's name.
- Linear `AgentSessionEvent` `prompted`: the docs name `agentActivity.body`, but the delivered activity (as on `created`) carries `content: { type: "prompt", body }`; the router reads both. A stop arrives as `prompted` with `agentActivity.signal: "stop"`.
- Linear activity filters: `AgentActivityFilter.type` compares the content type (`response`, `error`, `elicitation`, …), and `createdAt.gte` takes a `DateTimeOrDuration` (an ISO string works). Checked against the `@linear/sdk` schema.
- Turbopack has no built-in raw import, but a rule with `type: 'text'` turns a file into a string module. The monorepo root (found from the pnpm lockfile) lets the console import `projects/*/factory.yaml` from outside `apps/console`.
- Linear `agentSessionUpdate(id: String!, input: AgentSessionUpdateInput!)`: `plan` replaces the whole plan, items `{content, status}` with status `pending`, `inProgress`, `completed` or `canceled`; `addedExternalUrls` takes `{label, url}`. `linear.py` matches.

## Decisions

| Area            | Decision                                                                                                                                                                                                                                       |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude plan     | Max 20x                                                                                                                                                                                                                                        |
| Tracker         | Linear, using its Agents API: the factory is an app user (`@Tastebook`). The user is a workspace admin                                                                                                                                         |
| Chat            | Slack app; the factory's handle and the threads it reports back to. The user is a workspace admin                                                                                                                                              |
| Docs            | Notion for vision, PRDs, decision records and weekly factory reports; tech specs live in the repo                                                                                                                                              |
| Stage runner    | GitHub Actions + `anthropics/claude-code-action@v1` using `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`)                                                                                                                                |
| Scheduled loops | Claude Code cloud scheduled tasks (formerly Routines), using the claude.ai Linear/Notion/Slack connectors. They are **API-triggered by the console's cron**, not by a schedule trigger, so every factory run passes through the usage governor |
| Usage governor  | The console reads the 5-hour and weekly usage before every dispatch and holds, throttles or queues work against the policy in `factory.yaml`                                                                                                   |
| Console         | One Next.js app on Vercel: webhook routes (the router) and the factory dashboard                                                                                                                                                               |
| Factory data    | Postgres from the Vercel Marketplace: work items, runs, events, scores                                                                                                                                                                         |
| Repos           | `mb-factory` (this repo) and `tastebook`, both **public** (unlimited Actions minutes)                                                                                                                                                          |
| Tastebook stack | A lighter version of the Xelix stack in one repo: `frontend/` (React 19, Vite, TanStack Query, react-router, Biome, Vitest, MSW, Playwright) and `backend/` (Django, DRF, Postgres, uv, ruff, pytest, drf-spectacular → typed client)          |

## Concepts mapped from Warp

| Warp                                      | mb-factory                                                                                                                             |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Work item                                 | Linear issue: the durable record. Every stage writes its findings to it                                                                |
| Foreman                                   | Split in two. The **router** handles deterministic routing on Linear state and events; the **stage agents** handle judgement           |
| Foreman's conversation                    | Linear agent session (activities, plan checklist, `externalUrls`) mirrored to the Slack thread                                         |
| Triage / Spec / Implement / Review agents | Claude Code subagent and skill definitions in the factory **plugin**, one GitHub Actions run per stage                                 |
| Checkpoints                               | Spec Review and Awaiting Merge statuses (human only); merging is enforced by branch protection                                         |
| Questions to humans                       | Linear `elicitation` activity, which puts the session in `awaitingInput`; the reply triggers `prompted`, which re-runs the stage       |
| Factory-as-code                           | `factory.yaml` per project, plus the plugin (agents, skills) and reusable workflows in this repo                                       |
| Automations                               | Router rules (events → stage) + cloud scheduled tasks                                                                                  |
| Runners                                   | GitHub-hosted runners (free on public repos); your Mac as an optional self-hosted runner                                               |
| Dashboard, Runs, Inbox                    | Factory console (see [Factory console](#factory-console))                                                                              |
| Scorers / Self-improvement / Benchmarks   | Scheduled LLM-judge scorers, PRs that improve the plugin's own prompts and skills, and a fixed task suite rerun against config changes |

## Architecture

```text
 Slack @Tastebook ──┐                                    ┌─► Linear agent session + issue updates
 Linear agent event ┼─► Console /api (Next.js, Vercel) ──┼─► GitHub repository_dispatch → stage workflow
 GitHub webhook ────┘    • verify signatures             │     (claude-code-action, plugin agents/skills)
                         • ack Linear < 5s, thought < 10s├─► Slack thread replies
                         • stage state machine, WIP cap  └─► Postgres: work items, runs, events, scores
                         • refresh Linear app token → pass to run (masked)
                                         ▲
 Stage workflow end ── run report (usage, duration, outcome) ─┘

 Cloud scheduled tasks: health check · dependency audit · docs drift · backlog grooming · scorers
```

The router logic lives in a framework-agnostic `core` package, so the Next.js route handlers stay thin and the logic can be tested on its own.

### Principles

- **Stateless stages.** Each run rebuilds its context from the Linear issue, its comments, the linked PR and the branch. Nothing depends on session memory.
- **Briefs, not rediscovery.** Each stage records its findings and references on the issue so the next stage doesn't have to collect them again (Warp's triage rule).
- **One voice.** Only the router and foreman layer talk to humans; stage agents report to the issue and session.
- **Humans merge.** Branch protection on `main`; agents never merge.
- **Capped loops.** Review → revise runs at most twice, then hands to a human.
- **Usage-aware.** Plan limits (5-hour and weekly) are the real constraint, and the factory shares them with your own Claude use. Every dispatch goes through the [usage governor](#usage-governor).
- **Measure from day one.** Every run is recorded from Phase 1, so later changes have a baseline to compare against.
- **Public-repo hygiene.** Issue, PR and comment text is data, not instructions (as in Warp's reviewer prompt). Only Linear workspace members and allow-listed Slack users can start work. Secrets stay in Actions and Vercel, never in run payloads that aren't masked.

### Work structure in Linear

Linear has no "epic" type. A **project** plays that role.

| Linear                 | Used for                                                    | Factory role                                                   |
| ---------------------- | ----------------------------------------------------------- | -------------------------------------------------------------- |
| Initiative             | A goal spanning projects (e.g. "Tastebook MVP")             | None; for your planning                                        |
| **Project** (= epic)   | A deliverable with a PRD (in Notion, linked) and milestones | Sliced into issues by the slice step                           |
| Milestone              | A checkpoint inside a project                               | Slices are grouped under them                                  |
| **Issue**              | One PR-sized slice (one ticket = one PR)                    | The work item the pipeline runs on                             |
| Sub-issue              | Rare: only when a slice can't stand alone                   | Treated like an issue                                          |
| Relations (blocked by) | Order between slices                                        | The router won't dispatch an issue until its blockers are Done |
| Triage inbox           | Incoming issues from Slack, scheduled loops and others      | You accept or decline before anything is delegated             |

**Slicing a project:**

1. You write or link the PRD on the project.
2. You create a "Slice <project>" issue in it and delegate it to `@Tastebook`.
3. The triage agent, using the mb-slice rules, posts the risks and the proposed slices as one elicitation.
4. When you approve, it creates the issues with milestones and blocked-by relations, undelegated.
5. You delegate them, one at a time or "delegate all" in the session. The governor and the dependencies decide the order they run in.

### Linear workflow (Tastebook team)

`Triage inbox → Backlog / Todo (yours) → Researching → Spec → Spec Review (you) → Building → In Review → Awaiting Merge (you) → Done`, plus `Canceled`.
Delegating an issue to `@Tastebook` is the gate that starts work; issues that aren't delegated are never touched. Questions use `awaitingInput` on the session, not a status.

### Starting and taking over work

**Give the factory work:**

- **Linear:** create an issue (or pick one from the backlog) and delegate it to `@Tastebook`, or mention `@Tastebook` in a comment with an instruction ("address the review comments").
- **Slack:** mention `@Tastebook` in a channel or DM. It files the issue and replies in the thread.
- **Local Claude Code:** a `/factory` skill that creates and delegates an issue from your terminal, using the Linear MCP. This is the equivalent of Warp's Factory MCP.
- **Console:** re-run or cancel a stage.

**Do it yourself:**

- **From the start:** assign the issue to yourself and don't delegate it. The factory ignores it, and the console still counts it for cycle time.
- **Mid-flight:** remove the delegation. The router cancels any running stage, and you check out the issue's branch and work locally (your mb-skills still work there). Pushes you make to a factory PR count against autonomy, as in Warp.
- **Hand back:** delegate again with a comment saying what you did and what's left. The factory continues from the branch's current state.

### Specs

Each spec is committed as `specs/<ISSUE-ID>.md` in a draft PR; implementation continues on that branch and PR. Lessons learned go in `specs/lessons/`, and agent rules in `AGENTS.md` / `CLAUDE.md` (the same convention as the Xelix repos). Template: Summary, Product behaviour, Technical design, Decisions, Assumptions, Out of scope, Validation criteria.

## Instructions and conventions

Every behaviour you'd want to tune is a Markdown file under version control. Changes go through a PR to this repo (factory-as-code). Later, self-improvement proposes changes the same way.

| Layer                | Where                                                                                                                      | Examples                                                                                                                                              |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Factory defaults  | `plugin/agents/*.md`, `plugin/skills/*/SKILL.md`                                                                           | How triage researches and sizes; when a spec is needed; the review rubric and severities; how agents report to Linear and Slack                       |
| 2. Project overrides | `projects/<name>/instructions/<agent>.md` (appended to the default) and `factory.yaml` knobs                               | Tastebook-specific triage rules, gates on/off, review loop cap, models, labels                                                                        |
| 3. Repo conventions  | In the project repo: `AGENTS.md` / `CLAUDE.md`, `.github/pull_request_template.md`, `specs/_template.md`, `specs/lessons/` | Code rules, PR format, spec format, commit style. Agents always prefer these over defaults (as Warp's implement agent prefers the repo's PR template) |
| 4. Tracker templates | Linear issue templates                                                                                                     | Bug and feature issue shape that triage fills in                                                                                                      |

Seeded from Warp's default agent prompts (for orchestration and handoffs), your global `CLAUDE.md`, the Xelix `AGENTS.md` / `specs/` conventions, `lint-environment`, and **mb-skills** (for the substance of each stage).

### From mb-skills

These are slimmer, project-agnostic forks. mb-skills itself stays as it is for Xelix work. What gets dropped everywhere: HTML review pages, overlays, `pbcopy`, `~/plans` and `~/builds` files, local stack and org-picking scripts, Shortcut wiring, and Xelix/Lexi/Panda specifics (those move to each project's `AGENTS.md`).

| mb-skills                                         | Becomes                                                 | Keep                                                                                                                                                                                                                | Change                                                                                                                                  |
| ------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `_mb-shared/ground-rules.md`                      | `skills/ground-rules` (read by spec, implement, review) | The five questions, Design and Code smells, tautology-test rules                                                                                                                                                    | Framework-specific bullets move to the project's `AGENTS.md`                                                                            |
| `_mb-shared/git-text.md`                          | `skills/git-text`                                       | Commit, PR title and PR description rules, the Decisions block, the Evidence section, British English, no AI attribution                                                                                            | `sc-NNNNN` → Linear IDs (`TAS-123`, magic words for linking); evidence uploaded from CI rather than local `gh --attach`                  |
| `_mb-shared/house-notes.md`                       | `specs/lessons/` in each project + `skills/lessons`     | The entry format (Applies to, Rule, Why, Re-check by) and the expiry of project facts                                                                                                                               | Agents propose entries in their PRs; self-improvement curates them                                                                      |
| House note "every question carries a default fix" | Rule for every Linear elicitation                       | "<issue>. Suggest: <fix>. Going with that unless someone objects."                                                                                                                                                  | Gates still need an explicit answer; auto-proceed on silence is a per-gate option, off by default                                       |
| `mb-slice`                                        | **Triage** agent (and epic slicing for Linear projects) | Risks before slices, one ticket = one PR, vertical slices, size floor and ceiling, "keep it as one" is valid                                                                                                        | Writes Linear issues directly, but only after the spec or slicing gate                                                                  |
| `mb-plan` + `plan-template.md`                    | **Spec** agent → `specs/<ID>.md` in the draft PR        | Required reading, one behaviour per acceptance criterion, Design rationale with `Asked:`, Blast radius, Not changing, steps with `Done when:`, tests with `asserts:`, Evidence (feature, bug or chore), Assumptions | Questions go through Linear in one batch; only GitHub-renderable exhibits (`mermaid`, `diff`, `ts`)                                     |
| `mb-build` + `build-log-template.md`              | **Implement** agent                                     | Drift check, bug path (failing test first, on unchanged code), mechanical vs design deviations, the 3-attempts rule, commit discipline, evidence rules                                                              | No "ship it" step (the factory's gates take its place); the build log becomes the PR description, the Linear session and the run record |
| `mb-review` + `scan_bypasses.py`                  | **Review** agent + a deterministic pre-review check     | Spec and Standards as separate axes; Blocking, Should fix, Nit (max 5) and Could cut; `Ref:` on every finding; suggestion blocks; tone rules; don't re-run CI; the bypass scanner                                   | Reports to the router; only findings that need a human are posted, as comments, never as an approval                                    |
| `mb-testing-plan`                                 | **Announce** stage after merge or deploy (Phase 3–4)    | The "ready to test" Slack post: what it is, where it's live, what to check, known limitations                                                                                                                       | Triggered by merge or deploy, not run by hand                                                                                           |
| `mb-clean`, `feature-flag-fe`                     | Not carried over                                        | —                                                                                                                                                                                                                   | A scheduled clean-up of stale branches and sessions later, if needed                                                                    |

**Default on attribution:** factory commits, PRs and comments carry **no AI attribution**, as in your global rules. Traceability comes from a `factory` label and the console's run records, which the autonomy metric needs anyway.

**Instruction review:** at the end of Phase 0, you review and edit the drafts before the first live run. You can keep changing them at any point after that.

## Usage governor

The factory runs on the same Max 20x limits as your own Claude Code, claude.ai chat and cloud sessions. Without a governor it could use up your 5-hour window mid-afternoon or your weekly allowance by Wednesday.

### Reading usage

| Source             | What it gives                                                                                                                                                                                                                      | When                                                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Run telemetry**  | `rate_limit_event` in Claude Code's `stream-json` output: `unifiedWindows.five_hour` / `seven_day` with `utilization` (0–1), `resetsAt` (epoch seconds), `status` (`allowed` / `allowed_warning` / `rejected`), and overage status | Every stage run reports its last reading to the console                                                        |
| **Probe**          | A tiny headless call (`claude -p` with the cheapest model, `--output-format stream-json`) from a scheduled GitHub Actions job using the subscription token                                                                         | Every ~15 min, and before an expensive dispatch if the latest reading is stale                                 |
| **Local reporter** | Your Mac's Claude Code status line script receives `rate_limits.five_hour` / `seven_day` (`used_percentage`, `resets_at`) and sends them to the console                                                                            | Whenever you use Claude Code interactively. This also measures your own usage, which competes with the factory |
| **Estimate**       | Tokens per run from the `runs` table, used to project usage between readings                                                                                                                                                       | Continuously                                                                                                   |

Verified on 2026-10-24 (Claude Code 2.1.310): a headless call returned both windows with `utilization` while `status` was `allowed`, and overage `rejected` (overage disabled). Fields for the status line are documented officially; the `stream-json` event is not documented, so the console reads it defensively and records which source each reading came from.

### Policy (`factory.yaml`)

```yaml
usage:
  fiveHour:
    throttleAt: 0.60 # only continue in-flight work (review/revise, answers to questions)
    pauseAt: 0.80 # nothing new dispatches; leaves headroom for you
  sevenDay:
    pacing: true # allowed use ≈ share of the week elapsed + slack
    slack: 0.10
    pauseAt: 0.85
  staleAfterMinutes: 20 # probe before dispatching if the latest reading is older
  downshift: # when throttled, swap to cheaper models
    triage: haiku
    review: sonnet
```

Work priority, from highest to lowest: `urgent`, `in_flight`, `feature`, `scheduled`. The headroom above `pauseAt` is left for you. The decision logic is in `packages/core/src/governor.ts`.

### Behaviour

- **Open:** dispatch normally.
- **Throttled:** only in-flight work and `urgent` items; cheaper models; scheduled loops are skipped.
- **Paused:** nothing dispatches. Each held item gets a Linear session update ("Queued until 11:30, usage limit") and moves to the console's queue. A console cron re-checks and releases work, highest priority first, once the window resets.
- **Rejected mid-run:** the run is marked `limit_hit`, its branch is pushed, and the stage is queued to resume after `resetsAt`.
- **Concurrency cap:** a maximum number of runs at once (default 2), separate from the thresholds.
- **Manual controls:** pause/resume and "allow this one run anyway".
- **No overage:** usage credits stay off, so the factory can never spend beyond the plan.

## Factory console

A web app for the factory, matching Warp's dashboard, Runs page and Inbox.

### Data model

| Table            | Holds                                                                                                                                           | Source                                  |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `work_items`     | Linear issue, project, requester, origin (Slack thread or Linear), current stage, PR(s)                                                         | Router                                  |
| `runs`           | Stage, agent, model, trigger, status, start/end, Actions run URL, transcript artifact, tokens, API-equivalent cost, Actions minutes, parent run | Dispatch + run report from the workflow |
| `events`         | Every webhook and stage transition with timestamps (Linear status changes, PR opened/reviewed/merged, human pushes)                             | Router                                  |
| `scores`         | Scorer, run, label, score, reasoning                                                                                                            | Scorer task                             |
| `improvements`   | Self-improvement PRs and the failing runs they address                                                                                          | Self-improvement task                   |
| `usage_readings` | Window, utilisation, resets at, status, source (run, probe, local, estimate), taken at                                                          | Run reports, probe, local reporter      |
| `queue`          | Held dispatches with priority, reason and earliest release time                                                                                 | Governor                                |

**Cost on a subscription:** there is no billed cost per run. `claude-code-action` reports token usage and an **API-equivalent cost**, so we track that, plus Actions minutes and the share of the 5-hour and weekly limits used. It works as a comparison metric, as Warp's cost per PR does ("not a billing figure").

### Pages

- **Dashboard** (for a chosen date range):
  - **Autonomy:** share of merged PRs with no human-pushed commits.
  - **PR cycle time:** median, with a median per stage, and human wait time at the gates broken out.
  - **PRs opened vs merged.**
  - **Run breakdown:** by stage, status, model and trigger.
  - **Usage per PR:** tokens, API-equivalent cost, Actions minutes, by PR size (S/M/L/XL).
  - **Most expensive work items.**
  - **Review loop count** and **first-pass acceptance rate**.
  - **Scorer cards** and the latest **self-improvement PRs**.
- **Usage:**
  - Gauges for the 5-hour and weekly windows, with reset countdowns, reading freshness and source.
  - Governor state (Open / Throttled / Paused) and the policy thresholds.
  - Usage over time, with factory runs overlaid, and a weekly pacing line.
  - Estimated split between the factory and your own use.
  - The queue of held work, with pause/resume and "allow once" controls.
- **Runs:** runs grouped by work item, with a timeline, links to the Actions log, transcript, Linear session and PR. Actions: re-run a stage, cancel, score now, turn into a benchmark task.
- **Inbox:** everything waiting on you, across projects: open questions, spec reviews, PR reviews, failed or blocked runs. Items clear automatically when they're resolved.
- **Factory:** read-only view of each project's `factory.yaml`, the plugin's agents and skills, WIP limits, and the pause switch.
- **Scorers / Benchmarks:** scorer definitions and results; benchmark suites comparing model and config choices.

**Known gap compared with Warp:** you can't steer a GitHub Actions run live the way Warp's "View session" lets you. The equivalents are reading the transcript afterwards and replying in the Linear session or Slack thread, which re-runs the stage.

Notion receives a **weekly factory report** generated from this data. Notion is not the store for it.

## Repository layout (proposed)

```text
mb-factory/
  docs/                      plan, architecture, runbooks
  packages/core/             state machine, dispatch, Linear/Slack/GitHub clients, metrics queries
  apps/console/              Next.js on Vercel: /api webhooks (router) + dashboard UI
  plugin/                    Claude Code plugin (installed into project runs)
    agents/                  triage.md, spec.md, implement.md, review.md, verify.md
    skills/                  linear, slack-report, github-pr, code-review rubric, ui-verification, spec-writing
  .github/workflows/stage.yml  reusable stage workflow called from project repos (GitHub only allows them under .github/workflows)
  cli/                       `factory init` / `factory doctor` for onboarding a project
  projects/tastebook/        factory.yaml (repos, Linear team/status IDs, Slack channel, Notion IDs, models, limits)
```

## Phases

| #   | Phase                                                                                                                                                                                                                                                                                              | Exit criteria                                                                                                                            |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | **Foundations**: monorepo skeleton; console deployed with webhook endpoints and DB; Linear team, statuses and agent OAuth app; Slack app; Notion workspace pages; `tastebook` repo with a minimal full-stack starter, CI and branch protection; draft all agent instructions, skills and templates | A hello-world issue can be delegated to `@Tastebook`; the console records the event; you've reviewed and signed off the instructions     |
| 1   | **First loop, run log and governor**: delegate → implement run → PR → Linear session and Slack updates; every run writes to `runs` and `events`; probe + basic thresholds + Usage page                                                                                                             | A small real change lands as a PR; its run appears with usage and duration; a forced "paused" state queues and later releases a dispatch |
| 2   | **All stages and the Runs page**: triage, spec + approval gate, review loop (max 2), merge → Done; Runs page with timeline                                                                                                                                                                         | A medium feature goes end to end with one spec approval and one merge, fully traceable in the console                                    |
| 3   | **Slack intake, questions and Inbox**: mention creates an issue; elicitations relayed in the thread; Inbox page                                                                                                                                                                                    | Work started in Slack finishes in Slack; pending questions show in the Inbox                                                             |
| 4   | **Dashboard and scheduled loops**: dashboard metrics; health, dependency, docs-drift and grooming loops, triggered through the governor; weekly pacing, priorities, model downshift, local status-line reporter                                                                                    | The dashboard shows a two-week baseline; loops file well-formed issues                                                                   |
| 5   | **Scorers, self-improvement and benchmarks**: scorer task, self-improvement PRs on the plugin, a benchmark suite, weekly Notion report                                                                                                                                                             | At least one accepted self-improvement PR; one benchmarked config change                                                                 |
| 6   | **Reusability**: `factory init` onboards a second project                                                                                                                                                                                                                                          | A second repo runs through the factory with config only                                                                                  |

## Open questions

- Stage run credentials: the agent holds the Linear app token for the whole workspace (valid up to 24 h), because it reports through `linear.py`. A prompt-injected agent could misuse it in the Tastebook workspace. Narrower option: proxy Linear calls through the console with a per-run token limited to the run's session and issue. Also, the agent shares the runner with the report step, so it could rewrite the execution file and understate usage. Readings are capped at 1 and dropped when their reset time is implausible; probe readings remain the ground truth.
- Transcripts: artifacts on a public repo can be downloaded by any signed-in GitHub user, and a transcript can hold tool output, so runs don't upload one yet. Options: private Vercel Blob written by the report step, or a trimmed transcript in Postgres.
- Usage readings: confirm the probe's utilisation figures against `/usage`. (Run telemetry is settled: `execution_file` includes `rate_limit_event`.)
- Evidence hosting from CI (needed by the verify stage, Phase 2): `gh --attach` with `GITHUB_TOKEN` failed (2026-10-25). Remaining options in the agreed order: (2) a classic token as an Actions secret used only in a separate, agent-free upload step, (3) Vercel Blob.
- Tastebook hosting (Vercel for the frontend; backend host to be decided) and preview environments for verification.

## References

- Warp Factories docs and [warp-factory-examples](https://github.com/warpdotdev/warp-factory-examples) (default agent prompts in `00-warp-default-agents`)
- [Building a software factory](https://www.piersonmarks.com/posts/building-a-software-factory) (Pierson Marks)
- Claude Code: [cloud scheduled tasks](https://code.claude.com/docs/en/routines), [GitHub Actions](https://code.claude.com/docs/en/github-actions), [Projects](https://code.claude.com/docs/en/claude-projects)
- Linear: [Agents API](https://linear.app/developers/agents), [agent interaction](https://linear.app/developers/agent-interaction)
- [Agent SDK and claude -p on Claude plans](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)
