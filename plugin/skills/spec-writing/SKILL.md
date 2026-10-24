---
name: spec-writing
description: How to write a factory spec (specs/<ISSUE-ID>.md) that an implementer can build without making design decisions — sections, behaviours, decisions, blast radius, steps with Done when, tests with asserts, evidence path. Read before writing or revising a spec.
---

# Spec writing

A spec lets a different run, with none of your context, build the change without making a design decision of its own. You do the hard thinking; the spec carries it.

Use the repo's `specs/_template.md` when it exists, keeping its headings and order. Where it has no home for a part below, put that part under its closest heading (Required reading and Steps go under Technical design). Without a repo template, use the fallback at the end.

## Rules

- **Decide everything.** Exact file paths (new or edited), names and signatures, data shapes, copy strings, query keys, URL paths. Never "pick a suitable approach".
- **Sketch only the hard parts**, based on the real files you read: new signatures and return shapes, types, non-trivial state or derivation. Mechanical work gets one line plus a file to mirror. A sketch shows a decision; it isn't the implementation.
- **Plain, exact language**: short sentences, active voice, one instruction per sentence, one meaning per word. No "as needed", "appropriately" or "etc.".
- **Scale to the work.** A small change is mostly validation criteria. A large one gets every section.
- **No open questions.** Ask blocking questions in one elicitation before writing (see `linear-reporting`). What's left goes under Assumptions, stated as settled, with who confirms it.
- **Exhibits GitHub renders**: `mermaid` for flows and states, `diff` for file-tree or API changes, and fenced code (`ts`, `py`, `json`) for shapes. Nothing that needs a custom viewer.

## Parts

- **Required reading** (first): `AGENTS.md`, the lessons that apply, and each canonical file the implementer should mirror, one line on why.
- **Summary**: what is built or fixed and why, in one short paragraph. Then `Evidence: feature | bug | chore — <why>`, decided by what users in production will see, not by the issue's type.
- **Behaviours** (product behaviour): one per acceptance criterion, in the same order, each a true-or-false claim of about 12 words about what someone can do or see. Split by behaviour, never by file or layer. A refactor's single claim is "Nothing a caller sees changes."
- **Technical design**: how the area works today, what changes, the data flow, with `path:line` references.
- **Decisions**: every real decision point: the options, the trade-off, why the winner won. A decision a human made ends `Asked: <question, short> → <answer>`. The implement stage copies these into the PR.
- **Blast radius**: only shared or exported code this spec changes that could break other callers, with what to re-check. One line saying so when nothing reaches beyond the issue.
- **Out of scope** (not changing): neighbouring surfaces and behaviours a reader might expect to move, so the implementer stays out.
- **Steps**: numbered. Each names its files (new, edit, delete), says what changes, and ends with `Done when:` naming the check that proves it (a test passing, a type-check, an observable result).
- **Tests** (validation criteria): one bullet per test file, one nested bullet per case, each ending `asserts:` with the literal, observable result. Apply the Tests rules in `ground-rules`. Then the repo's check commands from `AGENTS.md`.
- **Assumptions**: each settled assumption, why, and `Confirm with:` who and when.

## Fallback template

```markdown
# TAS-123: <title>

Issue: <Linear URL>
Evidence: <feature | bug | chore> — <why>

## Required reading
## Summary
## Product behaviour
### 1. <claim>
## Technical design
## Decisions
## Blast radius
## Out of scope
## Steps
## Validation criteria
## Assumptions
```
