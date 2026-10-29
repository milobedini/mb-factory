---
name: design-system-rubric
description: Extra review areas for a PR that changes a project's design system — when it applies, the sources of truth, the areas (values, states, stories, the component's shape, what axe can't see, the doc's rules), tiers and Ref lines. Applied with review-rubric on a PR carrying the label the repo's AGENTS.md names for its design system.
---

# Design-system rubric

A design system is built once and copied everywhere, so a wrong value or a missing state in it spreads to every screen that uses it. Apply this with `review-rubric`, as more areas of the Standards axis, only when the repo's `AGENTS.md` names a label for its design system and the PR carries it (`gh pr view <n> --json labels`). Everything else in `review-rubric` still holds: verify every finding, tiers, guards, how a finding is written.

## Sources of truth

Read them in this order; the first one that settles a question wins.

1. **The feature's approved boards** in `specs/<ISSUE-ID>/design/`, when they exist: each board's HTML (exact values) and PNG (how it should look), and `notes.md` (the decisions and the suggestions it was approved with). A person approved these, so the code matches them, not the other way round.
2. **The design doc** `AGENTS.md` names, with its rules, states, components and principles.
3. **The reference boards** the design doc points to, for anything the feature's boards don't draw.

Where the approved boards break the design doc, the boards win only for a rule change `notes.md` records as approved; otherwise it's a question for a human.

## Areas

- **Values**: tokens only. No literal colour, font, size, radius, shadow or duration in a component; a new token goes in the tokens file, named as the doc names them. Compare the component's values with the board's markup property by property (padding, gap, radius, border width, font size and weight, line height), and the token each resolves to with the one the board uses. A difference a person would see is a finding even when the token is valid.
- **States**: every state the doc defines for the kind of control, each as the doc describes it (what changes, by how much, for which input). Check the states nobody screenshots: pressed, focus on each surface the control sits on, disabled with its reason, loading, error, the empty and long-content cases.
- **Stories**: one story per component and per state, named as the boards name the state (`is-hover`, `is-pressed`…), so the board-against-story check finds its pair. Keyboard behaviour has an interaction test. Every screenshot baseline the PR changes needs a reason in the issue or its board: download the old and new images and the board's PNG, and compare them. A changed baseline that nothing explains is a Should fix.
- **The component's shape**: generic, with no knowledge of the feature that prompted it (no domain words, no data fetching, no feature's copy), exported where the library exports from, with props named as its siblings name theirs (`variant`, `size`). It composes the library's existing parts rather than restyling their internals. In a feature's own files, UI that hand-rolls what a library component already does is a finding; a component the feature's boards use that isn't in the library yet should have landed first in its own labelled PR.
- **What axe can't see**: the keyboard model of the pattern it implements ([ARIA APG](https://www.w3.org/WAI/ARIA/apg/patterns/): a radio group moves with arrow keys and is one tab stop), a name that makes sense out of context, a state shown by more than colour, forced colours (borders and icons that the system recolours), targets at the doc's minimum, reduced motion, and what happens at the largest text size the doc covers.
- **The doc's rules**: each rule the doc says review checks, against every screen the PR renders, including rules that ration something per screen ("one per screen") across the components now on it.

## Tiers

- **Blocking**: a literal value where `AGENTS.md` forbids one; a control a keyboard or screen-reader user can't operate; a state or rule that fails a clause of a published standard.
- **Should fix**: a visible difference from an approved board; a state the doc defines that's missing or wrong; a missing story or interaction test; a component that knows about its feature; one-off UI where a library component fits.
- **Needs a human**, whatever the tier: an approved board that breaks the doc without approval in `notes.md`, a doc that contradicts itself or says nothing on the question, or a rule the change would need bent. Say which rule, and quote both.

Where a reference board and the doc disagree, the doc has already decided it (the order above): check the code follows the doc and the spec's Decisions list the difference. An unlisted difference is a Nit, not a question for a human.

## Ref lines

Cite what the finding rests on, in the forms `review-rubric` uses plus:

- `Board › <board file> › <element>`, for example `Board › Household.dc.html › Invite button`.
- `Design › <section> › <rule>`, for example `Design › States › Focus`.
- `Design › Principles › <principle>`, when the doc names principles and the finding rests on one, for example `Design › Principles › NN/g 1`.
