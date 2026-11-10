# Merge queue

Tastebook moves into the `Milo-Bedini` organisation so it can use GitHub's merge queue in place of the "up to date with `main`" rule. Agreed on 10 Nov 2026, after a trial in `Milo-Bedini/merge-queue-trial` proved it works with the factory's App. This document records why, the trial, the design and the migration. [PLAN.md](PLAN.md) holds the short decision and what to do **Next**.

## Why

Since 29 Oct a Tastebook PR merges only once it's up to date with `main` (the Checks ruleset's strict status checks). The rule went in after two pairs of PRs, each green alone, turned `main` red when merged minutes apart (TAS-74 and TAS-82; TAS-76 and TAS-92). Neither pair conflicted in git, so the guard is right: what's wrong is how it's paid for.

- **Nothing conflicts.** The console merges `main` into a waiting PR only when GitHub doesn't know of a conflict (`shouldBringUpToDate`); a real conflict goes back to implement. Every merge of `main` is the rule, not a conflict.
- **Each one re-runs CI.** About 7 minutes (Frontend is the long pole; 8 checks in all). Of the 70 PRs merged 4–10 Nov, 21 took `main` at least once, 27 times in all.
- **Waiting PRs race.** When `main` moves, `checkConflict` brings every PR at the gate up to date at once (`apps/console/lib/router.ts`). All re-run CI, one merges, the rest go round again: N waiting PRs cost about N² CI runs and land one at a time. On 5 Nov, #135–138 opened between 18:02 and 18:05 and merged at 18:48, 19:19, 19:41 and 19:49; #138 took `main` four times.

The user also asked for a way to batch many small issues together. A merge queue is that batching: it tests PRs together and merges them together, so no separate feature is needed.

## Merge queues on GitHub

- **Who can use one:** "Pull request merge queues are available in any public repository owned by an organization, or in private repositories owned by organizations using GitHub Enterprise Cloud" (GitHub's docs source, `data/reusables/gated-features/merge-queue.md`). A repository owned by a personal account can't, on any plan. A free organisation is enough for a public repository.
- **How it works:** a queued PR is built on a temporary `gh-readonly-queue/main/pr-<n>-<sha>` branch holding the latest `main`, every PR ahead of it in the queue and itself; GitHub runs the required checks there (Actions through the `merge_group` event) and merges once they pass. A PR whose group fails is removed, and the groups behind it are rebuilt without it. PRs queued together are tested together rather than one after another.
- **It replaces "up to date":** the queue gives the same guarantee as strict status checks without the author bringing the branch up to date and waiting for CI each time `main` moves.

## The trial (10 Nov 2026)

`Milo-Bedini/merge-queue-trial`: a public repository with one required `Check` job on `pull_request` and `merge_group`, and copies of Tastebook's two rulesets: Checks (the check, not strict, plus the merge queue with merge commits; no bypass) and Review (one approval; bypassed by `mb-factory-bot`). The scripts ran from the session's scratchpad with the App's key on the user's machine.

| Test | Result |
| --- | --- |
| The merge-queue rule on an organisation's public repository | Accepted, and applied to `main` with `MERGE` |
| The bot queues its own unapproved PR, Review bypass `always` (Tastebook's today) | Refused: "At least 1 approving review is required by reviewers with write access." |
| The same, bypass `exempt` | Queued and merged |
| The user approves a bot PR and queues it with their own token (the Approve and merge tap) | Queued and merged |

- **Who GitHub says merged it:** whoever queued it. `merged_by` was `mb-factory-bot[bot]` for the bot's PR and `milobedini` for the user's, and the timeline reads "added_to_merge_queue by …, merged by …, removed_from_merge_queue by github-merge-queue[bot]". The console's "merged by itself" (`mergedBy.login` ending `[bot]`), the watch after merging and the taps count keep working unchanged.
- **The merge commit:** two parents, authored by whoever queued it, committed by GitHub. Contribution credit is as today.
- **`exempt` gives the bot nothing new:** with `always` it can already merge without an approval; `exempt` only lets it do so through the queue. It still can't skip the queue or the checks (the Checks ruleset has no bypass).

The community reports that a bypass actor can't queue an unapproved PR ([#203926](https://github.com/orgs/community/discussions/203926), [#208718](https://github.com/orgs/community/discussions/208718)) hold for `always` only.

## The design

- **Tastebook lives in `Milo-Bedini`.** `mb-factory` follows when it's onboarded as a project (Phase 5's direction), so the factory's own PRs get the queue too.
- **The Checks ruleset:** the five required checks, no longer strict, plus the merge queue: merge commits (contribution credit), only merge non-failing PRs (`ALLGREEN`), build up to 5 groups at once, merge 1 to 5 at a time with no wait (a lone PR merges as soon as its build passes; PRs queued behind it are built on top of it at the same time), a 30-minute check timeout (CI takes about 7). The Review ruleset is unchanged except the bot's bypass mode, `exempt`.
- **CI runs on `merge_group`.** `ci.yml` gains the trigger; nothing in it reads `pull_request`-only context. Preview checks isn't required, so the queue never waits on Vercel.
- **Vercel doesn't build queue branches:** `"git": { "deploymentEnabled": { "gh-readonly-queue/**": false } }` in `vercel.json` (minimatch, per Vercel's docs). Without it every group would be a preview build inside Pro's single concurrent build, and a Neon preview branch from the free plan's ten.
- **The console queues, GitHub merges.** Where it merges today, it calls `enqueuePullRequest`: as the App when a PR merges itself, as the person on Approve and merge (after their approval). `bringUpToDate`, the accepted head after base merges and the tap's "behind main" refusal go, since PRs no longer need `main` merged in. Everything after the merge stays: the `pull_request` closed event, `merged_by`, the watch, the metrics.
- **A PR the queue drops** (its group failed, a conflict with what's ahead, a timeout) gets a `pull_request` `dequeued` event with a reason. The console says so in the thread with the reason and the group's run, and the work item stays at the merge gate. First version: the person decides (re-queue, or reply to send it back to implement). Later, if it recurs: a failed group goes to implement like a CI failure.
- **The App stays public** until Tastebook and `mb-factory` both live in `Milo-Bedini`: a private App installs only on its owner's account, and moving it to the organisation first would uninstall it from Tastebook. Then transfer it to the organisation and, if wanted, make it private again (GitHub refuses while it's installed on another account).

