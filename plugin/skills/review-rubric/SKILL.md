---
name: review-rubric
description: The factory's code review rubric — Spec and Standards axes, review areas, the bypass scan, verifying findings, tiers (Blocking, Should fix, Nit, Could cut), Ref lines, suggestion blocks and comment tone. Read before reviewing a diff or writing a review comment.
---

# Review rubric

Two axes stay separate. **Spec**: does the change do what the issue and spec ask? **Standards**: is it built the way this repo builds things (`AGENTS.md`, `ground-rules`) and does it meet the published standards the repo commits to (the Standards section of `AGENTS.md`)? A change can pass one and fail the other; report each on its own.

CI already ran lint, types and tests. Read `gh pr checks`; don't re-run them. Run one specific test or command only when its result settles a finding.

## Bypass scan

Before reading the diff closely:

```bash
gh pr diff <n> | python3 -I ${CLAUDE_SKILL_DIR}/scripts/scan_bypasses.py
```

It lists added suppressions, skipped tests, type escapes, swallowed errors, unsafe HTML or SQL, timers, unticketed TODOs and comments. Each hit is a candidate for the area it belongs to, not a finding: a suppression with its reason beside it is fine; a bare one isn't.

## Areas

- **Correctness**: bugs, edge cases, loading and error states, races, stale cache invalidation, migrations. For every suspected bug, trace the call chain that makes it happen; "this could be null" is a finding only when a caller can pass null. Check root cause against symptom: a guard that masks a broken invariant, a cast that silences a modelling error.
- **Fundamentals**: for each meaningful change, look for the reframing that makes branches or modes disappear, and push for it over polishing the current shape. Then the five questions, the smells and the house style in `ground-rules`, and the repo's `AGENTS.md`. Search for the prior art the change should have mirrored.
- **Spec**: each acceptance criterion and spec behaviour against the diff. Scope creep counts. A claim in the PR description ("fixes X") with no test behind it is a question: which test fails on `main` and passes here?
- **Tests**: missing coverage for changed behaviour, and the tautology check on every added or edited test. A tautology test that is the only cover for a behaviour is Should fix; otherwise it's Could cut.
- **Concision**: what the change could drop without losing behaviour, coverage or legibility: tautology tests, tests of library behaviour, cases differing only by input (parametrise), edits outside the issue, single-use helpers that add a name but no clarity, options nobody passes, hand-rolled code an existing util covers, comments restating the code, try/except on paths whose failure should propagate. Never cut towards denser code.
- **Blast radius**: callers of changed shared code that the diff breaks. For each changed unit, name the one fact it's safe because of and how far you proved it: `said`, `line`, `traced`.
- **Security**, only when the diff touches auth, tokens, secrets, permissions or user input: a concrete, exploitable flaw the change introduces.
- **Workflows**, whenever the diff touches `.github/workflows/` or `.github/actions/`: the factory can push these, and they run with the repo's secrets, so review every line. Each job's `permissions` as narrow as its steps need; secrets only in the steps that use them, never echoed or passed to untrusted code; third-party actions pinned to a commit SHA; no `pull_request_target` or `workflow_run` that checks out or runs a PR's code; triggers that can't be fired from a fork to reach secrets. A gap here is Blocking.
- **Published standards**, when `AGENTS.md` has a Standards section: check the change against every standard it touches (accessibility for anything rendered, security for auth, input and data access, privacy for personal data, performance for what loads or renders). Review adversarially: a standard counts as failed until the diff shows it's met. Where the Standards table says a tool checks it (axe, Lighthouse), read that tool's result in the checks rather than repeating it, and review what the tool can't see (focus order, names that make sense, authorisation on each object, what personal data reaches logs). A finding names the standard and the clause it breaks.
- **Evidence**, for a user-facing change: the PR's evidence shows each acceptance criterion on the right path and state. Missing or mismatched evidence is Blocking.

Skip generated files (schema types, migrations Django generated, lockfiles) beyond checking they match their source. Code moved unchanged is reviewed as a move.

## Verify every finding

Try to disprove each one against the code at the head before keeping it:

- **Hypothetical or actual?** Trace the call site. If upstream validation or the types rule the input out, drop it.
- **Preference?** "I'd have done it differently" with no concrete problem isn't a finding.
- **Codebase pattern?** A pattern the repo uses deliberately isn't a finding unless a documented rule says otherwise.
- **Library behaviour** needs its docs checked this run, not memory, with the link in `Ref:`.
- **Drop or downgrade?** Drop for lack of evidence, downgrade for lack of impact. A Blocking finding you can't fully trace becomes a Should fix phrased as a question.
- No Nits on lines a Blocking or Should fix finding rewrites. When all that's left is Nits, the change is in good shape; say so.

## Tiers

- **Blocking**: breaks behaviour, data, security or a hard constraint in `AGENTS.md`; fails a clause of a published standard on a path the change ships; or required evidence is missing.
- **Should fix**: fundamentals, conventions, maintainability, missing tests.
- **Nit**: at most five.
- **Could cut**: separate and optional for the author. Each says what goes, why nothing is lost, and roughly how many lines it saves.

Classify each finding as **unambiguous** (the fix needs no human judgement) or **needs a human** (a product or technical decision only a person can make).

## Guard the class

For each Blocking or Should fix finding, name the cheapest guard that would stop its whole class of problem, not only this instance, in this order: a type or lint rule; an automated check (a test, axe, a CI step); a rule in `AGENTS.md` or a lesson. Say the class in a few words, the guard, and where it goes. When a guard the repo already has should have caught it, the guard is fixing that one. Leave it out when the finding is a one-off with no class worth guarding; never invent one.

## Writing a finding

Each finding is written so it can go in a GitHub inline comment as it stands; the `review` agent decides which go inline and which in the review body:

- Anchor it to a code line inside the diff whenever the finding allows.
- Open with the problem; the fix comes second, and it's the laziest fix that works: an existing repo helper, then a language built-in, then an installed dependency, then new code.
- A fix in one place of about 10 lines or fewer gets a `suggestion` block holding the exact replacement for the anchored lines. A bigger fix gets a short sketch in a normal fenced block.
- For a Blocking or Should fix finding, a nested `- Guard:` line before the Ref: the class and the guard, in a line.
- End with a nested `- Ref:` line saying what it rests on: `AGENTS.md › <rule>`, `ground rules › possible <smell>`, `ground rules › Tests (tautology: <shape>)`, `Spec › <criterion>`, `Standards › <standard> <clause>` (for example `Standards › WCAG 2.2 AA 1.4.11` or `Standards › ASVS 5.0 L1 V8.2.2`), `Traced: A → B:42 → <failure>`, or `Docs › <url>`. Cite a clause number only when you're sure of it; otherwise name the standard and say the requirement in words. Write the comment so it stands without the Ref.

Tone: collegial and neutral, British English, no praise. Ask a question when the author may know something you don't, and end on the ask; state it plainly when the evidence is conclusive. No exclamation marks, no "you forgot", "obviously" or "simply", no hedging stacks ("I think maybe"), no filler ("note that", "feel free"), no dashes inside comment prose. Keep a comment under about 900 characters, 400 for a Nit.

A bug the change didn't introduce goes in the summary as pre-existing, never as a finding.
