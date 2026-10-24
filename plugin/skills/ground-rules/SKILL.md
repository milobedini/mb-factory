---
name: ground-rules
description: The engineering bar every factory change is designed, built and reviewed against — the five questions, design and code smells, house style, and the tautology-test rules. Read when designing a change, writing code or tests, or reviewing a diff.
---

# Ground rules

The bar the spec designs to, the implement stage builds to and the review stage reviews against. The repo's `AGENTS.md` wins wherever it says otherwise.

## The five questions

Answer them silently for any approach, proposed or under review:

1. **Why this way?** Justify it. If the requirement had been there from day one, would the code look like this? If not, it's bolted on.
2. **Scale?** Data: N+1 queries, real volumes, not just the happy path. Cases: when variants grow, does each new one become a new unit, or another branch in the same one?
3. **Maintenance?** Cut indirection that adds nothing.
4. **Scope?** Nothing that wasn't asked for.
5. **Blast radius?** Who else calls or shares the code being changed? Check before touching shared or exported code, not after. Name the one fact the change is safe because of, and look where a symbol search stops: string-built keys, route strings, URL paths, serializer field names, generated schema types, test fixtures and mocks.

## Conventions

- Find how the codebase already solves the problem before designing anything new. Reuse what exists; deviate only for a stated, material reason.
- Comments explain a non-obvious why, in one line. The code says what.
- Plan for more cases: when behaviour branches on a type or variant, write one unit per case plus a wrapper for the shared parts. A new case is a new unit, not another branch.
- Every new request has a loading state and error handling.

## House style (TypeScript)

- Strict types; no `any`. `import type` and `export type` for type-only imports, except enums.
- Arrow functions and functional patterns over classes. Named exports for shared modules.
- `const` with `map`, `filter` and `reduce` over `let`, mutable loops and `forEach`.
- `async`/`await` or `Promise.all` over `.then()` chains.
- Sequence with state, callbacks or a state machine, not `setTimeout`. Real timers (debounce, polling, animation) are fine.
- British English in code, copy and docs: colour, behaviour, optimise.

### When the project uses React

- Small, composable components; repeated logic moves into hooks or helpers. Divergent rendering gets its own component with early returns, not inline ternaries.
- Avoid `useEffect`: derive during render or handle in event handlers. Effects only sync with external systems.
- `useCallback` for callbacks, `useMemo` for expensive or shared-reference values, `memo` for pure components.
- Custom hooks return objects (`{ recipes, isSaving }`), not tuples.
- No `import React from 'react'`; import what you use by name.

## Smells

Flag one only when the change introduces or worsens it. A smell is a labelled heuristic ("possible Feature envy"), never a hard violation, and a rule in the repo wins over it.

### Design

- **Feature envy**: a function that mostly works on another module's or response's data, including long `a?.b?.c` walks. Move the logic next to the data.
- **Data clumps**: the same few params travelling together. Bundle them into one type.
- **Repeated switches**: the same switch on the same type in more than one place. Share one map, or one unit per case.
- **Shotgun surgery**: one logical change scattered across many files. Gather what changes together.
- **Divergent change**: one file edited for several unrelated reasons. Split it.
- **Speculative generality**: abstractions, params or options nothing needs yet. Inline them.
- **Split ownership**: two places write the same state, or keep their own copy of it. Give it one owner and derive the rest.
- **Two ways to do one task**: a second helper for a job the codebase already does one way. Keep one; move the callers.
- **Hand-synced list**: the same items listed in several places. Keep one list and derive the others.

### Code

- **Mysterious name**: a name that doesn't say what it does or holds. If no honest name comes, the design is murky.
- **Duplicated code**: the same logic shape twice in the change, or already in the codebase. Extract it once.
- **Primitive obsession**: a bare string or number standing in for a domain concept. Use the generated schema type, a union, an enum or a value type.
- **Middle man**: a unit that mostly passes through to another. Call the target directly.
- **Refused bequest**: a wrapper that omits or overrides most of what it wraps. Compose instead.

## Tests

- Before keeping a test, ask: would it still pass if every function it imports returned `undefined`? If yes, it can't fail for a defect. Rewrite the assertion or delete the test.
- Tautology shapes: weak assertions (only truthiness, "defined" or "doesn't throw", or presence of text the test itself rendered); mock-only assertions (called, with no payload checked); self-referential expectations (the expected value comes from the code under test); constant pins; fixture asserts fixture (a mock's payload asserted straight back without the subject transforming it).
- Each test calls the subject the way a user or caller does, with one concrete input, and asserts a literal, observable result: rendered text, a response body, a database row, the payload a request sent.
- To test an absence, assert the presence on the other input in the same test.
- Cases that differ only by input are one parametrised test.
- A tautology test isn't coverage: a behaviour covered only by one counts as untested.
