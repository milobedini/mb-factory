---
name: wrap-up
description: End a working session by bringing docs/PLAN.md up to date, and close the phase when its exit criteria are met. Use when the user is stopping, asks to wrap up, is about to /clear, or asks to close a phase or prune the plan.
---

# Wrap up

The plan holds direction, not state (see `CLAUDE.md`): Linear, Slack and the console already show work that's mid-stage. A wrap-up records what they can't. Work through the steps in order.

## 1. Capture what the session produced

Go back over the session for anything the plan should keep, and edit it into the section it belongs to:

- a decision, with its reason, that no code comment carries: **Decisions and why**;
- a lesson learnt the hard way: **Gotchas**;
- something built but not yet seen working, with what to check: **To see live**; and delete lines this session saw;
- a follow-up for the factory itself, not built: **Factory backlog**; and delete items this session built;
- a new way of operating something: **Working notes**.

A session about something unrelated (a Tastebook question, an issue lookup) usually adds nothing. Done when every decision, lesson and follow-up from the session has a home or is judged not worth keeping.

## 2. Find what only exists locally

Check `git status` and `git log origin/main..` in this repo and in `~/Documents/git/tastebook`, and recall anything agreed but not started: uncommitted or unpushed work, a migration the user hasn't run, a data fix waiting for approval, a step the user agreed to. Done when you can name each one, or there are none.

## 3. Rewrite Next

Replace **Next** in **Where things stand** with one sentence: the first step a fresh context window should propose to the user. It names anything from step 2 first; otherwise it's the next step of **Direction**. Check **Direction** still reads true too.

## 4. Close the phase, when it's due

The phase is due to close when the user asks, or when its exit criteria in the Phases table look met. If it is, follow [close-phase.md](close-phase.md), which checks the criteria properly and prunes the whole plan; it ends with its own commit. Otherwise skip this step.

## 5. Commit

If the plan changed, run `pnpm format`, then commit it as `Plan: <what changed>` and push once the user agrees. Then tell the user the **Next** sentence, and anything from step 2 that's waiting on them.
