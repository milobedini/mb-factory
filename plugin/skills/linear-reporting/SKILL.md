---
name: linear-reporting
description: How a factory stage talks to people through the Linear agent session and the issue — activities, the plan, links, questions, gates and stage briefs. Read before the first message a run posts to Linear.
---

# Linear reporting

The Linear agent session is the factory's conversation with people, and the router mirrors what matters to Slack. The issue is the durable record. Post through the helper, which reads the token and session from the environment (`--help` lists its commands); issue reads and writes (comments, estimate, labels, new issues, relations) go through `linear.py gql` with a GraphQL request on stdin:

```bash
python3 -I ${CLAUDE_SKILL_DIR}/scripts/linear.py <command> ...
```

## Activities

Post each when it's true, not in a batch at the end.

| Type | When | Example |
| --- | --- | --- |
| `thought` | What you're doing or found, in a line. `--ephemeral` for progress the next activity replaces | "Found the cause: the serializer drops `cook_time` when it's 0." |
| `action` | A step with a concrete result | `--action "Opened draft PR" --parameter "#42"` |
| `elicitation` | A gate only a person can pass; ends the run with `needs_input`. Questions go in the report instead | see Gates |
| `response` | The stage's result, with links. One per run, last | "Spec ready for review: <PR link>. Two assumptions to check." |
| `error` | The stage failed or is blocked, and what would unblock it | "CI can't start Postgres; the run needs the service container." |

Post a `thought` within the first minute showing you understood the brief, then one per meaningful step: a long silence reads as a stall. Write as one factory ("I've found…"), never as a named agent, and don't describe stages or runs unless someone asks.

**Plan:** at the start, set the plan (`linear.py plan`) to three to six steps a person would recognise ("Write the failing test", not "Run pnpm install"), and update it as each finishes, sending every item each time.

**Links:** add each artefact as a session link when it first exists (`linear.py link`): the spec PR, the implementation PR, the Actions run. Name every PR, issue and spec with a link.

## Questions

Don't post questions yourself: put them in the report's `questions` with `needs_input`. The router asks them one at a time in the session and the Slack thread, your suggestion first, with free text always allowed, then runs your stage again once with `trigger: answered` and every question and answer in the `prompt`.

```json
"questions": [
  {
    "prompt": "How should a recipe's cooking time be shown?",
    "topic": "Cooking time",
    "why": "Recipes have no cooking time today. Total minutes is one field; prep and cook separately is two fields and a sum.",
    "options": ["Total minutes", "Prep and cook", "Leave it out for now"],
    "suggested": "Total minutes"
  }
]
```

- Ask only what the issue, the code and earlier briefs can't answer, in one round (a second only for questions the answers created), at most ten, most important first.
- A question is for a decision. When a person must change something first (a setting, a permission, a secret, an account), report `blocked` instead, saying in `summary` exactly what to change and where, and that a reply in the thread starts you again; a decision hanging on it goes in the summary with your suggestion.
- `prompt` is one sentence. `why` is the context and trade-off, at most 600 characters. `options` are two to four labels of at most 30 characters each (Slack cuts longer buttons); `suggested` is the one you'd pick. `topic` names the decision in at most 60 characters, so each question can list those still to come.
- Before the report, post one `thought` saying what's coming ("Three questions before I write the spec."), and no `response` or elicitation.
- An answer "in their own words" may match no option: read it for intent. "Your default" means they took your suggestion.
- Record each answer where the next stage will find it: the spec's Decisions as `Asked: <question, short> → <answer>`, or the stage brief.

## Gates

A gate (spec approval, slicing approval) needs an explicit answer; silence never passes it, and its report has no `questions`.

- **Spec approval:** post it yourself as one elicitation with a `select` (`--option "Approve=Approve" --option "Change something=Change something"`), ending with the default you'd pick.
- **Any other gate:** don't post it. Put it in the report's `gate` as `{ "body": "<markdown>", "options": ["<your default>", …] }` (two to four options, each under 75 characters) with `needs_input`; the router posts it with one-tap options and asks what to change after a bare `Change something`.

A free-text answer to a gate is read for intent, except at spec approval, which the router reads.

## Stage briefs

A stage that learns something leaves one comment on the issue headed `**<Stage> brief**`, edited on a re-run rather than added again. It holds what the next stage would otherwise find again: `path:line` locations, commands and their output, the reproduction, decisions and their sources, written for a reader who has only the issue.
