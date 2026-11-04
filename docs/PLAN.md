# mb-factory — Plan

A reusable software factory, modelled on [Warp Factories](https://docs.warp.dev/factories), that runs on a Claude **subscription** rather than paid API usage. Work arrives from Linear or Slack, moves through triage → spec → (design) → implement → review, and comes back as a pull request for a human to merge. Phase 5 adds an agent-first **express** track that skips the spec (implement still asks its questions), and merges low-risk PRs itself, and lightens both tracks: [docs/express.md](express.md).

Demo project: **Tastebook** (a household recipe hub), live at <https://tastebook.dev>.

## Where things stand

This plan holds direction, decisions and what was learnt. It doesn't track work: read the platforms for that.

- **Issues and their status:** Linear, team `TAS` (projects, the Triage inbox, the Ready list via `/tastebook ready`).
- **Runs:** the Slack threads in `#tastebook-factory` (`C0CBSE2Q6FQ`) and the console's Runs, Inbox and Usage pages (<https://mb-factory-console.vercel.app>).
- **What changed and when:** `git log` here and in `tastebook`.

**Phase:** 5 (Express, [docs/express.md](express.md)); Phase 4 closed on 3 Nov 2026 with its baseline frozen early (25 Oct–3 Nov) so Express could start at once. Exit: two weeks of express against that baseline, with cycle time and the person's taps per PR down, and fixes or reverts within 7 days and new Sentry issues tied to a PR no worse.

**Next:** once [TAS-155](https://linear.app/tastebook/issue/TAS-155) (Stryker and mutmut commands and a timed manual workflow) merges, have the clean-up job run them on the week's changed files and file surviving mutants as `empty-test` findings ([docs/express.md](express.md#keeping-it-clean)); the audit's checks (TAS-156 to 167) wait for the user to delegate.

**Direction, in order:** Express (Phase 5) in its four steps, each the base for later factory changes, while Tastebook's Dino project and Accounts and households' slices (sliced 29 Oct; those that need design go through the design stage) keep running through the factory as the steps land; onboard `mb-factory` as a project (agreed 3 Nov: self-improvement PRs then go through the factory's own stages, and health findings arrive as triaged issues); then Phase 6. The [factory backlog](#factory-backlog) holds smaller factory work to pick from.

## Decisions

| Area            | Decision |
| --------------- | -------- |
| Claude plan     | Ultra (Max 20x until the rename of 30 Oct 2026): a weekly limit only, as verified Ultra accounts have no 5-hour session limit. Usage credits stay off, so the factory can never spend beyond the plan |
| Tracker         | Linear, using its Agents API: the factory is an app user (`@Tastebook`). The user is a workspace admin |
| Chat            | A Slack app per project: the factory's handle, a card per work item, the App Home and `/tastebook` |
| Docs            | Linear documents for the Vision (team document) and PRDs (a "<Project> PRD" document on each project), since stage runs read Linear; engineering and design decisions in the project repo (`AGENTS.md`, `GLOSSARY.md`, `docs/architecture.md`, `docs/design.md`); tech specs in `specs/`; the factory's own decisions here. Notion was dropped on 26 Oct 2026 (agents can't read it) |
| Stage runner    | GitHub Actions + `anthropics/claude-code-action` using `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`), as the factory's own GitHub App (`mb-factory-bot`) |
| Scheduled loops | Jobs in `factory.yaml`, fired by the console's scheduler and run as stage runs, so every factory run passes through the usage governor |
| Usage governor  | The console reads the weekly usage before every dispatch and holds, throttles or queues work against the policy in the root `factory.yaml`, shared by every project |
| Console         | One Next.js app on Vercel: webhook routes (the router), the scheduler and the console pages |
| Factory data    | Neon Postgres (`mb-factory-db`) from the Vercel Marketplace |
| Repos           | `mb-factory` (this repo) and `tastebook`, both **public** (unlimited Actions minutes) |
| Tastebook stack | `frontend/` (React 19, Vite, TanStack Query, react-router, Tailwind and shadcn/ui, Biome, Vitest, MSW, Playwright) and `backend/` (Django, DRF, Postgres, uv, ruff, pytest, drf-spectacular → typed client), both on Vercel as two services |

### Decisions and why

Choices whose reasons aren't in the code. Where the code says why, it isn't repeated here.

**Express (agreed 3 Nov 2026; why, evidence, research and rollout in [docs/express.md](express.md))**

- **Two tracks:** `track: express | careful` per project in `factory.yaml`, overridden per issue by the Linear labels `express` and `careful`; Tastebook's default is express. The router reads the track at each next step. Both share one slimmed set of prompts: a track only changes which stages and gates run.
- **Express:** triage (which also makes the design call) → design and Design Review when needed, unchanged ("taste is human") → implement → review → merge. No spec and no Spec Review (34 of 37 specs were approved unchanged); implement asks the spec's questions (product and approach) before coding and waits, since the user wants them to think the feature through (4 Nov); infrastructure questions take the suggested answer and say so in the thread; review never asks.
- **Both tracks:** verify goes (0 of 571 criteria not met); review is narrowed to correctness and security against the issue, never repeats a failing check or a preview and drops nits (it caught TAS-107, 108 and 114, but 41% of its Blocking findings repeated a failed check and its questions were 28% of cycle time); one visual per UI PR in the PR and the Slack thread replaces the evidence rules; agents take a four-part shape (goal, done, what it may touch, report) and rules that must always hold move to hooks, lint and CI.
- **Who merges in express:** the factory merges once every check passes, unless the PR changes over 400 source lines or 20 source files (generated files, data, docs, tests and baselines excluded), touches a risky path (`express.merge.humanMerge` globs), weakens the safety net (tests deleted or skipped, test or lint config, thresholds, suppressions), or an agent sends it to the person with a reason (agents tighten, never loosen). The bot merges through two rulesets: checks with no bypass, and the review rule that only `mb-factory-bot` may bypass. A 30-minute watch after each auto-merge offers Revert on a failed deploy or a new Sentry issue.
- **How the track is read** (built 4 Nov, step 2): the console reads the issue's labels from Linear when a run starts (with the assignee, in one query) and after triage, never from the webhook, whose label fields Linear doesn't document. The track goes in the brief and on the work item (`work_items.track`, for the dashboard). With both labels, careful wins. Only triage's next step and the agents' own behaviour depend on it.
- **Express in the code:** triage's `next: spec` becomes implement, or design first when triage's `design` call says needed. Implement's questions before coding are ordinary `questions`, so the router's question flow is unchanged. Review files Should fix findings in its report's `issues`, which the console files in Triage as for a person's request, marked as review's. An express design hand-off with no spec branch starts a new branch, always named `<issue-id>-<slug>` by the console (never Linear's per-person suggestion) and refused if it exists, and implement builds on it. Back to spec at Design Review still starts a spec: it tightens.
- **Against drift:** a weekly `cleanup` job (with mutation testing on the week's changes) and a promotion ladder that turns repeated findings and lessons into lint rules, tests, hooks or CI before prose.

**Runs and stages**

- **Models:** spec and implement on Opus; review on Opus because it's adversarial against the project's standards (Sonnet was too lenient; about $0.80 a review against $0.19), downshifting to Sonnet when throttled; triage on Sonnet, but slicing on Opus (`models.slicing`); ask and size runs on Sonnet.
- **Slicing is chosen by title alone** (`Slice ` and a word, the user's choice). If an ordinary issue ever misfires, match `Slice <the issue's own project>`.
- **Every issue has a size, and only sized issues are ready** (the user: "stuff should always have a size"). Whoever files an issue sizes it; triage may correct it; an issue a person accepts unsized gets a size run.
- **A split's later parts stay on the tap:** each part is offered with a Delegate button once the one before it merges, never delegated by the factory.
- **Verify was removed on 4 Nov 2026** (Express step 1; 0 of 571 criteria not met). Past runs keep the `verify` agent role. `stage.yml`'s evidence job and the Blob store now serve implement's one visual (4 Nov).
- **Evidence:** a public Blob store per project (`tastebook-evidence`, connected to no project), uploaded by an agent-free job. `GITHUB_DISPATCH_TOKEN`, the console's GitHub token (dispatching runs, cancelling and re-running Actions jobs, committing the design hand-off), is a fine-grained personal token with Contents and Actions read and write, Tastebook only. `EVIDENCE_ATTACH_TOKEN` is a fine-grained personal token (contents and pull requests, Tastebook only) so the walkthrough plays in the PR; chosen over an animated GIF.
- **The factory takes on Dependabot majors and failing updates by itself** (the project's `dependabot.yml` counts as the authorisation); clean grouped PRs are left to the user; nothing auto-merges (express's auto-merge always leaves dependency majors to the person).
- **Fix limits, label names and run timeouts stay hardcoded** until a project wants other values (Phase 7).

**Review and merge**

- **Humans merge** (in express from step 3, only PRs the [rules](express.md#who-merges) send them). The user approves factory PRs as a reviewer or taps Approve and merge; the admin bypass is only for PRs the user opens; the review agent never approves and never posts a commit status (offered, declined).
- **The factory's own merge** (4 Nov, Express step 3; details in [docs/express.md](express.md#rollout)): two rulesets replaced Tastebook's branch protection, Checks (the four checks, up to date, conversations resolved; no bypass, so admins lost theirs) and Review (one approval; bypassed by `mb-factory-bot` and the repo's admins, keeping the user's GitHub merge). The console holds the App's key and mints a repo-scoped token, chosen over a merge workflow (no Actions start-up, no new workflow). Review's `beforeMerging` note and findings left to choose also send a PR to the person, since nobody would see them otherwise. Revert merges itself skipping the rules, pinned to GitHub's revert commit, and only for a merge the factory watched.
- **Express metrics** (4 Nov, [canvas](https://claude.ai/artifact/KdkSQZHd2KFF7i7mksYWdu), definitions in [docs/express.md](express.md#measuring-it)): an "Express against the baseline" panel on the Dashboard, baseline against express and careful in the chosen range. Taps count every decision, fixes and reverts are recorded at merge (the baseline backfilled once from git), and Sentry issues are counted within 30 minutes of every merge, auto or not. Built 4 Nov: a PR's issue is its work item's, and its branch's only without one, since slices were built on their parent's branch name (TAS-30 and 31 on `tas-29-…`). A typed reply that starts a run counts as a tap. The backfill found no fix or revert of a baseline work item's PR (0 of 93), and wrote two by-hand pairs (#83←#84, #21←#22) for the record.
- **Merge commits, not squash:** a squash commit is authored by whoever opened the PR (`mb-factory-bot`), which would drop the user's contribution credit; rebase doesn't suit branches that merge `main` in. Factory commits are co-authored by the work item's assignee.
- **Approve and merge acts as the person who taps,** through one factory GitHub App for every project (user-to-server token, 8 h with refresh, encrypted). Rejected: a personal token in Vercel (one person's, rotated by hand), loosening branch protection, and an app per project. Refusals go only to the tapper; the confirm shows review's `beforeMerging` and the project's `mergeEffect`.
- **The merge gate shows the PR's checks** (3 Nov, [canvas](https://claude.ai/artifact/26Yd52xfVRWHQTGzyV1yPy), Checks at the merge gate): a checks line under Ready to merge on the card and the Home tab, from GitHub's check runs and commit statuses on the head (what the PR page lists, Vercel included), redrawn on `check_run` and `status` webhooks. A check that ran on the commit before and hasn't started on the head counts as running, since preview checks start only after the preview deploys. Approve and merge shows once they pass, on the card and on review's message in the thread (held there with a line while they run or fail, restored on the card's redraw), and the tap reads the same checks. After bringing a PR up to date, the assignee is mentioned once when they pass; that reply carries no buttons, since the console tracks one merge message per work item. Chosen over the Actions runs API (no permission change, but whole workflows only and no Vercel status). Fine-grained tokens can't hold the Checks permission (GitHub Apps only); Tastebook is public, so the console's token reads them anyway. A private project needs the factory App's installation token for this. The tap refuses when the checks can't be read.
- **A PR merges only once it's up to date with `main`** (Tastebook's Checks ruleset, branch protection until 4 Nov; 29 Oct), after two pairs of PRs, each green alone, turned `main` red when merged minutes apart (TAS-74 and TAS-82; TAS-76 and TAS-92). The console merges `main` into a PR waiting at the gate whenever it's behind and not known to conflict, with no run, and the gate accepts that head without another review while the PR's changes, lockfiles included, are the reviewed ones (`bringUpToDate`, `acceptedHead`); CI still has to pass on it. Chosen over GitHub's merge queue, which a personal account's repository can't use (not checked). Nothing watches `main`'s own CI yet, for what reaches it outside a PR.
- **The repository's `reviewers` are asked only at Awaiting Merge,** not at Spec Review and not through CODEOWNERS (which asks as soon as implement marks the PR ready, and assigns by path).
- **Spec approval counts only from the session or Slack;** moving the issue or approving the spec PR doesn't start implement.
- **Review's `keep` is a single option;** a question whose every option leaves the PR as it is isn't allowed (`review.md`).

**Slack**

- **Shape (the Slack redesign, 27 Oct):** a status card per work item edited in place, an App Home hub and `/tastebook`; the run timeline stays as separate thread messages (the user likes it), while a question round is one message edited in place. Rejected: one edited message per run, sending only what needs the user to the channel, a merged morning brief, Slack Lists as a board, Slack's agent features.
- **The card's look** was agreed on the [design canvas](https://claude.ai/artifact/26Yd52xfVRWHQTGzyV1yPy): avatar C (cobalt T on yolk), skipped stages struck through, size as five bars and a word, project › milestone. Slack attachments read as secondary; accepted for the coloured bar. Two redraws racing can show an older state until the next change: accepted.
- **Mentions:** only the assignee, and only on messages that wait on them (questions, the spec gate, a reported gate, blocked or failed, ready to merge, conflict and CI hand-overs). The bot starts every thread, so nobody follows it; card edits never notify. No "Started the … run" replies (each notified the user); a typed reply that starts a run gets :eyes: instead.
- **Every `@Tastebook <request>` is filed, then offered Start now or Leave for later;** nothing starts without a tap. Slack-filed issues land in Linear's Triage, unassigned; whoever taps Start is assigned.
- **Ask the factory:** answers are posted visibly in the channel (a question card, the answer in its thread), so they're kept like the rest. The agent is read-only and offers ticket buttons only when it suggests one.
- **Questions one at a time:** a stage reports its questions as data; the router asks them one by one with the suggestion first, in Linear and Slack, with "Use the defaults" shortcuts; asking costs no runs.

**Linear and intake**

- **Delegating is the user's tap.** An issue assigned to the user is "Yours" and never ready; `autoDelegate` is a later idea. Blocked-by gates the Ready list, not delegation.
- **Removing the delegate takes the work off the factory:** runs are cancelled, questions closed, and the work item leaves the Inbox and Home until it's delegated again, when it carries on from its stage.

**Scheduling, usage and health**

- **The scheduler uses Vercel Queues** for delayed wake-ups (native, no third-party account; chosen over Upstash QStash), with an hourly Vercel cron as the backstop. GitHub's schedules aren't used for anything that must happen: they drop slots.
- **The governor fails open on stale readings** for interactive dispatches (the console can't run Claude inline); scheduled jobs get a probe 8 minutes before their slot when readings are stale.
- **The health check is plain console code, not a run:** no cost, never held, the same state gives the same message. It covers the factory's own health, not the project's app, and posts even when all is clear so a missing message stands out. Sentry issues are listed, not filed (filing waits for Phase 7).

**Hosting and deploys**

- **The console deploys through a deploy hook,** with Git deploys off (most pushes change only the plan, plugin or workflows).
- **Pro's free domain went to Tastebook** (`tastebook.dev`, registered through Vercel, renews 27 Oct 2027), not the console, which is internal and would mean re-pointing every webhook.
- **Secrets live in GitHub environments limited to `main`** (`factory`, `backups`); only `VERCEL_AUTOMATION_BYPASS_SECRET` is a repository secret, because the preview checks run on PR branches.
- **Builds stay inside Pro** (29 Oct, after $25.71 beyond Pro's $20 usage credit in a day): every project, and the team default, on a fixed Standard machine with on-demand concurrent builds off. The team budget only alerts ($35 for the cycle that began 26 Oct, then $5): its pause stops every project on the team, client sites such as goodgate.tv included, so a pause limited to the factory's projects is in the [backlog](#factory-backlog).
- **No `proxy.ts` in the console:** the Next 16 docs advise against it, so each page loader checks the session (behind `<Suspense>`) and each Server Action checks again; API routes keep their own auth.

**Tastebook**

- **Rate limiting (TAS-58, parked):** now, a Vercel Firewall rule on production `/api` by IP, done by hand. Later, per-email and per-account limits on sign-in through allauth on a Postgres cache table: in the Accounts and households PRD (requirement 4). Details on the issue.

### Design stage and Dino

Agreed 28–29 Oct 2026. How a design round runs is in `plugin/agents/design.md` and the router; this keeps why.

- **Dino** is Tastebook's component library, in `frontend/src/dino/` (one path for the labeler and the rubric), built to the rules in `docs/design.md`. The [Dino Design System artifact](https://claude.ai/artifact/Log29Ws2J3fTumoXaxVr1C) seeds every design canvas: Picnic's tokens and fonts, the app's real components, each with a live preview and guidelines whose "Picnic, not built yet" line says what its board still asks for, and the mark. Tastebook's `pnpm dino:bundle` writes every file in it from code, and each design run brings it up to date first (`design.system` in `factory.yaml`, step 0 of `design.md`).
- **Picnic is the look** (the user's pick, 29 Oct, after five directions on the [Tastebook directions canvas](https://claude.ai/artifact/6bH5iKkhh68SCyXuEHXnUB), as nothing in Enamel pleased them): a plum ground, Instrument Serif over Nunito, pastels that always carry dark ink, taped polaroids (which also even out the catalogue's amateur photos), stickers, squiggles, blobs and a floating dock, with the playful parts rationed. Its rules and boards are Tastebook's `docs/design.md`, `docs/design/picnic/` and `docs/design/dino/` (the [Dino in Picnic canvas](https://claude.ai/artifact/XaDcTWKAPapzDwhQqV44JU): each component's states, a focus ring flush to the control, as a ring standing off a pill read as "circle in a circle", and the foundations and layouts for every width). Dark is the only theme (the user's call, to keep it simple). NN/g's ten heuristics and Apple's eight principles are in `docs/design.md`, and review cites them ("NN/g 1", "Apple Agency"). The dock waits for a second tab.
- **Two artifacts, two jobs:** the Design System artifact is the reference, drawn by claude.ai's own page, so Claude can't see it rendered; review happens on Design canvases Claude writes (the user asked why Chrome was being used to look at the system: don't). A canvas installs a copy of Dino under `project/ds/dino/` (tokens, bundle, fonts) with a `designSystems` record, and mounts the real components with `<x-import component-from-global-scope="Dino.Button">`; after Dino changes, copy its files again and bump the record's version. Canvases are dark with no theme tweak.
- **When design runs:** the stage follows Spec Review (`spec → Spec Review → design → Design Review → implement`; in express, triage makes the call: [docs/express.md](express.md)). It's needed for a new screen or flow, a new or changed Dino component, or a visible layout change; it's skipped when the change reuses components with no visual change, is a small UI change within the rules, or the reference boards already draw it, whatever its size (so the Dino restyles didn't go through design again).
- **A person in the loop on a claude.ai Design canvas,** drawn on the [Tastebook Design Flow page](https://claude.ai/artifact/M2hMHwchvFc7Pxpp8iVfY6) (made after the user found the flow confusing): after the governor's go-ahead the console fires the project's routine with the brief as JSON; the session drafts the canvas and posts its link to the card and Linear; the user iterates live in the session, taps Change something (a new round), sends a canvas comment to Claude, or goes Back to spec; and approves from the session or Slack. Each round is a fresh fire, since the canvas and issue hold the state, so a waiting design costs nothing (the morning Ready list mentions one waiting over a day). A session that doesn't report within 60 minutes is ended as failed.
- **Routines** (checked 28 Oct against the [docs](https://code.claude.com/docs/en/routines)): an API trigger's bearer token fires that one routine and is made on the web only (kept in Vercel as `DESIGN_ROUTINE_TOKEN`); the console POSTs to `/fire` (beta header `experimental-cc-routine-2026-04-01`) and gets the session URL. The session runs as the user (commits, connectors and usage), so the governor gates the fire like a dispatch. Fire text is untrusted, so the saved prompt opts in to reading it and stays thin, with the behaviour in the plugin. At most 30 fires an hour; a research preview. Tastebook's is "mb-factory design (Tastebook)" (`trig_015ytNVnxYsCys81Mnm6A8N4`, `design.routine`), with mb-factory and Tastebook checked out, only the Claude connectors, and its own environment "mb-factory design" (`env_013gXp1wqMqNqUm44pJ5YV4G`: Custom network, the console's host plus the default list; Default is left alone for the mail triage routine).
- **Canvas comments reach a live session** (tried 29 Oct): a comment sent to Claude wakes the idle session within seconds, even after its first turn ended; plain comments don't. The wake carries only the thread id, so the session reads it with `ArtifactComments` (board, element and what was in view). How long a session stays wakeable is unknown and a wake isn't gated by the governor, so rounds stay fresh fires and comment wakes are a bonus; any fresh fire can read every comment.
- **Hand-off by export:** stage runs can't read claude.ai, so Design Review's Approve starts a design run that renders each board to PNG in the sandbox's Chromium (with the canvas runtime, `artifact-type/dc-runtime.js`, served as `support.js`, and `/_blob/<id>` assets fetched) and writes `notes.md`; the console commits them to `specs/<ID>/design/` on the work's branch with `GITHUB_DISPATCH_TOKEN` (co-authored by the assignee), so the session needs no push access. Implement builds from those files; the canvas link stays on the issue for people. The design prompt names the design system to load, since a session ignores one that isn't the default.
- **Two kinds of design work:** system work (a new look, foundations, layout, the mark) stays by hand, the user with a Claude Code session on a canvas, ending in a `design.md` PR and a filed project; feature work goes through the design stage, within the rules, and may propose a rule change that the user approves with the design.
- **Primitives first:** whenever a reusable Dino component fits better than one-off UI, the design stage proposes it, with the variants and states it should grow into. Only a new component the feature's boards use blocks it (agreed 29 Oct, to avoid pedantry): it's filed as "Add <Name> to Dino" (`dino`, in the feature's project), lands first with its stories, and the feature waits with the Blocked label. A changed component still means design is needed, but it's built in the feature's PR with its story. Anything noticed but unused is a non-blocking `dino` issue or a hand-off note. This replaces `AGENTS.md`'s rule of three for UI components; the rule still applies to code abstractions.
- **The `dino` label** goes on every PR touching `frontend/src/dino/**`, from Tastebook's labeler workflow. Review no longer reads it: `design-system-rubric` went when review was narrowed (4 Nov), and its points are for the audit's lint rules.
- **Storybook replaces `/styleguide`:** stories per component and state, the accessibility addon, interaction tests through Vitest.
- **Pixel-perfect by code and screenshots, not prose** (agreed 29 Oct): `docs/design.md` holds the rules agents can't infer from a board, and matching the look rests on three things. One tokens CSS file that the canvases load too, with the same bundled fonts, so values and rendering can't drift. Components built once, implement copying exact values from the board markup, with story state names matching the boards' (`is-hover`, `is-pressed`…). And a screenshot baseline for every story (TAS-74): Playwright against the built Storybook, since forced hover, pressed and focus don't apply under the Vitest add-on; made on Linux only; a changed one fails CI until the PR updates it (implement runs do it on their runner, people through a manual workflow), and merging approves it. Boards are evidence, not a gate: review compares each changed baseline with its board's PNG, and once a component's PR merges its baseline is the truth.
- **When a board and `docs/design.md` disagree, the doc wins:** spec, implement and review build to it and record the difference rather than asking (Tastebook's lesson `design-doc-wins-over-a-board.md`); they ask only when the doc contradicts itself or says nothing, with the fix to the doc. Four restyles in a row asked and the answer was the doc every time.
- **Variants when the decision is big** (asked for 3 Nov, after TAS-116's single design): when a central board has several good shapes, the design run draws two or three variants side by side (`A` recommended, the only one drawn in full, and always fitting the spec) and reports them as `variants`. The Slack gate offers "(R) Approve A" and "Use B"/"Use C"; Use sends `Use variant B: <title>` as a reply, so a revise run redraws the states around B and removes the rest. Taking the recommendation costs no extra round; picking another costs one design run. Unpicked variants never reach the repo: a hand-off commits only the chosen boards. A variant that needs the spec changed carries `specChange`: the gate says so, and its Use button sends the work back to Spec Review with a spec run that records the pick, asking nothing; the design run after approval settles the canvas on it. Linear gets the choices in the summary's text only.

## Concepts mapped from Warp

| Warp                                      | mb-factory |
| ----------------------------------------- | ---------- |
| Work item                                 | Linear issue: the durable record. Every stage writes its findings to it |
| Foreman                                   | Split in two. The **router** handles deterministic routing on Linear state and events; the **stage agents** handle judgement |
| Foreman's conversation                    | Linear agent session (activities, plan checklist, `externalUrls`) mirrored to the Slack thread |
| Triage / Spec / Implement / Review agents | Claude Code subagents and skills in the factory **plugin**, one GitHub Actions run per stage |
| Checkpoints                               | Spec Review and Awaiting Merge statuses (human only); merging is enforced by branch protection |
| Questions to humans                       | Asked one at a time by the router, in Linear (elicitations) and Slack (buttons) |
| Factory-as-code                           | `factory.yaml` per project, plus the plugin and the reusable stage workflow in this repo |
| Automations                               | Router rules (events → stage) and scheduled jobs |
| Runners                                   | GitHub-hosted runners (free on public repos) |
| Dashboard, Runs, Inbox                    | Factory console |
| Scorers / Self-improvement / Benchmarks   | Phase 6: LLM-judge scorers, PRs that improve the plugin's own prompts and skills, a fixed task suite rerun against config changes |

## Architecture

```text
 Slack @Tastebook ──┐                                    ┌─► Linear agent session + issue updates
 Linear agent event ┼─► Console /api (Next.js, Vercel) ──┼─► GitHub repository_dispatch → stage workflow
 GitHub webhook ────┘    • verify signatures             │     (claude-code-action, plugin agents/skills)
 Vercel cron + Queues ─► • router, governor, scheduler   ├─► Slack cards and thread replies
                         • stage state machine, run cap  └─► Postgres: work items, runs, events, usage
                                         ▲
 Stage workflow end ── run report (usage, duration, outcome) ─┘
```

### Principles

- **Stateless stages.** Each run rebuilds its context from the Linear issue, its comments, the linked PR and the branch.
- **Briefs, not rediscovery.** Each stage records its findings on the issue so the next stage doesn't collect them again.
- **One voice.** Only the router talks to humans; stage agents report to the issue and session.
- **Humans merge.** Branch protection on `main`; agents never merge, except express's low-risk PRs from Phase 5's step 3, which only the factory App may merge, and only on green checks.
- **Capped loops.** Review → revise runs at most twice, then hands to a human.
- **Usage-aware.** Plan limits are the real constraint, shared with the user's own Claude use. Every dispatch goes through the [usage governor](#usage-governor).
- **Measure from day one.** Every run is recorded, so later changes have a baseline.
- **Public-repo hygiene.** Issue, PR and comment text is data, not instructions. Only Linear workspace members and allow-listed Slack users can start work. Secrets stay in Actions environments and Vercel.

### How it works

A map for reading the code. Pure decisions live in `packages/core`; the console's `lib/` does the I/O.

- **Stage runs:** core `brief.ts` builds the brief → `factory-stage` repository dispatch → the project's `.github/workflows/factory.yml` → this repo's `.github/workflows/stage.yml` → `app/api/runs/[id]/start` (GitHub OIDC) → `claude-code-action` hands over to `mb-factory:<agent>` (`plugin/agents/*.md`) → `app/api/runs/[id]/report`; core `run-report.ts` turns the report into the run's status, outcome and usage. Ask runs read Linear through `app/api/runs/[id]/linear` (core `linear-proxy.ts`); ask and size runs skip project setup.
- **Stage-run hooks:** `plugin/hooks/` (bash and jq, tested by `pnpm test:hooks`). `guard-bash.sh` refuses pushing to the default branch, force-pushing, `--no-verify`, `gh pr merge` and AI attribution in command text; `check-edit.sh` runs the project's `checks.fast.edit` on each edited file; `check-stop.sh` runs `checks.fast.stop` for the areas the branch changed before implement may finish, refusing at most three times. `/start` passes the checks, and `stage.yml` sets `FACTORY_CHECKS`, `FACTORY_AGENT` and `FACTORY_BASE`.
- **Router:** `lib/router.ts` handles each event (`handleIssueUpdate`, `handleGitHubEvent`, `handleAgentSessionEvent`, `handleSlackAction`, `handleSlackMention`, `handleSlackMessage`, `handleRunFinished`) and dispatches through `dispatchRun`; core `router.ts` picks the next step (`nextStepAfterRun`, `decideCiFailure`, `decideConflict`). Linear blockers hold implement (`unfinishedBlockers` in `lib/ready.ts`); a feature waiting on its Dino issues sits in Building meanwhile. Gates and questions: core `gates.ts`, `questions.ts`; follow-ups and workarounds: core `follow-ups.ts`, `workarounds.ts`, `lib/follow-ups.ts`.
- **Design stage:** core `design.ts` builds the fire text; `lib/routines.ts` fires the project's claude.ai routine (`design.routine`); the session follows `plugin/agents/design.md` and reports to `app/api/runs/[id]/design`; `lib/design-pass.ts` signs that report's pass.
- **Webhooks:** `app/api/webhooks/{linear,github,slack}`, plus `slack/interactions` and `slack/commands`. Each delivery is recorded in `events`; duplicates are skipped.
- **Governor and usage:** core `governor.ts`, `usage.ts`; `dispatchRun` in `lib/router.ts`; `.github/workflows/governor.yml` (the probe, dispatched only, posting to `app/api/governor/{tick,readings}`); the local reporter `cli/status-line.sh` → `app/api/usage/local`.
- **Scheduler:** the hourly cron (`apps/console/vercel.json`) → `app/api/scheduler/cron`; Queues wakes → `app/api/scheduler/wake`; `lib/{scheduler,wake,jobs,health}.ts` and core `{scheduler,jobs,health}.ts`. A `job_slots` row makes firing a slot idempotent.
- **Slack:** core `card.ts` + `lib/cards.ts` (redraw scope in `lib/redraw.ts`); core `home.ts` + `lib/home.ts`; core `command.ts` + `lib/commands.ts`; core `ask.ts` + `lib/asks.ts`, `lib/ask-runs.ts`; core `merge.ts` + `lib/github-connect.ts`. Emoji and the manifest: `slack-assets/` (its README), `projects/<name>/slack-assets/`, `projects/<name>/slack-manifest.yaml`.
- **Console pages:** `app/{runs,inbox,usage,dashboard}`, loaders in `lib/*-view.ts`, auth in `lib/session.ts`.
- **Config:** `projects/*/factory.yaml`, bundled as text (`next.config.ts`), loaded by `lib/projects.ts`, parsed by core `config.ts`.
- **Database:** `apps/console/db/schema.ts` and `db/migrations/`.

## Work in Linear

Linear has no "epic" type: a **project** plays that role.

| Linear                 | Used for | Factory role |
| ---------------------- | -------- | ------------ |
| Initiative             | A goal spanning projects | None; for planning |
| **Project** (= epic)   | A deliverable with a PRD and milestones | Sliced into issues |
| Milestone              | A checkpoint inside a project | Slices are grouped under them |
| **Issue**              | One PR-sized slice (one ticket = one PR) | The work item the pipeline runs on |
| Sub-issue              | A spec's split parts | Treated like an issue (keep the team's sub-issue auto-close off) |
| Relations (blocked by) | Order between slices | The Ready list offers an issue once its blockers are Done |
| Triage inbox           | Issues from Slack, the scheduled checks and others | A person accepts (Backlog) or declines (Canceled, and the checks won't refile it) |

**Workflow (Tastebook team):** `Triage → Backlog / Todo → Researching → Spec → Spec Review (you) → Building → In Review → Awaiting Merge (you) → Done`, plus `Canceled`. Delegating to `@Tastebook` is the gate that starts work. **Ready** means Backlog or Todo, unassigned, undelegated, unblocked and sized.

**Slicing a project:** write the PRD on the project; create a "Slice <project>" issue in it and delegate it; triage posts the risks and proposed slices as a gate; on approval it files the issues with milestones and blocked-by relations, in Backlog, undelegated.

**Giving the factory work:** delegate an issue to `@Tastebook`, or mention it in a comment with an instruction; mention `@Tastebook` in Slack (it files the issue and offers Start); `/tastebook ready` to delegate from the Ready list; re-run or cancel from the console or a card.

**Doing it yourself:** assign the issue to yourself and don't delegate. Mid-flight, remove the delegate (runs cancel, questions close) and work on the branch; pushes you make count against autonomy. Hand back by delegating again with a comment saying what's left.

**Specs:** each spec is committed as `specs/<ISSUE-ID>.md` in a draft PR; implementation continues on that branch. Lessons go in `specs/lessons/`, agent rules in `AGENTS.md`.

## Instructions and conventions

Every behaviour worth tuning is a Markdown file under version control, changed through a commit to this repo (factory-as-code); Phase 6's self-improvement proposes changes the same way.

| Layer                | Where | Examples |
| -------------------- | ----- | -------- |
| 1. Factory defaults  | `plugin/agents/*.md`, `plugin/skills/*/SKILL.md` | How triage researches and sizes, when a spec is needed, the review rubric, how agents report |
| 2. Project overrides | `factory.yaml` knobs (per-project instruction files later, Phase 7) | Models, gates, review rounds, jobs |
| 3. Repo conventions  | The project repo: `AGENTS.md`, PR template, `specs/_template.md`, `specs/lessons/` | Code rules and Standards (review cites them as `Standards › <clause>`), PR and spec format |

Factory commits, PRs and comments carry **no AI attribution**; traceability comes from the `factory` label and the console's run records.

### From mb-skills

The plugin's skills are slimmer, project-agnostic forks of the user's mb-skills (which stay as they are for Xelix work). Dropped everywhere: HTML review pages, overlays, `pbcopy`, `~/plans` and `~/builds`, local stack scripts, Shortcut wiring, and Xelix specifics (those belong in each project's `AGENTS.md`).

| mb-skills | Becomes | Keep | Change |
| --------- | ------- | ---- | ------ |
| `_mb-shared/ground-rules.md` | `skills/ground-rules` | The five questions, Design and Code smells, tautology-test rules | Framework bullets move to the project's `AGENTS.md` |
| `_mb-shared/git-text.md` | `skills/git-text` | Commit, PR title and description rules, the Decisions block, the Evidence section, British English, no AI attribution | Linear IDs; evidence uploaded from CI |
| `_mb-shared/house-notes.md` | `specs/lessons/` + `skills/lessons` | The entry format and the expiry of project facts | Agents propose entries in their PRs |
| House note "every question carries a default fix" | Every question the factory asks | A suggested option on every question | Gates need an explicit answer |
| `mb-slice` | Triage (and slicing) | Risks before slices, one ticket = one PR, vertical slices, size floor and ceiling | Files Linear issues after the slicing gate |
| `mb-plan` | Spec → `specs/<ID>.md` | Required reading, one behaviour per criterion, Design rationale, Blast radius, steps with `Done when:`, tests with `asserts:`, Evidence | Questions go through the router one at a time |
| `mb-build` | Implement | Drift check, bug path (failing test first), deviations, the 3-attempts rule, commit discipline, evidence rules | No "ship it" step; the build log becomes the PR description and the run record |
| `mb-review` | Review | Spec and Standards as separate axes; Blocking, Should fix, Nit, Could cut; `Ref:` on every finding; tone rules | Reports to the router; findings needing a human become questions |
| `mb-testing-plan` | Not built yet | The "ready to test" post | Triggered by merge or deploy |

## Usage governor

The factory runs on the same Ultra plan as the user's own Claude use, whose one limit is weekly (the 5-hour window went on 30 Oct 2026, and readings and holds for it were removed on 3 Nov). The decision logic is in `packages/core/src/governor.ts`; the policy is `usage` in the root `factory.yaml`, with the run cap, since every project shares the subscription. Kept on 3 Nov: weekly pacing with 10% slack, the stop at 85% and at most 5 runs.

| Source | What it gives | When |
| ------ | ------------- | ---- |
| **Run telemetry** | `rate_limit_event` in the run's `stream-json` output: `five_hour` / `seven_day` utilisation, reset time, status | Every stage run's report |
| **Probe** | A tiny headless call (`claude -p`, cheapest model) from `governor.yml` | 8 minutes before a scheduled job when readings are stale, and Refresh on the Usage page |
| **Local reporter** | The Mac's Claude Code status line (`cli/status-line.sh`), which also measures the user's own use | Whenever the user uses Claude Code |

- **Open:** dispatch normally. **Throttled** (ahead of the weekly pace plus `slack`): only in-flight and urgent work, cheaper models (`downshift`), scheduled jobs skipped. **Paused** (the week's `pauseAt`, or the pause switch): nothing dispatches; held work queues and is released, highest priority first, when the window allows.
- **Priorities:** `urgent`, `in_flight`, `feature`, `scheduled`. **Run cap:** `concurrency.maxRuns`. **Manual controls:** pause and resume, "allow once".
- **Rejected mid-run:** the run is `limit_hit` and resumes after the reset.
- **Cost on a subscription:** no billed cost per run; the console records the **API-equivalent cost** and tokens as a comparison metric.

## Factory console

- **Dashboard:** autonomy (merged PRs with no human pushes), cycle time per stage with human waits, opened vs merged, run breakdown, usage per PR by size, review rounds and first-pass acceptance.
- **Runs:** runs by work item with a timeline, the Actions log, re-run and cancel.
- **Inbox:** everything waiting on a person: questions, spec reviews, merges, failed or blocked runs.
- **Usage:** the windows, the governor's state, held work, pause and allow once, Connect GitHub.
- **Known gap compared with Warp:** a run can't be steered live; read its result and reply in the thread, which re-runs the stage.

## Working notes

- **Commits and deploys:** commit `mb-factory` work to `main` once the user agrees the step; the console deploys from the push and the user confirms the deploy (don't poll). Before pushing console pages, run `set -a; . apps/console/.env.local; set +a; pnpm --filter @mb-factory/console build` (Next 16 fails some pages only at build time). `tastebook` changes go through PRs.
- **Migrations:** ask first, commit locally, give the user `! set -a; . apps/console/.env.local; pnpm --filter @mb-factory/console db:migrate`, check the columns (read-only `psql` at `/opt/homebrew/opt/libpq/bin/psql`), then push: pushing `apps/console` deploys it (`deploy-console.yml`), and the router selects every column, so migrate before pushing. Production data fixes need the user's go-ahead each time, and the user runs them (Claude's writes are blocked).
- **Factory database reads:** a throwaway Node script in `apps/console` with `.env.local` sourced, `neon(DATABASE_URL).query(sql)` from `@neondatabase/serverless`, deleted after use. Quote `"window"` in `usage_readings`.
- **Core against real data** (a panel's numbers before deploying, a backfill's dry run): write a scratch `.ts` importing `packages/core/src/…` by absolute path, bundle it with the esbuild under `node_modules/.pnpm/esbuild@*/node_modules/esbuild/bin/esbuild --bundle --platform=node --format=esm --external:@neondatabase/serverless` into `apps/console/`, run it there with `.env.local` sourced, then delete the bundle. Node can't run core's extensionless imports directly.
- **Console logs:** `vercel logs -p mb-factory-console -e production -s 30m -n 500 --json`; each line's message is the console's JSON log, and `--query 'TAS-81'` keeps one issue's lines. `vercel crons run /api/scheduler/cron` wakes the scheduler by hand. Read logs promptly (Pro's retention unchecked).
- **Vercel settings and deployments:** `vercel api` reads and changes project settings (retention is `PATCH /v9/projects/<id>/deployment-expiration` with `expirationProduction=1d`; it won't take `deploymentsToKeep`, which is the dashboard's). Auto mode blocks Claude deleting deployments: list the IDs into a file and the user runs `! while read d; do vercel rm $d --yes; done < <file>`.
- **`!` commands** run in this session's shell, whose directory moves with Claude's `cd`: start any that use relative paths with `cd /Users/milobedini/Documents/git/mb-factory &&`.
- **Rulesets:** Tastebook's protection is the Checks (26517093) and Review (26517145) rulesets, kept as files in `projects/tastebook/rulesets/`. The user applies a change (`gh api -X PUT repos/milobedini/tastebook/rulesets/<id> --input …`); auto mode blocks it for Claude as a CI bypass.
- **The factory's App:** `mb-factory-bot`, App ID 5483828, client ID `Iv23linGH8dU6E6eMoz1`. The console has its key (`FACTORY_APP_PRIVATE_KEY`, added 4 Nov from a new key; the older one stays in Tastebook's `factory` environment). A new key: the App's settings › Private keys, then `! vercel env add FACTORY_APP_PRIVATE_KEY production --sensitive < ~/Downloads/<file>.pem`, which keeps its line breaks.
- **Secrets:** to GitHub with `! pbpaste | gh secret set NAME --env <env> -R milobedini/tastebook`, or a script the user runs; never a bare `gh secret set` through `!` (no terminal, empty value). To Vercel, the user runs `vercel env add` (blocked for Claude in auto mode). When a job that uses a new secret fails, suspect the paste first (twice it carried extra text).
- **Slack:** the `slack-tastebook` MCP (local scope, `https://mcp.slack.com/mcp`, the Slack plugin's client ID `1601185624273.8899143856786` and callback port 3118) reads `#tastebook-factory`; read freely, ask before posting. Preview Block Kit by rendering core's JSON in a throwaway Vitest file and opening `https://app.slack.com/block-kit-builder/#<url-encoded JSON>`. `/tastebook ready` runs production's `loadReadyList`.
- **Sentry:** the `sentry` MCP (org `milo-bedini`, region `https://de.sentry.io`, project `sentry-gray-fountain`). The user's Chrome has an ad blocker, so browser checks of third-party scripts fail there.
- **Neon (Tastebook):** the `neon` plugin, project `tastebook` (`green-resonance-43539979`), branch `production` (`br-shy-butterfly-za1yk0b6`), database `neondb`. The default branch is `previews-base` (`br-quiet-lab-zaflqcro`, empty) since 2 Nov, so always pass production's `branch_id`: a query without one reads the empty branch. Read-only unless asked; ask before anything destructive; never fetch connection strings through it. A restore trial uses a throwaway branch from production (never a preview branch, which holds only the catalogue and its own accounts).
- **Tastebook's local clone** (`~/Documents/git/tastebook`) is linked to Vercel; its `.env.local` holds the photos Blob token and an OIDC token. Stage runs have no Vercel token, so Vercel changes (firewall, settings) are a person's step.
- **Usage token** for the status-line reporter: `~/.config/mb-factory/usage-token`.
- **Tastebook PRs Claude opens by hand** come from the user's GitHub account, so the user can't approve them: they merge with the admin option once checks pass. A small fix outside the factory (tastebook#77) goes this way.
- **Republishing the Dino Design System by hand:** in Tastebook on an up-to-date `main`, `pnpm install && pnpm dino:bundle`; it prints the commit it built from. Publish every file under `frontend/dino-bundle/project/` to the artifact with `root` set to that folder (`components/index.d.ts` as `text/plain`), plus a guideline and preview for any new component and `null` for files no longer built, and send `project/design-system.json` last, read again just before, with only `lastChange` changed. To check previews before publishing, render them headless under the React 18 files in the artifact's `components/lib/`.
- **Onboarding sessions** ran with the `mattpocock-skills:grilling` skill: rounds of numbered questions, each with a recommended answer; Claude looks facts up itself, summarises, and asks before writing; the write-up goes where its readers look. Design directions were private claude.ai artifacts ([Enamel](https://claude.ai/artifact/BD7Up5iuWptCLTcsAD67Qm), [style guide](https://claude.ai/artifact/8XJh3x55GzARA7uFBHspxc)), copied into the repo since agents can't read claude.ai.

## Gotchas

- **The factory's Linear app can't create labels** ("not allowed to take action"): a job's or stage's new label must exist in the team before its first filing, or every issue carrying it is refused (the clean-up job, 4 Nov).
Learnt the hard way; each would bite again.

**Claude Code and the action**

- `claude-code-action` hides the agent's output and runs keep no transcript, so a run that ends without a report and pushes nothing can't be diagnosed (see [Run transcripts](#run-transcripts-after-phase-6)).
- Job-level `env` and the `settings` input reach Claude's Bash tool. `execution_file` is a JSON array of stream-json events. The action skips the App token exchange when the workflow differs from the default branch's.
- A script that refuses an agent's output over one character loses the whole result: TAS-135's collage failed on a colon in a caption (4 Nov), a rule implement's prompt never stated. State the rule in the prompt, and tidy rather than refuse where it's safe.
- A reusable workflow sees an environment secret only if the caller names it in `secrets:` (Tastebook's `factory.yml` missing `EVIDENCE_BLOB_READ_WRITE_TOKEN` made it empty).

**GitHub**

- Scheduled workflows are best-effort: GitHub drops slots (6 of about 98 fired one day) and runs others hours late; in a public repo they stop after 60 days without activity. Scheduled failures are emailed to whoever last changed the cron: after the bot touches one, disable and re-enable it as the user.
- A push to a PR's branch with a workflow's own `GITHUB_TOKEN` starts its `pull_request` workflows only after a maintainer approves them, and checks from a `workflow_dispatch` run don't count towards the PR's required checks (tastebook#77, 29 Oct). So Tastebook's Update screenshots only uploads the shots and a person commits them with `screenshots:commit` (TAS-91); factory runs make their own on their runner (the 403 below).
- The factory's token is refused (403) starting a workflow, so a stage run can't use Update screenshots; on TAS-81 a run then asked a person instead of making the shots itself, now ruled out by Tastebook's lesson (tastebook#88).
- A manually started workflow runs on the branch as it is, while a PR's checks run on its merge with the base: a branch from before a fix on `main` fails the manual run that its PR's checks pass (#78, 29 Oct).
- No webhook fires when a PR becomes conflicting, a conflicting PR runs no CI, and `mergeable` can stay stale against an old base, or unknown for over two minutes after the base moves (TAS-81, 29 Oct): don't wait on it to act.
- Environment names are case-insensitive, and Vercel creates a `Production` environment (hence `backups`).
- `hashFiles()` in a step's `if:` sees only the workspace, never `runner.temp`: check for such a file inside the step.
- A job that parses files an agent made (ImageMagick, ffmpeg) holds no secret: a crafted file could plant something in a later step's environment and read its token. Hence `stage.yml`'s separate `visual` job (4 Nov, caught in self-review).
- A ruleset's `pull_request` rule takes `require_extra_approval_for_unattributed_changes: true` by default, undocumented (4 Nov): set it `false`, or a no-bypass ruleset may hold the App's merge.
- `GET /apps/<slug>` answers 404 for a private App even to its owner: read its ID from `performed_via_github_app` on one of its comments.
- Vercel reports every deploy to GitHub as a deployment with statuses, so `deployment_status` webhooks give deploy results without a Vercel token, once the repo's webhook subscribes to them.
- Dependabot runs as soon as `dependabot.yml` lands; labels it adds must exist; its lockfile can move unrelated packages backwards; `cooldown` doesn't apply to security updates.

**Linear**

- The app can't create team labels (`not allowed to take action`): create `factory`, `Blocked` (`#eb5757`), `docs`, `security`, `express` and `careful` by hand (the last two made through the Linear connector on 4 Nov).
- A session opened with `agentSessionCreateOnIssue` still sends `created` about 0.3 s later, so claiming the work item must be atomic.
- A `prompted` body arrives in `agentActivity.content.body` (not as documented); a stop is `prompted` with `signal: "stop"`.
- The GitHub integration's "review requested" automation must point at Awaiting Merge, or it undoes the merge gate.
- A PR that names an issue (even "Part of TAS-73") assigns that issue to the PR's author: harmless, as delegating assigns it anyway, but it looks like someone took it. Blockers only hold an issue off the Ready list; a spec run doesn't see one added after it starts, so say an ordering in an answer.
- Attaching a GitHub PR's link to an issue (the MCP's `links`) makes it the issue's PR: merging it would move the issue to Done. Name another issue's PR in the description's text instead (TAS-90 and tastebook#77, 29 Oct).
- "Agent session events" options appear only after the OAuth app is first saved. The Linear MCP connector acts as the user. Fallback text for one-tap options repeats the label: Linear's rendering.

**Slack**

- `chat.update` renders `text` as the body unless `blocks` are given; the coloured bar exists only as an attachment's `color`. A missing custom emoji renders as `:tb-done:` text: upload emoji before shipping code that uses them.
- Button and checkbox text at most 75 characters (about 30 shown); `value` at most 2,000. A `confirm` dialog shows mrkdwn literally. Interactivity needs a 200 within 3 s.
- One mention arrives as both `message` and `app_mention`: start work only on `app_mention`.

**Vercel**

- A project made with the CLI may have `createDeployments: disabled`, so `deployment_status` workflows never fire: check on every new project.
- Services projects have no working `ignoreCommand`; a cancelled build still counts as a deployment; "skip unaffected projects" treats non-package folders as global changes.
- A new production domain needs a production redeploy before redirecting to it (`VERCEL_PROJECT_PRODUCTION_URL` is fixed at deploy time); `DJANGO_ALLOWED_HOSTS` alone doesn't make a CSRF origin.
- Protected previews redirect credential-less same-origin fetches to sign-in (it broke the Sentry tunnel's Lighthouse score). Standard Protection doesn't cover the production `*.vercel.app` alias. Toolbar settings apply only to new deployments.
- A Python service must name its `entrypoint`; set `regions` at the top level (default `iad1`). Builds run in `iad1` whatever `regions` says, so database work in a build pays a transatlantic round trip a query to Neon in London: the catalogue load's 9,000 queries timed every deploy out at 305 recipes (TAS-85).
- Only a fixed Standard build machine with on-demand concurrent builds off is included in Pro; Elastic (the default for new teams), Basic, Enhanced, Turbo and on-demand concurrency bill per CPU minute. Elastic moves a project to Turbo (30 CPUs) after a build times out, so each hung 46-minute build cost about $4.80. A budget's pause stops every project on the team, each until resumed by hand.
- Queues delivered every send of an `idempotencyKey` on 29 Oct (41 sends of one wake-up, 43 deliveries), whatever its docs say, so each wake-up booked a copy of the next and about 45 circled. A `wake_bookings` row per moment now decides which send goes out; don't lean on the key alone.
- Queues pushes a message only to the deployment that sent it, and every deployment stays alive to receive it: each production deployment that booked a wake-up kept its own chain going with its own code (48 answered on 3 Nov). Sending unpinned (`deploymentId: null`) isn't the fix: unpinned wake-ups reached no deployment at all (3 Nov 11:06 to 4 Nov, only the hourly cron woke). Wake-ups are pinned again, and a deployment no longer in production forwards each one to the deployment `/api/scheduler/deployment` names (`wake forwarded`). The console keeps production deployments for a day (Vercel still keeps the last 10).
- The first wake after a deploy fires the day's missed slot as a catch-up, which reports itself late.

**claude.ai artifacts and routines**

- A Design canvas re-saves its files from the page on its own (it re-encodes `data-props` as entities), so a publish can land on a version newer than the one read. The tool merges and warns; when the page's change was only that encoding, nothing is lost. Read a file again before editing it if a publish reports one changed.
- An artifact publish refuses a `.ts` file: send it with `contentType: "text/plain"`. A publish over a file the user has edited on the page is refused: read it, redo the change on their version, publish again.
- Apple's HIG pages are empty without JavaScript; fetch `developer.apple.com/tutorials/data/design/human-interface-guidelines/<page>.json` instead.
- `RemoteTrigger` can disable a routine but not delete it (the user deletes it at claude.ai/code/routines).
- The routine edit dialog keeps Save disabled while the trigger reads Schedule › Manual (an API-made routine with no cron): add the API trigger first. Saving there also sets a `claude/…` branch per repository.
- A routine created with `mcp_connections: []` still gets every connector on the account (Gmail, Drive, Notion…); an `update` with an explicit list does stick. Set the list in an update before the first fire.
- A canvas frame clips whatever runs past its `h`, and Claude can't see it rendered: on 29 Oct five of the Dino boards were cut off. Add up a board's content before setting its height, err well over (over-tall beats clipped), and change the root's height, `$preview` and the index's `h` together. After any canvas change, copy the boards into Tastebook's `docs/design/` again so the repo matches.
- Claude can't read a claude.ai chat, nor its share link (the share page is built by JavaScript and its data endpoint answers 403), and the factory never sees one: a design talked through in a claude.ai chat reaches the design run only as a reply in the Slack thread or a canvas comment sent to Claude (3 Nov, TAS-116).

**Neon, Drizzle, Next**

- Use the Neon-managed Vercel integration (it deletes preview branches with their Git branch; the free plan allows 10).
- A documented person's step isn't done until someone checks the provider: Tastebook's `previews-base` setup (TAS-100, 29 Oct) was never carried out, so previews copied production until 2 Nov. The console's New branch ticks **Automatically delete branch after** (1 day) by default; untick it for a lasting branch. Neon's tools can't make a schema-only branch, and the auto mode classifier blocks `DROP SCHEMA`, so both are the person's.
- `db:migrate` can stall silently on the websocket driver: stop it and run it again.
- `runs` has a check constraint on what a run belongs to: a new kind of run needs a migration.
- Next 16: database calls in a page loader fail in `after()` and in a prefetch's prerender (`await connection()` first); a page awaiting `searchParams` outside `<Suspense>` fails Vercel's prerender while `tsc` and tests pass. A failed Drizzle query's `cause` holds the real error.

**Tooling**

- pnpm 12 fails installs on unapproved build scripts (`allowBuilds`) and defaults `minimumReleaseAge` to a day; uv's equivalent is `exclude-newer`. Biome formats YAML: exclude generated files. `astral-sh/setup-uv` has no major tags.
- zsh: quote bracketed `gh api -f` fields, and never name a variable `path`.

## To see live

Built but not yet seen working; delete each line once seen. Swept 3 Nov evening: everything not listed here was seen.

- **One scheduler:** forwarding and queued wake-ups were seen working on 4 Nov (06:48: `wake forwarded` from the old deployment, then `woke` with cause `queued wake-up` from the new one). Still to see: one governor probe per probe moment, and a `morning ready list` line beside every Ready message.
- **Stage-run hooks** (4 Nov): on the next implement run, a `check-edit` failure handed back and fixed in the transcript, and a run that ends only once the stop checks pass (or after three refusals); no guard refusal of an ordinary push or commit.
- **Express track** (4 Nov, step 2): seen on TAS-135 and TAS-120 (4 Nov): triage → implement with no spec, review asking nothing, the card showing Express with no Spec step, and triage's `careful` sending TAS-120 through the spec. Still to see: implement asking before any code (TAS-135's questions came from triage), nothing about infrastructure, Should fix findings filed in Triage, and an express design's hand-off starting the branch.
- **The watch after merging** (4 Nov, step 3, [canvas](https://claude.ai/artifact/JZn12XQLW7gUQukZ7EgJMa)): 30 minutes after the first auto-merge, the thread gets the all-clear line (`merge watch started`, then `merge watch ended`). Still to see on a real case: a failed production deploy said at once from `deployment_status`, new Sentry issues listed with Revert, and Revert opening GitHub's revert PR that merges itself (`revert opened`, `revert merged`).
- **The bot's merge** (4 Nov, step 3, on since 4 Nov): an express PR the line says merges itself is merged by `mb-factory-bot` when its checks pass (`pr merged by itself`), the message ends "✓ Merged by itself", and a PR touching a migration keeps waiting. Check a refusal says so in the thread once.
- **Merge rules** (4 Nov, step 3): seen on TAS-135: the line said it waits, for review's reasons and the sign-in page, and the careful TAS-120 got none. Since then the line points at Before merging instead of repeating it, and a test of risky code no longer counts as a risky path: check both on the next one.
- **One visual per PR** (4 Nov, [canvas](https://claude.ai/artifact/E4g3r5Xym15rN2eftMrdYX)): TAS-120's walkthrough played under review's message (4 Nov). TAS-135's collage failed on a caption with a colon; `visual.sh` now tidies captions instead of refusing them. Still to see: a collage in the PR and under review's message, before screens from `origin/main`, and a walkthrough's link playing on a phone.
- **Express against the baseline** (4 Nov, step 3): a `fixes recorded` line and a `pr_fixes` row when a PR reverts or fixes one merged in the week before; the panel's Sentry row showing a count, not "unread" (a failed read logs `dashboard sentry read failed`); an auto-merged PR counting 0 taps, and the Merged by itself row counting it.
- **The clean-up job** (4 Nov, step 4): its catch-up run for Mon 2 Nov fired on the first wake after the deploy (10:17, 4 min) and found two things, which Linear refused, as the `cleanup` label didn't exist and the factory's app can't make labels (since made by hand). Still to see on Mon 9 Nov at 07:00: both filed as `Clean-up:` issues labelled `cleanup`, a deeper pass than the catch-up's (it read only the newest tests and grepped `AGENTS.md`), the brief's `review findings` block in the run log, and whether knip, vulture and jscpd ran or became gaps.
- **Weekly-only governor** (`c1673ae`): the Usage page shows one Factory section with a single weekly gauge and the 5-run cap; the Slack Home shows only the week. (No `fiveHour` rows since 31 Oct.)
- **New in Sentry:** the health check's section. The 29 and 30 Oct checks missed SENTRY-GRAY-FOUNTAIN-4 to 9 with no `sentry issues failed`, so check `project=` (the slug where Sentry may want the numeric ID) rather than waiting for a new issue.
- **Held for blockers:** an issue reaching implement while it waits on another: `held for blockers`, the Blocked label and "Waiting on TAS-… before building" in the thread; once the blocker is Done, `blockers finished`, the label off and implement starting.
- **Workarounds:** a run that patches the project to get its work done reports `workarounds`, and the thread names the Triage issue (`workaround filed`), or the open one (`workaround already filed`).
- **Size retry:** a size run with no report is tried again once (`size run gave no size, trying again`) before the unsized comment.
- **After a Dino wait:** the Blocked label comes off when implement starts (TAS-114 kept it, 3 Nov).
- **Design stage:** a comment sent to Claude revises the same canvas. The first design with variants offered by the gate: "(R) Approve A" and Use buttons, a Use tap revising the canvas around that variant, and only A's boards in the hand-off; a spec-changing pick going through a spec revision and coming back designed around it (TAS-116 did this by typed replies).
- **Screenshots:** the first hand-made PR using Update screenshots then `pnpm --filter frontend screenshots:commit <PR>` gets green checks with no approval click (TAS-91).
- **Runs:** a timeout saying "ran out of time" and waiting with Re-run; a stopped card reading Stopped with Re-run; a stale Re-run button re-running the latest run.
- **Work items:** an undelegated item reading Not delegated and leaving the Inbox (TAS-58's card, undelegated 28 Oct, still says Waiting on you).
- **Specs and splits:** approval after a revision whose report has no parts still filing them; a part with `blockedBy` outside its split.
- **Review and merge:** a PR whose base, merged in by someone other than the console, changed its lockfile goes back to review.
- **Slack:** `/tastebook` pause, resume and unknown words.

## Factory backlog

mb-factory isn't a factory project yet, so its own follow-ups live here. Each is unbuilt unless it says otherwise (checked 3 Nov 2026).

- **Switching track at a gate:** relabelling a careful issue `express` while it waits at Spec Review should skip the gate and start implement (docs/express.md); today the label counts from the next step, so it waits for the reply. Needs the console to follow label changes (Linear's label webhook, or a read when the gate's buttons are drawn).
- **Review's re-run option:** review no longer asks about checks (4 Nov), so nothing reports a question's `rerun` any more; remove its path from core `questions.ts` and the console once a few weeks of review show none.
- **PRD flow:** start a project's PRD with a person in the loop and, on approval, file "Slice <project>". Writing Accounts and households by hand (29 Oct) answered most of it: a Linear document on the project from the PRD template, drafted after reading the Vision and the project; one round of up to four questions that change requirements, each with a recommended answer, and every other choice drafted as an open question with a suggested answer; approval marks it Approved, links it from the project and files the slice issue for the person to delegate. Still open: which agent, and asking in Slack.
- **Slicing hints at design:** slicing marks each slice it thinks needs design, and files the new Dino components a project needs as their own slices ahead of the features that use them (proposed 29 Oct; triage and the spec still decide).
- **Design extensions:** start a feature by itself when its last `dino` issue merges, carrying the design approval's suggestions into that implement run's brief as well as `notes.md`; a design run whose hand-off commit fails (TAS-103, GitHub's 500, 30 Oct) is re-run as a fresh draw needing approval again, and should retry the hand-off instead.
- **Size runs:** 3 of 16 ended in about 6 s with no report (28–29 Oct), against 18 s or more for a working one; the cause waits on [run transcripts](#run-transcripts-after-phase-6).
- **Scheduled reliability:** dispatch Tastebook's backup from the console's scheduler: GitHub ran its 02:17 cron 6 to 7 hours late every day from 30 Oct to 3 Nov. The health check lists failed scheduled runs but not missing ones, nothing reports the console being down, and a run stuck then cleared between checks goes unseen.
- **Spend and deploys:** the health check flags any Vercel on-demand spend (`vercel usage`) and a failed production deploy (8 hours of failed Tastebook deploys went unseen on 29 Oct); the budget's webhook points at a console route that pauses only `tastebook` and `mb-factory-console` at 100%, leaving the rest of the team's sites up. Tastebook's webhook sends `deployment_status` since 4 Nov (the watch after merging reads it), so a failed production deploy could be flagged by the health check too.
- **Merge rules:** the 400-source-line cap held back 1 in 3 of PRs #86–126 in the backtest (4 Nov), against the baseline's 1 in 8, and triage tightens deleting-data issues to careful (TAS-120): revisit both after two weeks of express. A new GritQL rule counts as a lint-settings change, though it tightens.
- **Merge state:** re-check PRs whose merge state stays unknown (needs a record of which); make `merge state unknown` a warning only when it changes an outcome; a PR handed over for conflicts is told again on every later push to `main`, and the CI hand-over repeats on every later failure; bringing a PR up to date says "No new review is needed" even with a Blocking finding open (careful only).
- **Merge conflicts:** compare lockfile contents after an agent conflict fix (CI regenerates and fails on a difference); flag issues touching the same manifests in the Ready list; conflicts and their cost on the dashboard; union merge for `GLOSSARY.md`.
- **Dependencies:** check Dependabot majors before implement (runtime versions, peer ranges, `AGENTS.md`); learn from an unmerged close (ask why, propose an ignore rule or a lesson).
- **Stage runner security:** the stage job's own secrets share a runner with an agent that has sudo and can write `$GITHUB_ENV` (the reasoning that split out the evidence job); the security check doesn't cover `mb-factory` (onboarding it fixes that); `security-rubric` has no category for untrusted text reaching a renderer or prompt (the clean-up brief's review findings needed escaping twice on 4 Nov, caught only by the commit security review), and its unpinned-actions row contradicts its no-best-practice rule; the console takes a PR's visual from the run's own `<repository>/<run>/` folder on any public Blob store, so naming the project's store in `factory.yaml` would bind it fully.
- **Filing with a missing label:** file the issue without a label the app can't create, and say so in the health message, rather than refusing the whole issue.
- **Sentry:** issues that came back or grew, an environment filter, filing issues (Phase 7).
- **Slack:** `/tastebook pause [reason]` (no reason column); an Approve tapped in a `/tastebook status` reply leaves it stale; the Home usage bar renders small (try coloured squares); debounce Home republishing if `views.publish` rate-limits; follow-up questions in an ask thread do nothing; the factory's avatar (`projects/tastebook/slack-assets/avatar.svg`) is still Enamel's cobalt on yolk, to redo in Picnic on a canvas first.
- **Console:** the Runs page refreshes every 10 s but needs times counting up and the agent's latest thought; usage over time with runs overlaid and the factory/you split; a weekly evidence clean-up (before the Blob store passes about 500 MB); exact Actions minutes; scorer cards (Phase 6); a project filter (Phase 7).
- **Router:** a PR reopened after an unmerged close isn't handled; reviewer per project from the Linear project's lead.
- **Questions against earlier answers:** a spec question whose premise an earlier answer removed is still asked (TAS-91's second assumed the App the person had just declined), though Tastebook's lesson says to write questions that hold for every earlier answer. Watch express's questions for the same.
- **Diagnosing a provider:** on TAS-95 (31 Oct) implement blamed the preview's Neon branch without checking `previews-base` existed or was the default (it was neither). An agent blaming a provider's setup should read the provider's state first (the Neon tools are read-only there), say what it checked, and not recommend a person's step it hasn't shown would fix it. TAS-150 makes the build's own message name the cause.
- **Showing the design call:** the Slack spec gate and Linear's elicitation don't show the spec's design call (only the brief's last line does); in express, the thread should show triage's call.
- **Jobs:** backlog grooming (stale, duplicate, unclear, unsized, blocked only by finished issues), through the read-only Linear proxy; `autoDelegate` once trusted; guards proposed to the shared plugin (Phase 6).
- **Screenshot baselines (TAS-74):** 95 story PNGs at 390 px, 0.73 MB (29 Oct), about 8 KB each and one per story, so git history grows only when a look changes. Move them to Git LFS or a hosted snapshot service once that history passes about 100 MB, or when more widths or full-page shots are added; until then nothing to do.
- **Never seen live (built 24–27 Oct):** checks pending for more than a phase, moved from To see live when Phase 4 closed; look when a real case comes. A usage hold booking its wake and starting soon after the reset; a lapse wake firing; a `limit_hit` resume; Linear's stop signal; a lockfile-only conflict merged without an agent; App Home Pause and Resume; the Ask flows (Start from a "for later" thread, a top-level request, a question while paused); Ready messages' "no longer ready" and failed-start rows; the health check's "Scheduled workflows" section and its stuck-run flag. The user's to look at: co-authored commits on the contribution graph, and the dashboard at phone width and in light mode.
- **Linear housekeeping (by hand):** swap the stale Notion "Vision" links on the projects for the Linear Vision document; pin the TAS Overview sections.

## Phases

| #   | Phase | Exit criteria |
| --- | ----- | ------------- |
| 0   | **Foundations**: monorepo, console with webhooks and DB, Linear agent app, Slack app, `tastebook` starter with CI and branch protection, draft instructions | Closed 24 Oct 2026 |
| 1   | **First loop, run log and governor** | Closed 25 Oct 2026 |
| 2   | **All stages and the Runs page** | Closed 25 Oct 2026 |
| 3   | **Slack intake, questions and Inbox** | Closed 26 Oct 2026 |
| 4   | **Dashboard and scheduled loops** | Closed 3 Nov 2026, baseline frozen early for Express |
| 5   | **Express** ([docs/express.md](express.md)): both tracks lightened, the express track, auto-merge with the watch after merging, the clean-up job and rule audit | Two weeks of express against the 25 Oct–3 Nov baseline: cycle time and taps per PR down; fixes or reverts within 7 days and new Sentry issues tied to a PR no worse |
| 6   | **Scorers, self-improvement and benchmarks**: scorer task, self-improvement PRs on the plugin, a benchmark suite, the weekly Slack report | At least one accepted self-improvement PR; one benchmarked config change |
| 7   | **Reusability**: onboarding a second project (wiring, the onboarding interview, settings per project) | A second repo runs through the factory with config only |

**Weekly factory report (Phase 6):** a top-level Slack message in the project channel, Mondays 07:30 London: last week's merged PRs, autonomy, median cycle time, cost and anything stuck, linking `/dashboard?days=7`; plain console code, no run.

### Run transcripts (after Phase 6)

Deferred by the user on 28 Oct 2026, after a TAS-48 implement run ended without a report and nothing showed why. Keep each stage run's transcripts: the session and subagent `.jsonl` files under `~/.claude/projects` on the runner, written as the run goes, so a run stopped at its time limit keeps them too. An `if: always()` step uploads them to private Vercel Blob (not Actions artifacts: on a public repo any signed-in GitHub user can download those), the run records the link in `runs.transcript_url`, and the Runs page links it. Storage costs next to nothing; the care is secrets in tool output (private store, a retention to agree, perhaps 14 days).

### Per project and shared (Phase 7)

By Phase 7, everything that can be scoped by project should be. Already per project: `factory.yaml`, work items, runs, jobs, findings, Slack channel, Linear team. Shared on purpose, because they guard the one subscription: the governor and readings, the pause switch, and the run cap and usage policy (the root `factory.yaml` since 3 Nov; a project's file can't set them). To split: `console_problems` (add `project`), the console pages' filters.

**Hardcoded, candidates for per project:** agent instructions (several examples are Tastebook-shaped: the security agent assumes `pnpm-lock.yaml` and `uv.lock`); fix limits (`MAX_CI_FIXES`, `MAX_CONFLICT_FIXES`); the Dependabot policy (`dependencies.ts`); filing thresholds (`security-rubric`); label names; stage run limits and allowed tools (`stage.yml`).

**Acting on the health check:** most of what it finds is a factory problem in `mb-factory`, which no agent can work on. Direction: onboard `mb-factory` as a project, so a new error becomes an issue the factory triages and fixes (with care: the factory changing its own code); clean up stuck cases deterministically and say so; file each new error as a Triage issue, deduplicated. The same step lets the security check cover `mb-factory`, and moves the [factory backlog](#factory-backlog) into Linear (agreed 28 Oct 2026), so it has a status like any other work.

### Project onboarding (Phase 7, tried by hand on Tastebook)

Onboarding is an interview in four sessions, each writing where its readers look (Tastebook's four ran on 26 Oct 2026):

| Session | Covers | Written to | Read by |
| --- | --- | --- | --- |
| Product | the product plan and main use case, users, core features | the Vision document, then the first PRD (Linear) | spec, slicing |
| Engineering | the stack beyond the core (monitoring, auth, email), hosting and previews, code style and architecture, component primitives, the standards review checks | the project repo: `AGENTS.md`, `GLOSSARY.md`, `docs/architecture.md`; Linear issues for setup work | implement, review |
| Design system | a few visual directions as HTML pages, then tokens, type, shape, components, rules | `docs/design.md` and a reference page; an issue to build it | implement, review |
| Factory | scheduled jobs, models, gates, review rounds, thresholds | `factory.yaml` | console, router |

- **Learnt on Tastebook:** product documents go in Linear; the design system deserved its own session; the engineering session also produced a Platform project of setup issues; every session ends with a by-hand PR so agents read the decisions from the repo.
- **A platform baseline the factory hands down:** previews checked before review, nightly backups with a tried restore, errors reported, secrets in environments limited to `main`, the factory's own GitHub App, and deploying only when the app changes where the platform allows it (not on a Vercel Services project). Write it as a checklist in the onboarding doc, with what each caught on Tastebook.
- **Wiring checklist:** create the factory's labels by hand (Linear refuses the app); the caller workflow names every secret `stage.yml` declares; Vercel `createDeployments` on; install `mb-factory-bot` on the repo (Contents, Pull requests, Issues and Workflows write; Actions, Checks and Commit statuses read) and give the repo's `factory` environment `FACTORY_APP_CLIENT_ID` and `FACTORY_APP_PRIVATE_KEY`; `people[].github` for whoever may merge from Slack, and `mergeEffect`; for express auto-merge, the Checks and Review rulesets in place of branch protection (as `projects/tastebook/rulesets/`) and the App installed on the repo, since the console's one App key serves every project; the Slack app from `projects/<name>/slack-manifest.yaml`, its icon, the emoji rendered with `slack.emojiPrefix`, and the channel, `allowedUserIds` and prefix in `factory.yaml`; the Linear team's Overview as the project's front page (Product, Factory and Engineering sections; the connector can't pin, so GraphQL or by hand).
- **Later, in `factory init`:** the multiple-choice parts through the questions machinery; an onboarding checklist per project in the console. Build only after the by-hand run shows what's worth asking.

## Open questions

- **Stage run credentials:** the agent holds the Linear app token for the whole workspace (up to 24 h), because it reports through `linear.py`. Narrower: proxy Linear calls through the console with a per-run token limited to the run's session and issue (ask runs already do). The agent also shares the runner with the report step, so it could understate usage; readings are capped and checked for plausible resets, and probe readings are the ground truth.
- **Usage readings:** confirm the probe's figures against `/usage`.

## References

- Warp Factories docs and [warp-factory-examples](https://github.com/warpdotdev/warp-factory-examples) (default agent prompts in `00-warp-default-agents`)
- [Building a software factory](https://www.piersonmarks.com/posts/building-a-software-factory) (Pierson Marks)
- Claude Code: [GitHub Actions](https://code.claude.com/docs/en/github-actions)
- Linear: [Agents API](https://linear.app/developers/agents), [agent interaction](https://linear.app/developers/agent-interaction)
- [Agent SDK and claude -p on Claude plans](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)
