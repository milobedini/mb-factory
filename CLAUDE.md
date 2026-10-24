# mb-factory

Read [docs/PLAN.md](docs/PLAN.md) before changing anything: it records the decisions and the phase we are in.

- `packages/core` holds logic that must stay framework-agnostic and pure where possible. Test it with Vitest; route handlers in `apps/console` stay thin.
- TypeScript is pinned to 6.0.x because typescript-eslint does not support 7 yet.
- Use British English everywhere, including identifiers and copy.
- Factory output (commits, PRs, comments written by agents) carries no AI attribution.
- Run `pnpm lint` and `pnpm test` before committing.
