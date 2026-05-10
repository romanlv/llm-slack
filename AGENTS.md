# Repository Instructions

## Architecture Guardrails

- Use `docs/architecture.md` as the detailed guide for feature work and update
  it when intentionally changing architectural direction.
- Keep product behavior explicit and separated from UI rendering, persistence,
  and provider transport.
- Prefer small, well-named domain, repository, service, and provider boundaries
  over putting cross-cutting behavior directly in components.
- Preserve conversation invariants when changing parent chats, threads,
  messages, streaming, or stored summary fields.
- Keep provider-specific details behind provider adapters, and keep browser-side
  API key handling in mind when changing runtime behavior.

## Tests

- Use Vitest for domain, service, repository, provider, and component behavior
  tests.
- Keep tests colocated next to the files they verify, using `*.test.ts` or
  `*.test.tsx`.
- Use `fake-indexeddb` for IndexedDB/Dexie persistence tests. The shared setup
  in `src/test/setup.ts` resets the singleton database before each test.
- Use React Testing Library for component behavior tests that cannot be covered
  as pure domain/service tests. Prefer accessible queries and `user-event` over
  snapshots.
- Use `@vitest-environment jsdom` at the top of colocated component tests that
  need a browser-like DOM.
- Provider tests must use fakes or fixtures and must not call external provider
  APIs.
- When mocking `Date.now()` to step a value across multiple operations, use a
  single spy and call `mockReturnValue` between awaits. Do not chain
  `mockReturnValueOnce(...)` — incidental Date.now() calls inside Dexie or
  React internals consume queue slots and produce order-dependent flakes.

## Test Commands

- `pnpm test` runs the full Vitest suite once.
- `pnpm test:watch` runs Vitest in watch mode.
- `pnpm typecheck` runs TypeScript checks.
- `pnpm lint` runs ESLint.

Run `pnpm test`, `pnpm typecheck`, and `pnpm lint` before committing test or
runtime changes.
