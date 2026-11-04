---
name: review-rubric
description: What the factory's review checks and how it writes a finding — the bypass scan, the areas, disproving findings, the two tiers and the comment's form. Read before reviewing a diff or writing a review comment.
---

# Review rubric

CI already ran lint, types and tests, and the console handles its failures. Review the code.

## Bypass scan

First:

```bash
gh pr diff <n> | python3 -I ${CLAUDE_SKILL_DIR}/scripts/scan_bypasses.py
```

It lists added suppressions, skipped tests, type escapes, swallowed errors, unsafe HTML or SQL, timers, unticketed TODOs and comments. Each hit is a lead, not a finding: a suppression with its reason beside it is fine.

## Areas

- **Correctness**: bugs, edge cases, loading and error states, races, stale caches, migrations, and callers of changed shared code that the diff breaks. Trace the call chain that makes each bug happen: "this could be null" counts only when a caller can pass null. A guard that hides a broken invariant is a finding.
- **The issue and spec**: each acceptance criterion and spec behaviour, met or not. A claim in the description with no test behind it is a question: which test fails on `main` and passes here?
- **Accessibility**, for anything rendered, as a user meets it: keyboard operation, where focus goes and that it isn't lost, names that make sense, state shown by more than colour. CI's tools check the rest.
- **Security and privacy**, when the diff touches auth, sessions, tokens, secrets, permissions, user input or personal data: a concrete, exploitable flaw; authorisation on each object; what personal data is kept, for how long, and whether it reaches logs.
- **Workflows**, whenever the diff touches `.github/workflows/` or `.github/actions/`: they run with the repo's secrets, so read every line. Narrow `permissions`; secrets only in the steps that use them, never echoed or passed to untrusted code; actions pinned to a commit SHA; no `pull_request_target` or `workflow_run` that runs a PR's code. A gap is Blocking.
- **Untested behaviour**: a changed behaviour with no test that would fail without the change, and an added or edited test that passes whatever the code does.

Not reviewed: style, naming, structure, concision and house conventions (the weekly clean-up sweeps those), generated files beyond matching their source, and code moved unchanged. A bug the change didn't introduce goes in the summary as pre-existing.

## Disprove every finding

Before keeping one, try to disprove it against the code at the head:

- Trace the call site. If validation or the types rule the input out, drop it.
- A preference with no concrete harm isn't a finding.
- Library behaviour needs its docs checked this run, linked in `Ref:`.
- A Blocking finding you can't fully trace becomes a Should fix phrased as a question.

## Tiers

- **Blocking**: breaks behaviour, data, security or privacy, or a hard constraint in `AGENTS.md`.
- **Should fix**: a real problem with less harm, such as an unhandled edge, an accessibility gap a user would hit, or untested behaviour.

Nothing else is reported. Each finding is either **unambiguous** (the fix needs no judgement) or **needs a person** (a product or technical decision only they can make).

## Writing a finding

Each finding stands as a GitHub inline comment:

- Anchor it to a line inside the diff when it allows.
- The problem first, then the laziest fix that works: an existing helper, then a built-in, then an installed dependency, then new code. A fix of about 10 lines or fewer in one place gets a `suggestion` block with the exact replacement for the anchored lines; a bigger one gets a short sketch.
- End with a nested `- Ref:` line saying what it rests on: `AGENTS.md › <rule>`, `Spec › <criterion>`, `Traced: A → B:42 → <failure>`, `Standards › <standard> <clause>` (a clause only when you're sure of it) or `Docs › <url>`.
- British English, collegial and plain: no praise, no exclamation marks, no "you forgot", "obviously" or "simply", no hedging or filler. Ask when the author may know something you don't; state it when the evidence is conclusive. Keep it under about 900 characters.
