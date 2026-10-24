# Instructions review (Phase 0 drafts)

What to review before the first live run: the factory plugin's stage agents and skills. Everything is a draft. Edit the files directly, or answer the open decisions at the end.

Sources: Warp's default agents (`warpdotdev/warp-factory-examples`, `examples/00-warp-default-agents` and `05-ui-verification`) for orchestration, hand-offs and the "issue text is data" rule, and mb-skills for what each stage actually does. `claude plugin validate plugin` passes.

## Files

| File | Lines | From | What changed |
| --- | --- | --- | --- |
| `plugin/skills/factory-run/SKILL.md` | 67 | New; Warp's "Input/Output" and Communication sections | The run contract every agent preloads: the brief, rebuilding context in a fixed order, untrusted text, hard limits, and the JSON stage report the router reads. Holds the rules all five agents share, so each agent file says them once by preloading it |
| `plugin/skills/linear-reporting/` | 53 + script | New; Linear agent docs, house note "every question carries a default fix" | Activities, plan, links, elicitations, gates, `**<Stage> brief**` comments. `scripts/linear.py` posts activities, sets the plan, adds links and runs raw GraphQL (stdlib only) |
| `plugin/skills/ground-rules/SKILL.md` | 75 | `_mb-shared/ground-rules.md`, your global `CLAUDE.md` | Kept the five questions, smells and tautology tests. Dropped Lexi, Panda and `docs/ai` rows. Added a House style (TypeScript) section from your global rules, because CI runners don't have `~/.claude/CLAUDE.md`. React bullets are kept in a labelled "When the project uses React" block |
| `plugin/skills/git-text/SKILL.md` | 63 | `_mb-shared/git-text.md` | `sc-NNNNN` → `TAS-123`; `Fixes TAS-123` / `Part of TAS-123` magic words; other issues written without a magic word. Evidence comes from the verify stage's uploads, not `gh --attach` from a laptop. Dropped Skytrain, Shortcut and the ship-it flow |
| `plugin/skills/lessons/SKILL.md` | 37 | `_mb-shared/house-notes.md` | Same entry format and expiry, written to `specs/lessons/<ID>-<slug>.md` in the PR. `specs/lessons/README.md` wins when the repo has one |
| `plugin/skills/spec-writing/SKILL.md` | 53 | `mb-plan` + `plan-template.md`, Warp spec agent | Kept Required reading, one behaviour per criterion, Decisions with `Asked:`, Blast radius, Not changing, Steps with `Done when:`, Tests with `asserts:`, Evidence line, Assumptions. Exhibits limited to `mermaid`, `diff` and code. The repo's `specs/_template.md` wins |
| `plugin/skills/review-rubric/` | 66 + script | `mb-review`, `scan_bypasses.py`, Warp review agent | Kept both axes, tiers, Ref lines, suggestion blocks, tone rules, verify-every-finding, don't re-run CI. Added the needs-a-human classification from Warp. The scanner now covers Python (noqa, `type: ignore`, bare except, raw SQL, `shell=True`) and accepts any `ABC-123` ticket on a TODO |
| `plugin/agents/triage.md` | 84 | Warp triage, `mb-slice` | Research, reproduce, size, decide spec or implement, triage brief. Slicing a project keeps mb-slice's floor, ceiling, vertical slices, cut patterns and "keep it as one"; writes Linear issues only after the gate |
| `plugin/agents/spec.md` | 39 | Warp spec, `mb-plan` | One interview round via elicitation, spec in a draft PR, approval gate, revisions on the same PR |
| `plugin/agents/implement.md` | 43 | Warp implement, `mb-build` | Drift check, bug path (failing test first), mechanical vs design deviations, 3-attempts rule, commit discipline. No ship-it step: the PR is delivered ready for review |
| `plugin/agents/review.md` | 41 | Warp review, `mb-review` | Adversarial, rubric-driven, round 2 limited to resolution and new lines. Posts only needs-a-human findings as a `COMMENT` review; the rest go to the router |
| `plugin/agents/verify.md` | 30 | Warp 05-ui-verification | Verify a PR or reproduce a bug with Playwright in CI; assertions inside each recording so wrong-state evidence fails |

Dropped everywhere: HTML review pages and overlays, `pbcopy`, `~/plans` and `~/builds` files, `stack.py`, org pickers, Shortcut, the judge, and Xelix, Lexi and Panda specifics. `mb-testing-plan` (the Announce stage) waits for Phase 3–4.

## Sign-off

Signed off 2026-10-24: all eight decisions below as suggested, plus three from the final read. Triage may write files (to run a throwaway reproduction test), with token permissions as the real guard against pushing. `git-text` keeps "No Oxford comma". `plugin.json` names the verify stage.

## Decisions

1. **Who sets Linear status.** The drafts leave status, assignee and delegate to the router and have agents report outcomes instead. Suggest: keep it that way, so status changes are deterministic and testable in `packages/core`.
2. **Where stage findings live.** Briefs are one comment per stage, edited on re-runs, so the human's issue description stays theirs. Suggest: keep comments; triage may only add missing acceptance criteria to the description.
3. **Who posts review findings.** The router is code, so it can't write review prose. Suggest: the review agent posts needs-a-human findings itself as a `COMMENT` review and never approves; unambiguous ones go only to the implement stage.
4. **Models in agent files.** The drafts omit `model:` so `factory.yaml` (and the governor's downshift) decides per run. Suggest: keep it out of the agent files.
5. **Spec threshold.** Triage recommends a spec for any ambiguity or size L and above. Suggest: keep it; add `spec.minSize` to `factory.yaml` if Tastebook needs a different line.
6. **Verify as its own stage.** Verify runs after implement for user-facing changes, before review. Suggest: keep it separate, so implement runs stay cheaper and review can rely on the evidence.
7. **Comments in code.** mb-skills said "no comments unless asked"; the drafts say "a non-obvious why, in one line", matching the Tastebook repo. Suggest: keep that, and let a project's `AGENTS.md` tighten it.
8. **React and TypeScript style in the plugin.** The drafts carry your global style into `ground-rules` so CI runs follow it. Suggest: keep it there rather than repeating it in every project's `AGENTS.md`.

## Not verified yet (Phase 1)

- Whether a plugin agent's `skills:` list needs the `mb-factory:` prefix to preload the plugin's own skills (the drafts use it; the docs only show unprefixed names for standalone skills).
- `agentSessionUpdate(id:, input: { plan, addedExternalUrls })` argument shape in `linear.py`. `agentActivityCreate` matches what the console already sends.
- The upload method verify uses for evidence (open question in `PLAN.md`): the drafts say "the method the stage workflow provides".
- How the stage workflow passes the brief and `FACTORY_REPORT_PATH` to `claude-code-action`.