## Migration

In order. "Person" steps are the user's; auto mode blocks Claude from ruleset changes, repository transfers and Vercel environment changes.

1. **Tastebook PR, before the move** (Claude, through a by-hand PR): `merge_group:` on `ci.yml`; `deploymentEnabled` in `vercel.json`. Harmless on a personal repository.
2. **Console change, behind the config** (Claude): queue instead of merge when the repository's entry in `factory.yaml` says `mergeQueue: true`, the `dequeued` message, and `bringUpToDate` skipped for such a project. Deployed before the move with the flag off.
3. **Pause the factory** (person: the Usage page's pause) once no run is going and no PR is mid-merge.
4. **Transfer** `milobedini/tastebook` to `Milo-Bedini` (person: Settings › Danger Zone › Transfer). Git, web and API reads redirect; update local remotes.
5. **Reconnect** (person):
   - Vercel: install its GitHub App on `Milo-Bedini` and reconnect the project's Git repository; check `createDeployments` and that a push still deploys.
   - Linear's GitHub integration and the Claude GitHub App on `Milo-Bedini`; the design routine's repository list (`Milo-Bedini/tastebook`).
   - New fine-grained tokens owned by `Milo-Bedini`, Tastebook only, same permissions: `GITHUB_DISPATCH_TOKEN` (Vercel) and `EVIDENCE_ATTACH_TOKEN` (Tastebook's `factory` environment). The organisation must allow fine-grained tokens.
   - Check what GitHub doesn't document moving: the `factory` and `backups` environments with their secrets and `main`-only rule, the repository webhook to the console (`deployment_status`), the rulesets, and Actions' workflow permissions under the organisation's defaults.
   - Apply the new rulesets from `projects/tastebook/rulesets/` (their IDs may change; update its README).
6. **Point the factory at the new home** (Claude, then the person for data): the repository's `owner` and `mergeQueue: true` in `factory.yaml`, deployed; a production data fix, run by the user, renaming the repository on every `work_items` and `pr_fixes` row. Stage runs check their OIDC `repository` claim against the work item's, so in-flight work fails to start until it's done.
7. **Resume** and watch the first queued merges (below).
8. **Tidy:** Tastebook's own references (`frontend/scripts/dino-bundle.ts`'s repo, the README's link); delete `Milo-Bedini/merge-queue-trial`; narrow the App's installation on `Milo-Bedini` to the repositories the factory works on.

## To see live after the move

- A PR that merges itself goes into the queue (`pr queued`), merges with `merged_by` the bot, and gets the watch.
- Approve and merge queues as the tapper and merges with them as `merged_by`.
- Two PRs at the gate together: one build each, stacked, both merged with no `main` merged into either and no second CI run on the PRs.
- A dropped PR: the thread names the reason once.
- No Vercel deployment and no Neon branch for a `gh-readonly-queue/…` branch.
- Cycle time from review accepted to merged for PRs that arrive together, against 4–10 Nov's.

## Rejected

- **Keep "up to date" and bring PRs up to date one at a time** (the oldest first): removes the wasted CI runs but still lands one PR per CI run. Kept in mind as a stopgap only if the move stalls.
- **The console's own batch PR** (merge several heads into one branch, merge that, and let GitHub mark each PR merged): the same result as the queue with a lot more console code to own.
- **Drop "up to date" with no queue:** brings back the TAS-74/82 breakage, and nothing watches `main`'s own CI yet.
- **Move the App to the organisation first:** uninstalls it from Tastebook while Tastebook is still on the personal account.
- **A second App to approve express PRs:** not needed, since `exempt` works.
