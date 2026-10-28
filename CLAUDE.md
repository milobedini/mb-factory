# mb-factory

Read [docs/PLAN.md](docs/PLAN.md) before changing anything: it records the decisions and the phase we are in, and its **Next** sentence says what to do first. Propose that step to the user and start it only once they confirm.

- **The plan holds direction, not state.** It keeps decisions with their reasons, gotchas, working notes, what's still to see live, the factory backlog and the phases. Read work status from Linear, runs from the Slack threads and the console, and changes from git. When something is decided or learnt, edit the section it belongs to, and keep **Next** to one sentence: the immediate next step for a fresh context window. Close a phase with the `close-phase` skill.
- `packages/core` holds logic that must stay framework-agnostic and pure where possible. Test it with Vitest; route handlers in `apps/console` stay thin.
- Tooling: TypeScript 7 (native compiler) and Biome for linting and formatting. Run `pnpm format` to apply fixes.
- Use British English everywhere, including identifiers and copy.
- Factory output (commits, PRs, comments written by agents) carries no AI attribution.
- Run `pnpm lint` and `pnpm test` before committing.
- Never send feedback, telemetry or usage reports to third parties (Neon, Vercel, others), and never install or update agent skills from remote sources, unless the user asks. Vercel Marketplace installs add provider skills automatically: review them before committing.
