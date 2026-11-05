---
name: cleanup-rubric
description: What the factory's weekly clean-up files and what it leaves alone — the categories, the promotion ladder for rules to enforce, verification, severities and the finding fields the console files from. Preloaded into the cleanup agent.
---

# Clean-up rubric

Every finding becomes a Linear issue that a person has to read, accept or decline, and that then runs through the factory. File only what they would thank you for. A quiet week is a good result, not a failure to find something.

## Rules to enforce (`kind: enforce`)

A class of problem that came up at least twice in the week (two review findings, or a finding and a lesson) gets one issue to stop it for good. It's enforced at the highest step of this ladder that can check it:

1. a type or lint rule: Biome, including a GritQL rule in the project's own folder of them, or ruff
2. a test
3. a Claude Code hook in the project's `.claude/`
4. a CI check
5. prose: a lesson or an `AGENTS.md` line, only for what nothing above can check

- The title names the rule, not the bug: "Every documented error answer of a mutation is handled", not "useCancelInvite ignores a 404".
- The fix names the step and what the check does, specifically enough to build: the rule's pattern, the test's shape, the hook's trigger. When a lesson or `AGENTS.md` line says the same thing in prose, the fix also shortens it to point at the check.
- Already enforced, and the check caught both: no finding. Enforced but it missed them: the finding is the gap ("The button-pressed-state rule misses buttons built with clsx").
- One finding per class, however many times it came up; the evidence lists each time (issue, file, what).
- Not a class: two findings that only share a file, or a one-off mistake the existing checks would have caught had CI run.

## The sweep (`kind: cleanup`)

The fingerprint's category is one of these:

- **`dead-code`:** an export, file, component, endpoint, setting or dependency nothing uses. A tool's "unused" is a lead: check for dynamic use (string imports, Django's settings and URL includes, Storybook stories, management commands, entry points named in config) before reporting.
- **`duplication`:** two or more copies of the same logic that should be one, where a change to one would need the same change to the others. Similar-looking UI built from the same components, test fixtures and generated code aren't duplication.
- **`empty-test`:** a test that would still pass if the code it names were broken: no assertion, assertions only on its own mocks or fixtures, a snapshot of nothing meaningful, an `expect` that can't fail, a skipped or `todo` test left behind, or a test whose name promises a case its body never reaches. Mutation testing's surviving mutants count too, once read and grouped by source file. Name the change to the code that the test wouldn't catch.
- **`agents-drift`:** code at `head` that does what `AGENTS.md` says not to, or doesn't do what it requires, in a way a reader can check. A convention the code has moved past on purpose is the docs check's concern (`AGENTS.md` is wrong), not this one.

## What not to file

- Style, naming, formatting, or code that could merely be nicer.
- Anything a lint rule or test already reports on `main`.
- Generated output and data: lockfiles, migrations, `schema.yml`, `schema.d.ts`, screenshot baselines, the recipe catalogue.
- Work in flight: code an open PR is already changing (`gh pr list --state open --json files`).
- A security problem: that's the security check's.
- A guess. If you can't show it, drop it and mention it in `summary`.

## Verify before reporting

- Dead code: `git grep` for every name it's reached by, and the config that could load it by path.
- Duplication: read both copies; say what differs, if anything, and which copy should stay.
- An empty test: run it, and say from its own assertions which break in the code it would miss.
- A rule to enforce: open each finding the evidence cites and check they really share the class; look for an existing check before proposing one.

## Severity

- `high`: a rule to enforce whose class reached `blocking` in review, or an empty test guarding money, data loss, auth or a household's privacy.
- `moderate`: any other rule to enforce, an empty test on behaviour people rely on, or drift from an `AGENTS.md` hard constraint.
- `low`: dead code, duplication, and other drift.

Clean-up is never `critical`.

## The finding

| Field | |
| --- | --- |
| `fingerprint` | `enforce:<rule>` with the rule as a short kebab-case name (`documented-answers-handled`), or `cleanup:<category>:<path>` with the main file's path. Stable: the same finding next week gets the same fingerprint, so it isn't filed twice. |
| `kind` | `enforce` or `cleanup` |
| `title` | One line for the Triage inbox, under 70 characters. The console adds "Enforce: " or "Clean-up: " before it. |
| `severity` | `high`, `moderate` or `low` |
| `evidence` | What you found and how you checked it: the issues and files, the tool's lead and what confirmed it, the commit that left it behind (short SHA, and its issue if the message names one). Plain Markdown; it is the issue's body. |
| `fix` | The change, specific enough for the implement stage: for a rule, which step of the ladder and what the check does; for clean-up, the files and what to delete, merge or rewrite. |
| `size` | `XS` to `M`; anything bigger is two findings. |
| `path`, `line` | The main file and line, for clean-up findings. |
| `group` | Only when one change fixes this and other findings in the report, such as several dead exports in one module: the same short imperative on each ("Remove the old recipe card helpers", under 60 characters). The console files a group as one issue. Leave it out otherwise. |

Write as you would for a colleague: plain, specific, British English.
