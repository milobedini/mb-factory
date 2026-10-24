---
name: linear-reporting
description: How a factory stage talks to humans through the Linear agent session and the issue — thoughts, actions, elicitations, responses, errors, the plan checklist, links and stage briefs. Read before the first message a run posts to Linear.
---

# Linear reporting

The Linear agent session is the factory's conversation with humans; the router mirrors what matters to Slack. The issue is the durable record. Post through the helper, which reads the token and session from the environment:

```bash
python3 -I ${CLAUDE_SKILL_DIR}/scripts/linear.py <command> ...
```

Run it with `--help` for every command. Issue reads and writes (comments, estimate, labels, new issues, relations) go through `linear.py gql` with a GraphQL request on stdin.

## Activities

Post each one at the moment it's true, not in a batch at the end.

| Type | When | Example |
| --- | --- | --- |
| `thought` | What you're doing or have found, in one line. `--ephemeral` for progress the next activity replaces | "Found the cause: the serializer drops `cook_time` when it's 0." |
| `action` | A step with a concrete result | `--action "Opened draft PR" --parameter "#42"` |
| `elicitation` | A question only a human can answer. Ends the run with outcome `needs_input` | see below |
| `response` | The stage's result, with links. One per run, last | "Spec ready for review: <PR link>. Two assumptions to check." |
| `error` | The stage failed or is blocked; say what would unblock it | "CI can't start Postgres; the run needs the service container." |

Within the first minute, post a `thought` that shows you understood the brief. Then keep the human oriented: a long silence reads as a stall, and narrating every command reads as noise. One thought per meaningful step is the rhythm.

Write as one factory, never as a named agent: "I've found…", not "The triage agent found…". Don't describe stages, dispatches or runs unless someone asks how the factory works.

## Plan

At the start of the run, set the plan to the stage's steps (`linear.py plan`), and update it as each finishes. The plan replaces the whole list each time, so send every item. Keep it to three to six items a human would recognise ("Write the failing test", not "Run pnpm install").

## Links

Add each artefact as a session link when it first exists: the spec PR, the implementation PR, the Actions run, evidence (`linear.py link`). Name every PR, issue and spec with a link, every time.

## Elicitations

Batch every question the stage has into one elicitation; a second round only for questions the first answers created. Every question carries a default:

> <issue>. Suggest: <fix>. Going with that unless someone objects.

- Ask only what the issue, the code and earlier stage briefs can't answer.
- A **gate** is different: spec approval, slicing approval, or a decision that changes what gets built. A gate needs an explicit answer, so offer it as a `select` (`--option "Approve=approve" --option "Change something=change"`) and still end with the default you'd pick. Silence never passes a gate.
- The human may answer in free text instead of picking an option. Read it for intent.
- Record each answer where the next stage will find it: in the spec's Decisions as `Asked: <question, short> → <answer>`, or in the stage brief.

## Stage briefs

Each stage that learns something leaves a brief as one comment on the issue, headed `**<Stage> brief**` (for example `**Triage brief**`). On a re-run, edit that comment instead of adding a second. A brief holds what the next stage would otherwise have to find again: code locations as `path:line`, commands and their output, the reproduction, decisions and their sources. Write it for a reader who has only the issue.
