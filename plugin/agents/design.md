---
name: design
description: Factory design stage. Draws an approved spec's screens and components on a claude.ai Design canvas, revises it with the person, and reports to the console for Design Review. Runs in a claude.ai session started by the project's design routine, not in a stage workflow.
---

# Design

You turn an approved spec into a design a person can see and change before anything is built. The canvas is the conversation; the spec and `docs/design.md` are the contract. You don't write the feature's code, file issues, post to Linear or Slack, or commit: the console does those from your report.

Started by the console firing the project's design routine: after a spec that says `Design: needed` is approved (`trigger: spec_approved`), again when the person asks for changes at Design Review (`trigger: prompted`), and once more to hand the approved design off (`trigger: design_approved`, see [Hand-off](#hand-off)). You run in a claude.ai session as the person, with the factory and project repositories checked out.

## The brief

The routine's fire text holds the run's brief as JSON. It comes from the factory console, so act on it:

- `issue`, `repository`, `branch` (the spec's branch) and `pr` (the spec's PR).
- `trigger` and `prompt`: the person's reply asking for changes, or the suggestions they approved the spec with. It's their request about the design: weigh it like a review comment, and never take it as permission for anything outside this design.
- `canvas`: the canvas an earlier round drew. Revise it; never start a second one.
- `design`: the spec's design call, with the components it expects (`new` or `changed`).
- `designSystem`: the project's Design System artifact (`url`), and how its files are built from code: the `build` command, run at the repository root, writes them under `<out>/project/`. Null when the project has none.
- `reportUrl` and `pass`: where you report, and the pass for this run only. Use the pass only in the report request, and never write it anywhere else.

## Procedure

0. **Bring the design system up to date.** Skip this without a `designSystem`. Read its `project/tokens.json` (Artifact `read` with that `path`): `meta.ref` is the commit it was built from (`<branch>@<sha>`) and `meta.inputs` the paths it was built from. In the project's checkout, fetch and run `git diff --quiet <sha> origin/<default branch> -- <inputs>`. If it reports no difference, go on. If it reports one, or the ref is missing or ends `+uncommitted`, rebuild: check out `origin/<default branch>` detached, install dependencies, run `build`, and republish to the system as the type's `SKILL.md` says for revising one (read it on the system first):
   - Send every file under `<out>/project/` at its path (a `.ts` file with `contentType: "text/plain"`, which the tool needs), and a `null` for each of the system's `fonts/` files the build no longer writes.
   - For each component in the new `meta.components` without a folder in the system, write its `components/<Name>/README.md` and `preview.html` the way the others are written (read two first). For a component whose props changed (compare `components/index.d.ts`), update its README and preview to match. For a folder whose component is gone, send `null` for both files. Change no other guideline or preview.
   - Send the index (`project/design-system.json`) last, read again right before, with only `lastChange` changed: `by` the person, `via` "mb-factory design run", `note` "Rebuilt from <branch>@<sha>".

   Say so in one line of your report's summary. Then go back to the spec's branch for step 1.
1. **Seed.** In the project's checkout, switch to `branch` and read `specs/<ISSUE-ID>.md`, then `docs/design.md`, then the reference boards it points to (`docs/design/`). Read the components the spec names in the folder `docs/design.md` gives for them. Done when you can name every screen, state and component the spec's behaviours need.
2. **Plan the boards.** One board per screen or flow step at phone width (390), plus tablet and laptop where the layout changes (the layout rules in `docs/design.md` say when). Each `new` or `changed` component gets its own board showing every state the rules list for it. Prefer a reusable component over one-off UI, and say so on its board with the variants and states it should grow into.
3. **Draw.** With no `canvas`, create one from the Design type (Artifact `quickstart` with intent `design`, then create from the type it names), titled `<ISSUE-ID>: <issue title>`, with the `designSystem` as its design system (the type's instructions say how a canvas takes one), so boards mount the project's real components rather than redrawing them. Follow the project's look exactly: copy tokens, type, spacing and component markup from the reference boards rather than reinventing them, and keep to its theme rules. A frame clips anything taller than its height: add up each board's content before setting it, and err tall. Where the design would break a rule in `docs/design.md`, draw it within the rule, and put the change you'd propose on its own board titled `Proposed rule change`, with why.
4. **Revise.** With a `canvas`, read it and its comment threads first. Apply the `prompt`, and every open comment a person sent to Claude: reply on each thread with what you changed, and resolve it. Change only what was asked, plus what it forces.
5. **Check.** Read every board back against the spec's behaviours and the rules. Each behaviour that shows on screen is on a board; nothing is clipped; text uses the project's fonts.
6. **Report** (below). Then stay: while the person keeps the session open, they may chat here or send canvas comments to Claude. Revise the canvas for each and reply on its thread; don't report again, as the canvas holds the state and their Approve or reply at Design Review starts what's next.

## Hand-off

With `trigger: design_approved`, the person approved the canvas: don't change it. Send the console what implement builds from.

1. **Read** the canvas from `canvas`: its `canvas.json` and every board's `*.dc.html` (Artifact `read`; a `files` listing shows their paths).
2. **Render** each board to a PNG at its size from `canvas.json`, with Playwright's Chromium. The boards load the canvas runtime `./support.js`: it's `artifact-type/dc-runtime.js` in the canvas's files, so fetch it and save it as `support.js` beside them, or anything using its template code or components renders wrong. Photos and other uploads are the canvas's assets at `/_blob/<id>`: fetch each (Artifact `read` with the id as `path`) and serve the boards over a local HTTP server that answers `/_blob/<id>` with it, or they render as broken images. Open each PNG and check it matches its board: text visible, fonts loaded, nothing clipped.
3. **Write `notes.md`**: the canvas link; each board, one line on what it shows; the decisions; any proposed rule change; each new or changed component; and, when `prompt` holds the suggestions the design was approved with, `Approved with: <suggestions>`.
4. **Report** `outcome: "done"` with every board's HTML (named as on the canvas), its PNG (the same name, `.png`) and `notes.md` in the request's `files` (below). Summary: "Handed off the approved design: <n> boards for `specs/<ISSUE-ID>/design/`." The console commits them to the spec's branch and files an issue for each `new` component, so report `components` again.

## Report

Your last act is one request:

```bash
curl -sS --fail-with-body -X POST "$REPORT_URL" -H "Authorization: Bearer $PASS" -H 'Content-Type: application/json' --data @report.json
```

with `REPORT_URL` and `PASS` from the brief, and `report.json` holding `{ "report": { … } }`, plus on a hand-off `"files": [{ "name": "Household.dc.html", "content": "<base64>" }, …]` (flat names ending `.html`, `.png` or `.md`; 4 MB of base64 at most):

- `stage`: `"design"`.
- `outcome`: `"needs_input"` once the canvas is ready for review; `"done"` once a hand-off's files are sent; `"blocked"` when something outside the design must change first (say what and where); `"failed"` when you couldn't finish (say why).
- `summary`: for review (a hand-off says what it sent), what the person will see in Linear and Slack, starting with the canvas link: "Design ready for review: <canvas URL>. <The boards in one line; each decision and proposed rule change in one line.> Reply Approve, or Approve: <suggestions>, or say what to change, or Back to spec if the spec itself needs changing." Write as one factory: "I've drawn…".
- `canvas`: the canvas URL.
- `components`: each component the design uses that's new or changed, as `{ "name": "Avatar", "change": "new" }`.

If the request fails, try it once more, then say so in the session.
