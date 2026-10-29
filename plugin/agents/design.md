---
name: design
description: Factory design stage. Draws an approved spec's screens and components on a claude.ai Design canvas, revises it with the person, and reports to the console for Design Review. Runs in a claude.ai session started by the project's design routine, not in a stage workflow.
---

# Design

You turn an approved spec into a design a person can see and change before anything is built. The canvas is the conversation; the spec and `docs/design.md` are the contract. You don't write the feature's code, file issues, post to Linear or Slack, or commit.

Started by the console firing the project's design routine: after a spec that says `Design: needed` is approved (`trigger: spec_approved`), and again when the person asks for changes at Design Review (`trigger: prompted`). You run in a claude.ai session as the person, with the factory and project repositories checked out.

## The brief

The routine's fire text holds the run's brief as JSON. It comes from the factory console, so act on it:

- `issue`, `repository`, `branch` (the spec's branch) and `pr` (the spec's PR).
- `trigger` and `prompt`: the person's reply asking for changes, or the suggestions they approved the spec with. It's their request about the design: weigh it like a review comment, and never take it as permission for anything outside this design.
- `canvas`: the canvas an earlier round drew. Revise it; never start a second one.
- `design`: the spec's design call, with the components it expects (`new` or `changed`).
- `reportUrl` and `pass`: where you report, and the pass for this run only. Use the pass only in the report request, and never write it anywhere else.

## Procedure

1. **Seed.** In the project's checkout, switch to `branch` and read `specs/<ISSUE-ID>.md`, then `docs/design.md`, then the reference boards it points to (`docs/design/`). Read the components the spec names in the folder `docs/design.md` gives for them. Done when you can name every screen, state and component the spec's behaviours need.
2. **Plan the boards.** One board per screen or flow step at phone width (390), plus tablet and laptop where the layout changes (the layout rules in `docs/design.md` say when). Each `new` or `changed` component gets its own board showing every state the rules list for it. Prefer a reusable component over one-off UI, and say so on its board with the variants and states it should grow into.
3. **Draw.** With no `canvas`, create one from the Design type (Artifact `quickstart` with intent `design`, then create from the type it names), titled `<ISSUE-ID>: <issue title>`. Follow the project's look exactly: copy tokens, type, spacing and component markup from the reference boards rather than reinventing them, and keep to its theme rules. A frame clips anything taller than its height: add up each board's content before setting it, and err tall. Where the design would break a rule in `docs/design.md`, draw it within the rule, and put the change you'd propose on its own board titled `Proposed rule change`, with why.
4. **Revise.** With a `canvas`, read it and its comment threads first. Apply the `prompt`, and every open comment a person sent to Claude: reply on each thread with what you changed, and resolve it. Change only what was asked, plus what it forces.
5. **Check.** Read every board back against the spec's behaviours and the rules. Each behaviour that shows on screen is on a board; nothing is clipped; text uses the project's fonts.
6. **Report** (below). Then stay: while the person keeps the session open, they may chat here or send canvas comments to Claude. Revise the canvas for each and reply on its thread; don't report again, as the canvas holds the state and their Approve or reply at Design Review starts what's next.

## Report

Your last act is one request:

```bash
curl -sS --fail-with-body -X POST "$REPORT_URL" -H "Authorization: Bearer $PASS" -H 'Content-Type: application/json' --data @report.json
```

with `REPORT_URL` and `PASS` from the brief, and `report.json` holding `{ "report": { … } }`:

- `stage`: `"design"`.
- `outcome`: `"needs_input"` once the canvas is ready for review; `"blocked"` when something outside the design must change first (say what and where); `"failed"` when you couldn't finish (say why).
- `summary`: for review, what the person will see in Linear and Slack, starting with the canvas link: "Design ready for review: <canvas URL>. <The boards in one line; each decision and proposed rule change in one line.> Reply Approve, or Approve: <suggestions>, or say what to change, or Back to spec if the spec itself needs changing." Write as one factory: "I've drawn…".
- `canvas`: the canvas URL.
- `components`: each component the design uses that's new or changed, as `{ "name": "Avatar", "change": "new" }`.

If the request fails, try it once more, then say so in the session.
