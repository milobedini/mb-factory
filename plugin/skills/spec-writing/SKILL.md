---
name: spec-writing
description: How to write a factory spec (specs/<ISSUE-ID>.md) that an implementer can build without making design decisions — sections, behaviours, decisions, blast radius, steps with Done when, tests with asserts. Read before writing or revising a spec.
---

# Spec writing

A spec lets a run with none of your context build the change without making a design decision of its own.

Use the repo's `specs/_template.md` when it exists, keeping its headings and order; a part below with no home there goes under its closest heading (Required reading and Steps under Technical design). Otherwise use the fallback at the end.

## Rules

- **Decide everything:** exact file paths, names and signatures, data shapes, copy strings, query keys, URL paths. Never "pick a suitable approach", "as needed" or "etc.".
- **Sketch only the hard parts**, from the real files: new signatures and return shapes, types, non-trivial state or derivation. Mechanical work gets a line and a file to mirror.
- **Scale to the work.** A small change is mostly validation criteria; a large one gets every part.
- **No open questions.** What's left after the interview goes under Assumptions, stated as settled, with who confirms it.
- **Exhibits GitHub renders:** `mermaid` for flows and states, `diff` for file trees or API changes, fenced code for shapes.

## Parts

- **Required reading** (first): `AGENTS.md`, the lessons that apply, and each canonical file to mirror, with a line on why.
- **Summary**: what is built or fixed and why, in a short paragraph. In a repo with `docs/design.md`, then `Design: needed | skip — <why>` and, when needed, `Components: Avatar (new), Button (changed: lg size)`.
- **Behaviours**: one per acceptance criterion, in order, each a true-or-false claim of about 12 words about what someone can do or see. Split by behaviour, never by file or layer. A refactor's single claim is "Nothing a caller sees changes."
- **Technical design**: how the area works today, what changes and the data flow, with `path:line` references.
- **Decisions**: each real decision point, its options, the trade-off and why the winner won. One a person made ends `Asked: <question, short> → <answer>`. Implement copies these into the PR.
- **Blast radius**: shared or exported code this changes that could break other callers, and what to re-check; or one line saying nothing reaches beyond the issue.
- **Out of scope**: neighbouring surfaces and behaviours a reader might expect to move.
- **Steps**: numbered; each names its files (new, edit, delete), says what changes and ends `Done when:` with the check that proves it.
- **Tests** (validation criteria): a bullet per test file and a nested bullet per case, each ending `asserts:` with the literal, observable result, per `ground-rules`; then the repo's check commands from `AGENTS.md`.
- **Assumptions**: each settled assumption, why, and `Confirm with:` who and when.

## Fallback template

```markdown
# TAS-123: <title>

Issue: <Linear URL>
Design: <needed | skip> — <why>   (only with docs/design.md)

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
