# mb-factory — Plan

A reusable software factory, modelled on [Warp Factories](https://docs.warp.dev/factories), that runs on a Claude **subscription** rather than paid API usage. Work arrives from Linear or Slack, moves through triage → spec → implement → verify → review, and comes back as a pull request for a human to merge.

Demo project: **Tastebook** (a household recipe hub), live at <https://tastebook.dev>.

## Where things stand

This plan holds direction, decisions and what was learnt. It doesn't track work: read the platforms for that.

- **Issues and their status:** Linear, team `TAS` (projects, the Triage inbox, the Ready list via `/tastebook ready`).
- **Runs:** the Slack threads in `#tastebook-factory` (`C0CBSE2Q6FQ`) and the console's Runs, Inbox and Usage pages (<https://mb-factory-console.vercel.app>).
- **What changed and when:** `git log` here and in `tastebook`.

**Phase:** 4 (Dashboard and scheduled loops). Exit criterion (a) met on 28 Oct 2026 (the daily checks filed well-formed issues); (b) is the dashboard's two-week baseline, around 8 Nov.

**Next:** once the user merges tastebook#68 (the `dino` labeler), move the Dino project through the factory (TAS-72 is in review), as step 7, rebuilding the Dino Design System from the code (see [Design stage and Dino](#design-stage-and-dino)), waits on TAS-73's tokens file; watch the first `dino` review and the first spec that calls for design under [To see live](#to-see-live).

**Direction, in order:** the design stage and the Dino project (below), so the Accounts and households PRD is the first feature designed through it; then that PRD and slicing it; close Phase 4 at the baseline; then Phase 5. The [factory backlog](#factory-backlog) holds smaller factory work to pick from.

## Decisions

| Area            | Decision |
| --------------- | -------- |
| Claude plan     | Max 20x. Usage credits stay off, so the factory can never spend beyond the plan |
| Tracker         | Linear, using its Agents API: the factory is an app user (`@Tastebook`). The user is a workspace admin |
| Chat            | A Slack app per project: the factory's handle, a card per work item, the App Home and `/tastebook` |
| Docs            | Linear documents for the Vision (team document) and PRDs (a "<Project> PRD" document on each project), since stage runs read Linear; engineering and design decisions in the project repo (`AGENTS.md`, `GLOSSARY.md`, `docs/architecture.md`, `docs/design.md`); tech specs in `specs/`; the factory's own decisions here. Notion was dropped on 26 Oct 2026 (agents can't read it) |
| Stage runner    | GitHub Actions + `anthropics/claude-code-action` using `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`), as the factory's own GitHub App (`mb-factory-bot`) |
| Scheduled loops | Jobs in `factory.yaml`, fired by the console's scheduler and run as stage runs, so every factory run passes through the usage governor |
| Usage governor  | The console reads the 5-hour and weekly usage before every dispatch and holds, throttles or queues work against the policy in `factory.yaml` |
| Console         | One Next.js app on Vercel: webhook routes (the router), the scheduler and the console pages |
| Factory data    | Neon Postgres (`mb-factory-db`) from the Vercel Marketplace |
| Repos           | `mb-factory` (this repo) and `tastebook`, both **public** (unlimited Actions minutes) |
| Tastebook stack | `frontend/` (React 19, Vite, TanStack Query, react-router, Tailwind and shadcn/ui, Biome, Vitest, MSW, Playwright) and `backend/` (Django, DRF, Postgres, uv, ruff, pytest, drf-spectacular → typed client), both on Vercel as two services |

### Decisions and why

Choices whose reasons aren't in the code. Where the code says why, it isn't repeated here.

**Runs and stages**

