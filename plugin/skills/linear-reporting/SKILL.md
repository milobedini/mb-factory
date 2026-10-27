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
| `elicitation` | A gate only a human can pass. Ends the run with outcome `needs_input`. Questions go in the stage report instead | see below |
| `response` | The stage's result, with links. One per run, last | "Spec ready for review: <PR link>. Two assumptions to check." |
| `error` | The stage failed or is blocked; say what would unblock it | "CI can't start Postgres; the run needs the service container." |

Within the first minute, post a `thought` that shows you understood the brief. Then keep the human oriented: a long silence reads as a stall, and narrating every command reads as noise. One thought per meaningful step is the rhythm.

Write as one factory, never as a named agent: "I've found…", not "The triage agent found…". Don't describe stages, dispatches or runs unless someone asks how the factory works.

## Plan

At the start of the run, set the plan to the stage's steps (`linear.py plan`), and update it as each finishes. The plan replaces the whole list each time, so send every item. Keep it to three to six items a human would recognise ("Write the failing test", not "Run pnpm install").

## Links

Add each artefact as a session link when it first exists: the spec PR, the implementation PR, the Actions run, evidence (`linear.py link`). Name every PR, issue and spec with a link, every time.

## Questions

Don't post questions yourself. Put them in the stage report's `questions` and report `needs_input`; the router asks them one at a time in the session and the Slack thread, your suggestion first, with a shortcut to take the suggestions for the rest and free text always allowed. Once the last is answered it runs your stage again, once, with `trigger: answered` and every question and answer in the brief's `prompt`.

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

- Ask only what the issue, the code and earlier stage briefs can't answer. One round; a second only for questions the answers created.
- A question is for a decision. When a person has to change something before you can go on (a setting, a permission, a secret, an account), don't ask it, since answering in Slack changes nothing: report `blocked` and say in `summary` exactly what to change, where, and that a reply in the thread starts you again. A decision that hangs on the same change goes in the summary too, with your suggestion, so the reply can carry it.
- `prompt` is the question itself, one sentence. `why` is the context and the trade-off, in one or two sentences, shown smaller under it (at most 600 characters).
- `options` are two to four distinct labels, each a few words of at most 30 characters, because Slack buttons cut anything longer (80 is the hard limit). Put the detail in `why`, not in the labels. `suggested` is the label you'd pick.
- `topic` names the decision in a few words (at most 60 characters): each question lists the ones still to come as topic and suggestion, so the human can take the rest of your suggestions knowingly.
- At most ten questions, most important first.
- Before the report, post one `thought` saying what's coming ("Three questions before I write the spec."), and no `response` or elicitation: the questions are the run's last word.
- An answer marked "in their own words" may match no option: read it for intent. One marked "your default" means the human took your suggestion.
- Record each answer where the next stage will find it: in the spec's Decisions as `Asked: <question, short> → <answer>`, or in the stage brief.

## Gates

A **gate** is different: spec approval, slicing approval. A gate needs an explicit answer, and silence never passes it. A gate's report has no `questions`.

- **Spec approval:** post it yourself as one elicitation with a `select` (`--option "Approve=Approve" --option "Change something=Change something"`, label and value the same) and still end with the default you'd pick.
- **Any other gate**, such as slicing approval: don't post it. Put it in the report's `gate` as `{ "body": "<markdown>", "options": ["<your default>", …] }` (two to four options, each under 75 characters) and report `needs_input`; the router posts it in the session and the Slack thread with one-tap options. A bare `Change something` is answered by the router asking what to change.

The human may answer a gate in free text instead of picking an option. Read it for intent, except at the spec approval gate, which the router reads (see the `spec` agent).

## Stage briefs

Each stage that learns something leaves a brief as one comment on the issue, headed `**<Stage> brief**` (for example `**Triage brief**`). On a re-run, edit that comment instead of adding a second. A brief holds what the next stage would otherwise have to find again: code locations as `path:line`, commands and their output, the reproduction, decisions and their sources. Write it for a reader who has only the issue.
