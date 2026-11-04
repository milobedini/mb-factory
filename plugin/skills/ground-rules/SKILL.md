---
name: ground-rules
description: The engineering bar a factory change is designed and built to — mirroring prior art, scope, one owner for state, blast radius, and tests that can fail. Read when designing a change or writing code or tests.
---

# Ground rules

The repo's `AGENTS.md` wins wherever it says otherwise, and holds the project's own style.

## Design

- Find how the codebase already solves the problem and mirror it. Deviate only for a stated, material reason.
- Write it as if the requirement had been there from day one, not bolted on. When behaviour varies by type or variant, a new case is a new unit, not another branch.
- Nothing beyond what was asked: no abstraction, parameter or option that nothing needs yet.
- One owner for each piece of state and each list; derive the rest.
- Every new request has a loading state and an error state. Queries hold up at real volumes: no N+1.
- Before changing shared or exported code, find its callers, including where a symbol search stops: string-built keys, route strings, URL paths, serializer field names, generated schema types, fixtures and mocks.
- A comment says a non-obvious why, in a line.

## Tests

- Each test calls the subject as a caller does, with one concrete input, and asserts a literal, observable result: rendered text, a response body, a database row, the payload a request sent.
- Would it still pass if every function it imports returned `undefined`? Then it can't catch a defect: rewrite the assertion or delete the test. The usual shapes: asserting only truthiness or "doesn't throw", a mock asserted called with its payload unchecked, an expected value computed by the code under test.
- To test an absence, assert the presence on the other input in the same test.
- Cases that differ only by input are one parametrised test.
