---
name: close-phase
description: Close a factory phase and prune docs/PLAN.md back to direction, decisions and lessons. Use when a phase's exit criteria may be met, or the user asks to close a phase or prune the plan.
---

# Close a phase

The plan holds direction, not state (see `CLAUDE.md`). A phase close is when it gets pruned: everything between closes only edits the section a decision or lesson belongs to. Work through the steps in order; each ends on its criterion.

## 1. Check the exit criteria

Read the phase's exit criteria in the plan's Phases table and check each against the evidence: the console's Dashboard, Runs and Inbox, Linear, the Slack threads, `git log`. Production data comes from read-only queries (Working notes says how).

Done when every criterion is met, with what showed it. If one isn't, stop and tell the user what's missing: the phase stays open, and pruning waits.

## 2. Prune the plan, section by section

For each section below, every line is either kept, rewritten or deleted. Collect what you delete, with why, for step 4.

- **To see live:** each line is now seen (find it in Slack, the console's logs or the Runs page: say where), still pending, or stale. Delete the seen ones. A line pending for more than a phase becomes a backlog item or goes; ask the user which.
- **Factory backlog:** grep the code for each item. Delete what's built; ask about anything that no longer seems wanted.
- **Decisions and why:** delete a decision once a code comment carries its reason, or once a later decision reversed it (keep only the final state). Fold settled backlog items that left a decision behind into this section.
- **Gotchas:** delete one the platform fixed or that no longer applies; keep the rest.
- **Working notes and How it works:** every path, command and ID still exists (check each).
- **Open questions:** settled ones become decisions or go.
- **Everything else:** no status, run stories, timestamps or "next" lists have crept in.

Done when every line in those sections has been checked, not sampled.

## 3. Close the phase

In the Phases table, mark the phase closed with the date. Update **Where things stand**: the phase line (the next phase and its exit criteria), **Direction**, and **Next** (one sentence: the immediate next step for a fresh context window).

## 4. Show the user, then commit

Show the user what changed: the phase closed, and the lines deleted or moved, grouped by section, each with its reason. Commit only once they agree, as `Plan: close Phase <n>`.