- **Models:** spec and implement on Opus; review on Opus because it's adversarial against the project's standards (Sonnet was too lenient; about $0.80 a review against $0.19), downshifting to Sonnet when throttled; triage on Sonnet, but slicing on Opus (`models.slicing`); ask and size runs on Sonnet.
- **Slicing is chosen by title alone** (`Slice ` and a word, the user's choice). If an ordinary issue ever misfires, match `Slice <the issue's own project>`.
- **Every issue has a size, and only sized issues are ready** (the user: "stuff should always have a size"). Whoever files an issue sizes it; triage may correct it; an issue a person accepts unsized gets a size run.
- **A split's later parts stay on the tap:** each part is offered with a Delegate button once the one before it merges, never delegated by the factory.
- **Verify runs the app inside the stage runner, not against the Vercel preview** (previews were rate limited, and the project's own preview checks cover Vercel's setup). Verify always hands on to review, which treats `not met` as Blocking, so there's one loop. Implement may skip verify with `notOnScreen: <why>`, chosen over narrowing `verify.paths` (which can't tell an error reporter from a component); `verifyAgain` lets implement ask for a re-verify, chosen over re-verifying whenever a criterion was unverified.
- **Evidence:** a public Blob store per project (`tastebook-evidence`, connected to no project), uploaded by an agent-free job. `EVIDENCE_ATTACH_TOKEN` is a fine-grained personal token (contents and pull requests, Tastebook only) so the walkthrough plays in the PR; chosen over an animated GIF.
- **The factory takes on Dependabot majors and failing updates by itself** (the project's `dependabot.yml` counts as the authorisation); clean grouped PRs are left to the user; nothing auto-merges.
- **Fix limits, label names and run timeouts stay hardcoded** until a project wants other values (Phase 6).

**Review and merge**

- **Humans merge.** The user approves factory PRs as a reviewer or taps Approve and merge; the admin bypass is only for PRs the user opens; the review agent never approves and never posts a commit status (offered, declined).
- **Merge commits, not squash:** a squash commit is authored by whoever opened the PR (`mb-factory-bot`), which would drop the user's contribution credit; rebase doesn't suit branches that merge `main` in. Factory commits are co-authored by the work item's assignee.
- **Approve and merge acts as the person who taps,** through one factory GitHub App for every project (user-to-server token, 8 h with refresh, encrypted). Rejected: a personal token in Vercel (one person's, rotated by hand), loosening branch protection, and an app per project. Refusals go only to the tapper; the confirm shows review's `beforeMerging` and the project's `mergeEffect`.
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
- **The health check is plain console code, not a run:** no cost, never held, the same state gives the same message. It covers the factory's own health, not the project's app, and posts even when all is clear so a missing message stands out. Sentry issues are listed, not filed (filing waits for Phase 6).

**Hosting and deploys**

- **The console deploys through a deploy hook,** with Git deploys off (most pushes change only the plan, plugin or workflows).
- **Pro's free domain went to Tastebook** (`tastebook.dev`, registered through Vercel, renews 27 Oct 2027), not the console, which is internal and would mean re-pointing every webhook.
- **Secrets live in GitHub environments limited to `main`** (`factory`, `backups`); only `VERCEL_AUTOMATION_BYPASS_SECRET` is a repository secret, because the preview checks run on PR branches.
- **Builds stay inside Pro** (29 Oct, after $25.71 beyond Pro's $20 usage credit in a day): every project, and the team default, on a fixed Standard machine with on-demand concurrent builds off. The team budget only alerts ($35 for the cycle that began 26 Oct, then $5): its pause stops every project on the team, client sites such as goodgate.tv included, so a pause limited to the factory's projects is in the [backlog](#factory-backlog).
- **No `proxy.ts` in the console:** the Next 16 docs advise against it, so each page loader checks the session (behind `<Suspense>`) and each Server Action checks again; API routes keep their own auth.

**Tastebook**

- **Rate limiting (TAS-58, parked):** now, a Vercel Firewall rule on production `/api` by IP, done by hand. Later, per-email and per-account limits on sign-in through allauth on a Postgres cache table: **put this in the Accounts and households PRD**. Details on the issue.

### Design stage and Dino

Agreed 28 Oct 2026.

- **Dino** is Tastebook's component library: the components in `frontend/src/ui/`, built to the rules in `docs/design.md` (Picnic since 29 Oct; the code is still on Enamel until the Dino project moves it). The [Dino Design System artifact](https://claude.ai/artifact/Log29Ws2J3fTumoXaxVr1C) seeds every design canvas: tokens from `enamel.css` (Enamel's until the code moves; rebuild it then), the bundled fonts, and the app's real components (a Vite library build of `src/ui` with React left to the page's React 18, and the token declarations stripped from its CSS so the artifact's tokens win), each with a live preview and guidelines. It was built by hand on 28 Oct from `main@2de6da7`; keeping it in step with the code is still to design (a script in Tastebook, or a factory job after `dino` PRs merge).
- **Picnic replaces Enamel** (the user's pick, 29 Oct). The user wasn't happy with how anything looked, so the look was redone from the ground up on the [Tastebook directions canvas](https://claude.ai/artifact/6bH5iKkhh68SCyXuEHXnUB): five directions, then three variants of the editorial one (Supper), then Picnic against a glassy, Apple-like variant and a mix of the two. Picnic has a plum ground; Instrument Serif headlines over Nunito; pastels (peach, mint, butter, pink) that always carry dark ink text; photos as tilted, taped polaroids; stickers for diet tags; hand-drawn squiggles and arrows; times in irregular blobs; dotted leaders from ingredient to amount; and a floating dock for the tabs. The polaroid frame also evens out the catalogue's amateur Commons photos. Enamel's look and round one of the [Dino redesign canvas](https://claude.ai/artifact/2pr8dPicMYTsmPJdYvhExz) are superseded; the audit's gaps and the principles below still stand. The user accepted it after six screens (browse, recipe, two cooking-mode steps, the shopping list and adding a recipe to it) rather than drawing more: the rest are components, settled in the Dino redesign. Its rules are Tastebook's `docs/design.md` (merged in tastebook#63), with the boards exported to `docs/design/picnic/` and the NN/g and Apple principles added; it rations the playful parts (tilt, stickers, one squiggle and one doodle per screen). Dark is the only theme (decided after the boards, which lost their light tweak). The Dino redesign settled the rest on the [Dino in Picnic canvas](https://claude.ai/artifact/XaDcTWKAPapzDwhQqV44JU) (29 Oct; written into `docs/design.md` with the boards in `docs/design/dino/`, tastebook#64): each component's states, with a focus ring flush to the control (the user found a ring standing off a pill, and pills inside rounded panels, ugly: "circle in a circle"); no-photo polaroids taking turns between a drawn place setting and a gingham rug, picked by recipe; the mark, the italic "t" on peach with its squiggle; tilt off above about 150% text; and forced-colours fixes. The canvas draws the components as markup: the Dino Design System artifact is still Enamel's. A second pass the same day added the foundations (colour, type, links) and layout boards, as the reference had been phone-only with no method, links or wide screens (tastebook#65): two polaroids a row on phones, three on tablets, four on laptops with filters beside the list; titles stay 46 px at every width; with a second tab, tabs go in the top bar from tablets up and the dock is for phones.
  - **Enamel names left in the code, for the Dino project to change when it moves the tokens:** `frontend/src/ui/enamel.css` (and its imports in `main.tsx` and `components.json`, and the comment in `playwright.config.ts`), the comment in `cn.ts`, the lint message in `tools/biome/no-arbitrary-radius.grit`, the fonts in `package.json` and `e2e/styleguide.spec.ts`, the light theme (the light tokens and `data-theme` in `enamel.css`, `theme-switcher.tsx` and its tests; set `color-scheme: dark`), `/styleguide` and its copy (Storybook replaces it), the favicon, and `AGENTS.md`'s `src/ui/` line. Outside Tastebook: the Dino Design System artifact (rebuild it), and the factory's Slack avatar (`projects/tastebook/slack-assets/avatar.svg`, cobalt on yolk), to redo in Picnic on a canvas first. Specs, finished Linear issues and test fixtures that name Enamel are history and stay.
- **Two artifacts, two jobs:** the Design System artifact is the reference, drawn by claude.ai's own page, so Claude can't see it rendered; review happens on Design canvases Claude writes (the user asked why Chrome was being used to look at the system: don't). A canvas installs a copy of Dino under `project/ds/dino/` (tokens, bundle, fonts) with a `designSystems` record, and mounts the real components with `<x-import component-from-global-scope="Dino.Button">`; after Dino changes, copy its files again and bump the record's version. Tastebook is dark only (the user's call, 29 Oct, to keep it simple): no light theme and no toggle, so canvases are dark with no theme tweak.
- **Slicing hints at design (proposed):** slicing marks each slice it thinks needs design, and files the new Dino components a project needs as their own slices ahead of the features that use them. The spec still decides. The Accounts and households PRD is the first test.
- **The design stage** follows Spec Review: `triage → spec → Spec Review → design → Design Review → implement`. The spec decides `design: needed` or `design: skip (<why>)`. Skip it when the change reuses existing components with no visual change, it's a small UI change within the rules, or the reference boards already draw it, whatever its size (added 29 Oct so the Dino restyles, TAS-73 to 83, don't go through design again). It's needed for a new screen or flow, a new or changed Dino component, or a visible layout change.
- **A person in the loop on a claude.ai Design canvas:** the router starts a claude.ai/code session (a routine); it drafts the canvas from the spec and Dino, then posts the link to the card and Linear. The user iterates in that session and approves from there or from Slack.
- **The whole flow, drawn** (29 Oct, after the user found the flow confusing): the [Tastebook Design Flow page](https://claude.ai/artifact/M2hMHwchvFc7Pxpp8iVfY6) shows it as a swimlane, with a design round, a component's life, where each design file lives and what's unbuilt. Its answers to the open questions were agreed the same day (the user had no comments): each round is a fresh fire (the canvas and issue hold the state, so a waiting design costs nothing; the morning Ready list mentions one waiting over a day); iterate by chatting live, or Request changes with a note, which fires a new round; the Design Review card has Open canvas, Approve, Request changes and a separate Back to spec; canvases load `design.md` and the boards until TAS-73 lands and the Dino Design System is rebuilt, then the real components; the session files the `dino` issues at hand-off. Both unknowns were tried on 29 Oct (below).
- **Canvas comments reach a cloud session** (tried 29 Oct with a throwaway routine): a comment the user sends to Claude (Send to Claude on the thread) wakes the idle session as a new turn within seconds, even after its first turn has ended; plain comments don't. The wake carries only the thread id, so the session reads the thread with `ArtifactComments`, which gives the board and element it's pinned to (`Main.dc.html … text "Cook"`) and what was in view when it was sent; it replies as "Claude · via the user". So canvas comments are a third way to iterate while a session lives, and any fresh fire can read every comment, sent or not. How long a session stays wakeable is unknown, and a wake's usage isn't gated by the governor: keep each round a fresh fire, and treat comment wakes as a bonus.
- **The session exports PNGs itself:** neither the Design type nor the Artifact tool has an export it can call (the type's Export PDF and Share › Export are buttons on the page), but the cloud sandbox has Playwright's Chromium, and rendering each `*.dc.html` at the board's size gave correct PNGs (fonts loaded, nothing clipped). The canvas runtime `support.js` isn't there locally, which is harmless for plain markup but will matter for boards that use template code or `x-import` Dino components: copy it from the Design type's files first. So TAS-74 doesn't need the user to export boards. The session also ignored the Dino design system ("none is set as default"), so the design prompt must name what to load.
- **Two kinds of design work:** system work (a new look, foundations, layout, the mark) stays by hand, the user with a Claude Code session on a canvas, ending in a `design.md` PR and a filed project; feature work goes through the design stage, within the rules, and may propose a rule change that the user approves with the design.
- **Handoff by export:** stage runs can't read claude.ai, so on approval the session commits `specs/<ID>/design/` (the artboards as HTML and PNG, plus notes) to the spec branch. Implement builds from that; the canvas link stays on the issue for people.
- **Primitives first:** whenever a reusable Dino component fits better than one-off UI, the design stage proposes it, with the variants and states it should grow into. Only a new component the feature's boards use blocks it (agreed 29 Oct, to avoid pedantry): it's its own issue labelled `dino` and lands first with its stories. A changed component (a new variant, size or state) still means `design: needed`, but it's built in the feature's PR with its story, and the labeler's `dino` brings the rubric. Anything noticed but unused by the feature is a non-blocking `dino` backlog issue or a hand-off note. This replaces `AGENTS.md`'s rule of three for UI components; the rule still applies to code abstractions.
- **The `dino` label** goes on every PR touching Dino, applied by Tastebook's labeler workflow (`actions/labeler` on `pull_request`, as the factory's PRs come from the repo's own branches). Review adds the factory's `design-system-rubric` when a PR carries the label the repo's `AGENTS.md` names for its design system: the user's pick (29 Oct) over a `factory.yaml` setting or hard-coding `dino`, so the factory stays generic and the project's words stay in its repo.
- **Storybook replaces `/styleguide`:** stories per component and state, the accessibility addon, interaction tests through Vitest; verify can screenshot stories.
- **Pixel-perfect by code and screenshots, not prose** (agreed 29 Oct): `docs/design.md` holds the rules agents can't infer from a board; matching the look rests on three things. One tokens CSS file in the code that the canvases load too (via the rebuilt Dino Design System artifact), with the same bundled font files, so values and rendering can't drift. Components built once, implement copying exact values from the board markup, with story state names matching the boards' (`is-hover`, `is-pressed`…). And a screenshot diff in verify: render each board and its story at the same size, diff them, and send anything over a small threshold to review with both images; an approved story's screenshot becomes its baseline.
- **First project, Dino:** audit the existing components against Enamel, build the Dino Design System artifact, redesign them in Picnic with the user on a canvas (done 29 Oct), then file a Linear project: Storybook first, then the shared tokens file and fonts, then the board-versus-story screenshot diff, then an issue per component or group. Filed by Claude on 29 Oct (the user chose direct filing over a PRD sliced by the factory) as the Dino project with the `dino` label, ending with the pages laid out as on the Picnic boards. The dock is left out until a second tab exists (only Recipes today). Once the tokens file lands, rebuild the Dino Design System artifact from it, by hand on claude.ai.
  - **The audit (28 Oct):** Button has no `lg` (52 px, cooking mode), no hover except ghost, no pressed or loading state; IconButton and ServingsStepper have no `lg`; SegmentedControl is separate toggles, not a single-choice group (no arrow keys, no "1 of 2"); Sonner animates toasts over 400 ms (the rules say 200 at most); the ingredient picker uses `shadow-lg` with no shadow token; there's no plain dialog or sheet; Banner has no action slot; the wordmark is hand-written in `home-page.tsx`, the Mark isn't drawn and the favicon (an orange book) is off-brand.
  - **Primitives the code already needs:** a combobox (`ingredient-picker.tsx`), error-with-retry (four places), a chip group (`FilterGroup`), a fact list (`recipe-facts.tsx`), a section with its heading, a meta line ("35 min · Easy · Italian"), a loading state.
  - **Principles (agreed 28 Oct):** NN/g's ten heuristics and Apple's eight design principles, written into the Dino brand book's Principles section and into Picnic's `docs/design.md`; review cites them ("NN/g 1", "Apple Agency").
  - **Evaluated against them (28 Oct):** no pressed state on any control and no loading state (NN/g 1, Apple Familiarity); SegmentedControl isn't a radio group (NN/g 4, 7); a disabled Button never says why (NN/g 5, 9); no Undo-first pattern beyond the toast, so deletes lean on confirming (NN/g 3, Apple Agency); no sheet for light tasks; no safe-area padding, `viewport-fit=cover`, web manifest, `theme-color` or touch icon, so a home-screen Tastebook would sit under the notch with the off-brand icon (Apple Flexibility, Craft); no `inputMode` on number fields (NN/g 5); chips and pressed states shown by fill alone vanish in forced colours (Apple Flexibility); toasts at 400 ms (Craft). Strong: error copy and empty states (NN/g 9, 10), kitchen words (NN/g 2), 44 px targets, both themes, reduced motion, native select, bundled fonts (Apple Responsibility).
  - **Left for the design stage to find:** the Accounts and households components (avatar, menu, text area, switch, tabs, app bar) and cooking mode's (timer, step view; drawn in Picnic's cooking-mode board).
- **Starting the session (checked 28 Oct against the [scheduled tasks docs](https://code.claude.com/docs/en/routines)):** a routine with an API trigger has a bearer token scoped to firing that one routine. The console POSTs to its `/fire` endpoint (beta header `experimental-cc-routine-2026-04-01`) with the issue in `text` and gets back the session URL. The token is made on the web only, once, and kept in Vercel. The session runs as the user: commits under their GitHub identity, connectors as their accounts, usage from the same plan, so the governor gates the fire like a dispatch. Fire text arrives as untrusted data, so the saved prompt must opt in to reading it; keep that prompt thin and the behaviour in a plugin skill. Its network is allow-listed, so add the console's host for reporting back. Limits: 30 fires an hour per routine. It's a research preview.
- **A cloud session can make a Design canvas** (tried 28 Oct with a throwaway routine fired by Run now, 23 s): it took the fire text and created the canvas from the Design type. A canvas is a `canvas.json` plus one `*.dc.html` file per artboard, written locally and then published, so the export to `specs/<ID>/design/` is those same files. Routines made through the API include every connector on the account by default: list only the ones the design session needs.
- **Built so far:** (1) the spec's design call, in its report and the spec (29 Oct); (2) the `design` and `design_review` stages, a `design` agent and the `design_approved` trigger (29 Oct). A project turns the stage on by naming `design` and `designReview` in its `linear.statuses`; Tastebook doesn't yet, so approvals still go straight to implement and only log `spec design`. Approval of a spec that calls for design creates a `design` run, a reply at Design Review approves (implement with `design_approved`) or revises (a `design` run), and a finished design run waits at Design Review; the card shows a Design step only on work that goes through it. (3) the design routine (29 Oct): after the governor's go-ahead the console fires the project's routine (`design.routine` in `factory.yaml`, token in `DESIGN_ROUTINE_TOKEN`) with the brief as JSON (`designFireText`: the issue, spec branch and PR, trigger, the person's words, the last canvas, the spec's design call, and a report URL with a pass signed for the run), marks the run running with the session as its run log, and the session follows `plugin/agents/design.md` and POSTs its stage report to `/api/runs/<id>/design`. The console then posts the report's summary to Linear as the Design Review elicitation, as for any run. A session that doesn't report within 60 minutes is ended as failed. The routine is "mb-factory design (Tastebook)", `trig_015ytNVnxYsCys81Mnm6A8N4`, with mb-factory and Tastebook checked out and only the Claude connectors. Set up on 29 Oct: the routine's own cloud environment "mb-factory design" (`env_013gXp1wqMqNqUm44pJ5YV4G`: Custom network, the console's host plus the default list; Default is left alone for the mail triage routine), and its API trigger, with the token in Vercel as `DESIGN_ROUTINE_TOKEN`. Still to set up: the Design and Design Review statuses in Linear's TAS workflow (type Started); then Tastebook's `factory.yaml` gets `design.routine` and the two statuses. Saving the routine in the web UI added a default branch per repository (`claude/…`): step 5 must check the session can push the boards to the spec's branch. (4) the Design Review gate (29 Oct): a thread message and card buttons Approve, Change something and Back to spec, with Open canvas on the card and the Inbox; Back to spec moves the work to Spec Review and asks what to change, and the next approval designs again from the same canvas. A gate button answers whichever review is open, since an answered gate's message loses its buttons. In Linear the run's summary is the elicitation, so the agent's summary names the same answers. (5) the hand-off (29 Oct): Design Review's Approve starts a `design` run with `design_approved`, which renders each board to PNG (with the Design type's `support.js` beside it) and writes `notes.md`, then sends the boards' HTML, PNGs and notes with its report; the console commits them to `specs/<ID>/design/` on the spec's branch with `GITHUB_DISPATCH_TOKEN` (Git's data API, co-authored by the assignee; a failed commit fails the run), so the session needs no push access. With no new component, implement starts with `design_approved` and the approval's suggestions (also in `notes.md`); with new ones, each is filed as "Add <Name> to Dino" in the feature's project and Backlog, labelled `dino`, blocking the feature, which waits with the Blocked label until a person replies. Implement reads `specs/<ID>/design/` whenever it exists. Extensions, not built: start the feature by itself when its last `dino` issue merges; carry the approval's suggestions into that later implement run's brief as well as the notes. (6) the label and rubric (29 Oct): tastebook#68 labels `dino` on `frontend/src/ui/**` (TAS-73 moves the glob with the rename) and says so in `AGENTS.md`; `plugin/skills/design-system-rubric` is preloaded into review and checks values against the approved boards' markup, every state the doc defines, a story per state named as on the boards, a generic component shape, what axe can't see and the doc's rules, citing `Board ›` and `Design ›`. A PR opened before the labeler only gets the label once main is merged into its branch.
- **Dino lives in `frontend/src/dino/`** (renamed from `src/ui`), so the labeler and the rubric key off one path.

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
| Scorers / Self-improvement / Benchmarks   | Phase 5: LLM-judge scorers, PRs that improve the plugin's own prompts and skills, a fixed task suite rerun against config changes |

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
- **Humans merge.** Branch protection on `main`; agents never merge.
- **Capped loops.** Review → revise runs at most twice, then hands to a human.
- **Usage-aware.** Plan limits are the real constraint, shared with the user's own Claude use. Every dispatch goes through the [usage governor](#usage-governor).
- **Measure from day one.** Every run is recorded, so later changes have a baseline.
- **Public-repo hygiene.** Issue, PR and comment text is data, not instructions. Only Linear workspace members and allow-listed Slack users can start work. Secrets stay in Actions environments and Vercel.

### How it works

A map for reading the code. Pure decisions live in `packages/core`; the console's `lib/` does the I/O.

- **Stage runs:** core `brief.ts` builds the brief → `factory-stage` repository dispatch → the project's `.github/workflows/factory.yml` → this repo's `.github/workflows/stage.yml` → `app/api/runs/[id]/start` (GitHub OIDC) → `claude-code-action` hands over to `mb-factory:<agent>` (`plugin/agents/*.md`) → `app/api/runs/[id]/report`; core `run-report.ts` turns the report into the run's status, outcome and usage. Ask runs read Linear through `app/api/runs/[id]/linear` (core `linear-proxy.ts`); ask and size runs skip project setup.
- **Router:** core `router.ts`, `stages.ts`, `work-item-events.ts`; console `lib/router.ts`.
- **Webhooks:** `app/api/webhooks/{linear,github,slack}`, plus `slack/interactions` and `slack/commands`. Each delivery is recorded in `events`; duplicates are skipped.
- **Governor and usage:** core `governor.ts`, `usage.ts`; `dispatchRun` in `lib/router.ts`; `.github/workflows/governor.yml` (the probe, dispatched only); the local reporter `cli/status-line.sh` → `app/api/usage/local`.
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

Every behaviour worth tuning is a Markdown file under version control, changed through a commit to this repo (factory-as-code); Phase 5's self-improvement proposes changes the same way.

| Layer                | Where | Examples |
| -------------------- | ----- | -------- |
| 1. Factory defaults  | `plugin/agents/*.md`, `plugin/skills/*/SKILL.md` | How triage researches and sizes, when a spec is needed, the review rubric, how agents report |
| 2. Project overrides | `factory.yaml` knobs (per-project instruction files later, Phase 6) | Models, gates, review rounds, jobs |
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

The factory runs on the same Max 20x limits as the user's own Claude use. The decision logic is in `packages/core/src/governor.ts`; the policy is `usage` in `factory.yaml`.

| Source | What it gives | When |
| ------ | ------------- | ---- |
| **Run telemetry** | `rate_limit_event` in the run's `stream-json` output: `five_hour` / `seven_day` utilisation, reset time, status | Every stage run's report |
| **Probe** | A tiny headless call (`claude -p`, cheapest model) from `governor.yml` | 8 minutes before a scheduled job when readings are stale, and Refresh on the Usage page |
| **Local reporter** | The Mac's Claude Code status line (`cli/status-line.sh`), which also measures the user's own use | Whenever the user uses Claude Code |

- **Open:** dispatch normally. **Throttled** (5-hour `throttleAt`): only in-flight and urgent work, cheaper models (`downshift`), scheduled jobs skipped. **Paused** (`pauseAt`, weekly pacing, or the pause switch): nothing dispatches; held work queues and is released, highest priority first, when the window allows.
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
- **Console logs:** `vercel logs -p mb-factory-console -e production -s 30m -n 500 --json`; each line's message is the console's JSON log. `vercel crons run /api/scheduler/cron` wakes the scheduler by hand. Read logs promptly (Pro's retention unchecked).
- **Secrets:** to GitHub with `! pbpaste | gh secret set NAME --env <env> -R milobedini/tastebook`, or a script the user runs; never a bare `gh secret set` through `!` (no terminal, empty value). To Vercel, the user runs `vercel env add` (blocked for Claude in auto mode). When a job that uses a new secret fails, suspect the paste first (twice it carried extra text).
- **Slack:** the `slack-tastebook` MCP (local scope, `https://mcp.slack.com/mcp`, the Slack plugin's client ID `1601185624273.8899143856786` and callback port 3118) reads `#tastebook-factory`; read freely, ask before posting. Preview Block Kit by rendering core's JSON in a throwaway Vitest file and opening `https://app.slack.com/block-kit-builder/#<url-encoded JSON>`. `/tastebook ready` runs production's `loadReadyList`.
- **Sentry:** the `sentry` MCP (org `milo-bedini`, region `https://de.sentry.io`, project `sentry-gray-fountain`). The user's Chrome has an ad blocker, so browser checks of third-party scripts fail there.
- **Neon (Tastebook):** the `neon` plugin, project `tastebook` (`green-resonance-43539979`), branch `production` (`br-shy-butterfly-za1yk0b6`), database `neondb`. Read-only unless asked; ask before anything destructive; never fetch connection strings through it. A restore trial uses a throwaway branch from production (never a preview branch, which is already a copy).
- **Tastebook's local clone** (`~/Documents/git/tastebook`) is linked to Vercel; its `.env.local` holds the photos Blob token and an OIDC token. Stage runs have no Vercel token, so Vercel changes (firewall, settings) are a person's step.
- **Usage token** for the status-line reporter: `~/.config/mb-factory/usage-token`.
- **Rebuilding Dino's artifact files** (28 Oct, by hand): a Vite library build (`iife`, global `Dino`) of an entry that re-exports `@/ui`, run from `tastebook/frontend` with the scratch folder's `node_modules` symlinked to the frontend's; `react` and `react-dom` external as `React`/`ReactDOM`, and `react/jsx-runtime` aliased to a shim over `React.createElement` (React 18's UMD build has none); RecipeCard wrapped in a `MemoryRouter`; Lucide icons exported as `Dino.icons`. Strip the `--color-*`, `--radius-*`, `--font-display`, `--font-body`, `--spacing`, `--cuisine-*` and `--plate` declarations from the built CSS so `tokens.json` wins, prefix the bundle with its `@ds-bundle` header, and render each preview in jsdom before publishing. The scripts lived in a session scratchpad: rebuild from this note until the sync is designed.
- **Onboarding sessions** ran with the `mattpocock-skills:grilling` skill: rounds of numbered questions, each with a recommended answer; Claude looks facts up itself, summarises, and asks before writing; the write-up goes where its readers look. Design directions were private claude.ai artifacts ([Enamel](https://claude.ai/artifact/BD7Up5iuWptCLTcsAD67Qm), [style guide](https://claude.ai/artifact/8XJh3x55GzARA7uFBHspxc)), copied into the repo since agents can't read claude.ai.

## Gotchas

Learnt the hard way; each would bite again.

**Claude Code and the action**

- `claude-code-action` hides the agent's output and runs keep no transcript, so a run that ends without a report and pushes nothing can't be diagnosed (see [Run transcripts](#run-transcripts-after-phase-5)).
- Job-level `env` and the `settings` input reach Claude's Bash tool. `execution_file` is a JSON array of stream-json events. The action skips the App token exchange when the workflow differs from the default branch's.
- A reusable workflow sees an environment secret only if the caller names it in `secrets:` (Tastebook's `factory.yml` missing `EVIDENCE_BLOB_READ_WRITE_TOKEN` made it empty).

**GitHub**

- Scheduled workflows are best-effort: GitHub drops slots (6 of about 98 fired one day) and runs others hours late; in a public repo they stop after 60 days without activity. Scheduled failures are emailed to whoever last changed the cron: after the bot touches one, disable and re-enable it as the user.
- No webhook fires when a PR becomes conflicting, a conflicting PR runs no CI, and `mergeable` can stay stale against an old base.
- Environment names are case-insensitive, and Vercel creates a `Production` environment (hence `backups`).
- Dependabot runs as soon as `dependabot.yml` lands; labels it adds must exist; its lockfile can move unrelated packages backwards; `cooldown` doesn't apply to security updates.

**Linear**

- The app can't create team labels (`not allowed to take action`): create `factory`, `Blocked` (`#eb5757`), `docs` and `security` by hand.
- A session opened with `agentSessionCreateOnIssue` still sends `created` about 0.3 s later, so claiming the work item must be atomic.
- A `prompted` body arrives in `agentActivity.content.body` (not as documented); a stop is `prompted` with `signal: "stop"`.
- The GitHub integration's "review requested" automation must point at Awaiting Merge, or it undoes the merge gate.
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
- The first wake after a deploy fires the day's missed slot as a catch-up, which reports itself late.

**claude.ai artifacts and routines**

- A Design canvas re-saves its files from the page on its own (it re-encodes `data-props` as entities), so a publish can land on a version newer than the one read. The tool merges and warns; when the page's change was only that encoding, nothing is lost. Read a file again before editing it if a publish reports one changed.
- An artifact publish refuses a `.ts` file: send it with `contentType: "text/plain"`. A publish over a file the user has edited on the page is refused: read it, redo the change on their version, publish again.
- Apple's HIG pages are empty without JavaScript; fetch `developer.apple.com/tutorials/data/design/human-interface-guidelines/<page>.json` instead.
- `RemoteTrigger` can disable a routine but not delete it (the user deletes it at claude.ai/code/routines).
- The routine edit dialog keeps Save disabled while the trigger reads Schedule › Manual (an API-made routine with no cron): add the API trigger first. Saving there also sets a `claude/…` branch per repository.
- A routine created with `mcp_connections: []` still gets every connector on the account (Gmail, Drive, Notion…); an `update` with an explicit list does stick. Set the list in an update before the first fire.
- A canvas frame clips whatever runs past its `h`, and Claude can't see it rendered: on 29 Oct five of the Dino boards were cut off. Add up a board's content before setting its height, err well over (over-tall beats clipped), and change the root's height, `$preview` and the index's `h` together. After any canvas change, copy the boards into Tastebook's `docs/design/` again so the repo matches.

**Neon, Drizzle, Next**

- Use the Neon-managed Vercel integration (it deletes preview branches with their Git branch; the free plan allows 10).
- `db:migrate` can stall silently on the websocket driver: stop it and run it again.
- `runs` has a check constraint on what a run belongs to: a new kind of run needs a migration.
- Next 16: database calls in a page loader fail in `after()` and in a prefetch's prerender (`await connection()` first); a page awaiting `searchParams` outside `<Suspense>` fails Vercel's prerender while `tsc` and tests pass. A failed Drizzle query's `cause` holds the real error.

**Tooling**

- pnpm 12 fails installs on unapproved build scripts (`allowBuilds`) and defaults `minimumReleaseAge` to a day; uv's equivalent is `exclude-newer`. Biome formats YAML: exclude generated files. `astral-sh/setup-uv` has no major tags.
- zsh: quote bracketed `gh api -f` fields, and never name a variable `path`.

## To see live

Built but not yet seen working; delete each line once seen.

- **Fri 30 Oct morning:** the wake-ups collapse to one: the copies booked before `a255969` still arrive at 05:52 and 06:00, then one `woke` a slot (count them in the logs), with one governor probe each at about 05:52 and 06:22; the backup ran near 02:17 (29 Oct's hadn't run by 07:40 and was dispatched by hand); a `morning ready list` line beside the Ready message (29 Oct's message posted, but the line was missing).
- **Design call:** TAS-72's spec wrote `Design: skip — …` under Evidence (seen 29 Oct); still to see: the call in the approval message, and approval logging `spec design` with the call and `next`.
- **Design stage (on since 29 Oct):** the first approved spec with `Design: needed` (an Accounts and households slice, most likely): a `design` run fires the routine and moves the issue to Design, its run log opens the session, the canvas link arrives in Linear and Slack with the Design Review gate and card buttons; Change something and a comment sent to Claude each revise the same canvas; Approve commits HTML, PNG and `notes.md` to `specs/<ID>/design/` on the spec branch, then implement starts, or the `dino` issues are filed blocking the feature with the Blocked label; Back to spec reopens Spec Review.
- **Dino rubric:** the first PR the labeler marks `dino` gets a review whose findings cite `Design ›` or `Board ›` Refs, and none for a missing board when the work had none.
- **Mon 2 Nov:** the weekly security and docs passes from their own slots (05:00, 05:30).
- **Runs:** a timeout saying "ran out of time" and waiting with Re-run; a stopped card reading Stopped with Re-run; a stale Re-run button re-running the latest run; a held run with no `slack card failed` burst; a usage hold booking its wake and starting soon after the reset; a lapse wake firing; a `limit_hit` resume; Linear's stop signal; a human push counted in `human_pushes`.
- **Work items:** an undelegated item reading Not delegated and leaving the Inbox; the Blocked label going on and off; the health check flagging a stuck run.
- **Specs and splits:** approval after a revision still filing the parts; a part with `blockedBy` outside its split; a reply asking for an issue getting it filed.
- **Review and merge:** an accepted review with Nits ([Fix ticked] [Approve and merge] and what follows); a lockfile-only conflict merged without an agent; a failing Preview checks run starting a CI fix; a conflict or failing check while review is asking; an Approve and merge refusal; co-authored commits on the contribution graph (the user checks).
- **Slicing (Accounts and households):** triage reading the PRD from Linear, the gate in Slack with buttons, slices filed into Backlog.
- **Slack:** App Home Refresh, Pause and Resume; `/tastebook` pause, resume, status and unknown words; the Ask flows (Start from a "for later" thread, a top-level request, a question while paused); the :eyes: reaction; Ready messages' "no longer ready" and failed-start rows.
- **Health:** a "New in Sentry" section; a "Scheduled workflows" section; a repeat check finding skipped as already filed.
- **Elsewhere:** the dashboard at phone width and in light mode; the first production POST on `tastebook.dev` (CSRF).

## Factory backlog

mb-factory isn't a factory project yet, so its own follow-ups live here. Each is unbuilt (checked 28 Oct 2026).

- **PRD flow:** start a project's PRD with a person in the loop and, on approval, file "Slice <project>". Open: drafted as a Linear document? steered by questions then a gate? which agent? does approval delegate the slice issue?
- **Size runs:** 3 size runs gave no size on 28–29 Oct (29 Oct's health check); not looked into.
- **Scheduled reliability:** dispatch Tastebook's backup from the console's scheduler, as GitHub keeps dropping it (28 Oct's ran 6 h late; 29 Oct's hadn't run by 07:40); the health check lists failed scheduled runs but not missing ones, doesn't see project deploys, nothing reports the console being down, and a run stuck then cleared between checks goes unseen.
- **Spend and deploys:** the health check flags any Vercel on-demand spend (`vercel usage`) and a failed production deploy (8 hours of failed Tastebook deploys went unseen on 29 Oct); the budget's webhook points at a console route that pauses only `tastebook` and `mb-factory-console` at 100%, leaving the rest of the team's sites up.
- **Merge state:** re-check PRs whose merge state stays unknown (needs a record of which); make `merge state unknown` a warning only when it changes an outcome; a PR handed over for conflicts is told again on every later push to `main`, and the CI hand-over repeats on every later failure.
- **Merge conflicts:** compare lockfile contents after an agent conflict fix (CI regenerates and fails on a difference); flag issues touching the same manifests in the Ready list; conflicts and their cost on the dashboard; union merge for `GLOSSARY.md`.
- **Dependencies:** triage Dependabot majors before implement (check runtime versions, peer ranges, `AGENTS.md`); learn from an unmerged close (ask why, propose an ignore rule or a lesson).
- **Stage runner security:** the stage job's own secrets share a runner with an agent that has sudo and can write `$GITHUB_ENV` (the reasoning that split out the evidence job); the security check doesn't cover `mb-factory`; `security-rubric` has no category for untrusted text reaching a renderer or prompt, and its unpinned-actions row contradicts its no-best-practice rule.
- **Verify:** triage's `next: verify` maps to implement in core (`router.ts`), so `triage.md` and the behaviour disagree; verify on previews.
- **Sentry:** issues that came back or grew, an environment filter, filing issues (Phase 6).
- **Slack:** `/tastebook pause [reason]` (no reason column); an Approve tapped in a `/tastebook status` reply leaves it stale; the Home usage bar renders small (try coloured squares); debounce Home republishing if `views.publish` rate-limits; follow-up questions in an ask thread do nothing.
- **Console:** a live Runs page (times counting up, the agent's latest thought); usage over time with runs overlaid and the factory/you split; a weekly evidence clean-up (before the Blob store passes about 500 MB); exact Actions minutes; scorer cards (Phase 5); a project filter (Phase 6).
- **Router:** a PR reopened after an unmerged close isn't handled; reviewer per project from the Linear project's lead.
- **Jobs:** backlog grooming (stale, duplicate, unclear, unsized, blocked only by finished issues), through the read-only Linear proxy; `autoDelegate` once trusted; guards proposed to the shared plugin (Phase 5).
- **Linear housekeeping (by hand):** swap the stale Notion "Vision" links on the projects for the Linear Vision document; pin the TAS Overview sections.

## Phases

| #   | Phase | Exit criteria |
| --- | ----- | ------------- |
| 0   | **Foundations**: monorepo, console with webhooks and DB, Linear agent app, Slack app, `tastebook` starter with CI and branch protection, draft instructions | Closed 24 Oct 2026 |
| 1   | **First loop, run log and governor** | Closed 25 Oct 2026 |
| 2   | **All stages and the Runs page** | Closed 25 Oct 2026 |
| 3   | **Slack intake, questions and Inbox** | Closed 26 Oct 2026 |
| 4   | **Dashboard and scheduled loops**: dashboard metrics; health, security and docs checks through the governor; weekly pacing, priorities, downshift, local reporter | The dashboard shows a two-week baseline; loops file well-formed issues (met 28 Oct) |
| 5   | **Scorers, self-improvement and benchmarks**: scorer task, self-improvement PRs on the plugin, a benchmark suite, the weekly Slack report | At least one accepted self-improvement PR; one benchmarked config change |
| 6   | **Reusability**: onboarding a second project (wiring, the onboarding interview, settings per project) | A second repo runs through the factory with config only |

**Weekly factory report (Phase 5):** a top-level Slack message in the project channel, Mondays 07:30 London: last week's merged PRs, autonomy, median cycle time, cost and anything stuck, linking `/dashboard?days=7`; plain console code, no run.

### Run transcripts (after Phase 5)

Deferred by the user on 28 Oct 2026, after a TAS-48 implement run ended without a report and nothing showed why. Keep each stage run's transcripts: the session and subagent `.jsonl` files under `~/.claude/projects` on the runner, written as the run goes, so a run stopped at its time limit keeps them too. An `if: always()` step uploads them to private Vercel Blob (not Actions artifacts: on a public repo any signed-in GitHub user can download those), the run records the link in `runs.transcript_url`, and the Runs page links it. Storage costs next to nothing; the care is secrets in tool output (private store, a retention to agree, perhaps 14 days).

### Per project and shared (Phase 6)

By Phase 6, everything that can be scoped by project should be. Already per project: `factory.yaml`, work items, runs, jobs, findings, Slack channel, Linear team. Shared on purpose, because they guard the one subscription: the governor and readings, the pause switch, the run cap (`concurrency.maxRuns` and `usage` must move to one factory-wide config with a second project). To split: `console_problems` (add `project`), the console pages' filters.

**Hardcoded, candidates for per project:** agent instructions (several examples are Tastebook-shaped: the security agent assumes `pnpm-lock.yaml` and `uv.lock`); fix limits (`MAX_CI_FIXES`, `MAX_CONFLICT_FIXES`); the Dependabot policy (`dependencies.ts`); filing thresholds (`security-rubric`); label names; stage run limits and allowed tools (`stage.yml`).

**Acting on the health check:** most of what it finds is a factory problem in `mb-factory`, which no agent can work on. Direction: onboard `mb-factory` as a project, so a new error becomes an issue the factory triages and fixes (with care: the factory changing its own code); clean up stuck cases deterministically and say so; file each new error as a Triage issue, deduplicated. The same step lets the security check cover `mb-factory`, and moves the [factory backlog](#factory-backlog) into Linear (agreed 28 Oct 2026), so it has a status like any other work.

### Project onboarding (Phase 6, tried by hand on Tastebook)

Onboarding is an interview in four sessions, each writing where its readers look (Tastebook's four ran on 26 Oct 2026):

| Session | Covers | Written to | Read by |
| --- | --- | --- | --- |
| Product | the product plan and main use case, users, core features | the Vision document, then the first PRD (Linear) | spec, slicing |
| Engineering | the stack beyond the core (monitoring, auth, email), hosting and previews, code style and architecture, component primitives, the standards review checks | the project repo: `AGENTS.md`, `GLOSSARY.md`, `docs/architecture.md`; Linear issues for setup work | implement, review, verify |
| Design system | a few visual directions as HTML pages, then tokens, type, shape, components, rules | `docs/design.md` and a reference page; an issue to build it | implement, review, verify |
| Factory | scheduled jobs, models, gates, review rounds, thresholds | `factory.yaml` | console, router |

- **Learnt on Tastebook:** product documents go in Linear; the design system deserved its own session; the engineering session also produced a Platform project of setup issues; every session ends with a by-hand PR so agents read the decisions from the repo.
- **A platform baseline the factory hands down:** previews checked before review, nightly backups with a tried restore, errors reported, secrets in environments limited to `main`, the factory's own GitHub App, and deploying only when the app changes where the platform allows it (not on a Vercel Services project). Write it as a checklist in the onboarding doc, with what each caught on Tastebook.
- **Wiring checklist:** create the factory's labels by hand (Linear refuses the app); the caller workflow names every secret `stage.yml` declares; Vercel `createDeployments` on; install `mb-factory-bot` on the repo (Contents, Pull requests, Issues and Workflows write; Actions, Checks and Commit statuses read) and give the repo's `factory` environment `FACTORY_APP_CLIENT_ID` and `FACTORY_APP_PRIVATE_KEY`; `people[].github` for whoever may merge from Slack, and `mergeEffect`; the Slack app from `projects/<name>/slack-manifest.yaml`, its icon, the emoji rendered with `slack.emojiPrefix`, and the channel, `allowedUserIds` and prefix in `factory.yaml`; the Linear team's Overview as the project's front page (Product, Factory and Engineering sections; the connector can't pin, so GraphQL or by hand).
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
