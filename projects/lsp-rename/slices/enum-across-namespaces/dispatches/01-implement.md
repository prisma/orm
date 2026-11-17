# Brief: enum-across-namespaces, one dispatch

## Task

Implement the slice spec `projects/lsp-rename/slices/enum-across-namespaces/spec.md`: the three changes of "Chosen design", their tests, and one migration-plan test.

## Constraints

- Change only the three places the spec names. Keep each change as small as it can be: the interpreter takes the block name and namespace id from the binder's resolution and looks the entity up under that id; nothing else in the interpreter changes. No new exported type, no new map, no new descriptor field, no new diagnostic text.
- `contract-prisma7` must stay identical to `origin/main`. If the shared function the Prisma 7 interpreter calls has to change shape, keep the Prisma 7 call site working unchanged; if that is impossible, stop and report.
- Tests first; plain `it` per case; no "should"; no comments added; no bare `as` in `src/`.
- New commits on `enum-across-namespaces`, `-s`, no push, nothing under `projects/` edited.

## Halt conditions

- A same-namespace contract would change.
- The printer cannot express the column without changing how enum blocks are placed.
- A file outside the three places and their tests needs a change.

## Gate

Typecheck, lint and tests of `contract-psl`, `contract-ts`, `contract-prisma7` and the Postgres target; `pnpm fixtures:check`; `pnpm lint:deps`; `node scripts/lint-throws.mjs`; once at the end `pnpm test:packages`.
