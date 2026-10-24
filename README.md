# mb-factory

A reusable software factory that runs on a Claude subscription. Work arrives from Linear or Slack, moves through triage, spec, implement and review, and comes back as a pull request for a person to merge. It is modelled on [Warp Factories](https://docs.warp.dev/factories).

The plan, decisions and phases are in [docs/PLAN.md](docs/PLAN.md).

## Layout

| Path              | What it is                                                                            |
| ----------------- | ------------------------------------------------------------------------------------- |
| `apps/console`    | Next.js app on Vercel: webhook routes (the router) and the factory dashboard          |
| `packages/core`   | Framework-agnostic logic: config, usage governor, stage machine, webhook verification |
| `plugin`          | Claude Code plugin with the stage agents and skills, installed into project runs      |
| `workflows`       | Reusable GitHub workflows that run a stage in a project repo                          |
| `projects/<name>` | Per-project factory definition (`factory.yaml`) and instruction overrides             |

## Development

Requires Node 24+ and pnpm.

```bash
pnpm install
pnpm test        # Vitest
pnpm lint        # ESLint, Prettier and type-check
pnpm dev         # console on http://localhost:3000
```
