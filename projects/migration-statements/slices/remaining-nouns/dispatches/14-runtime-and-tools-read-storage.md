# Dispatch 14 — runtimes and tools read value objects through the field's storage reference

**Plan:** [`../plan-pr3.md`](../plan-pr3.md) · **ADR:** ADR 309 · **Grounding:** `wip/pr3-grounding.md` § A (CLI, Postgres target, Mongo query builders) · **Builds on:** dispatches 12 and 13 · **Branch:** `tml-3537-value-objects-storage`

## Outcome

Nothing reads `domain.namespaces.<ns>.valueObjects`, the removed accessor `domainValueObjectsAtDefaultNamespace`, or the old field type `{ kind: 'valueObject', name }`. Each reader finds a value object through the field's storage coordinate, with `valueObjectAt` from `@internal/contract`:

- The Mongo ORM (`mongo-orm`: `collection.ts`, `compile.ts`, `field-accessor.ts`) and the Mongo query builder (`builder.ts`, `resolve-path.ts`, `result-shape.ts`), at run time and at type level. Remove the dead `MergedContractValueObjects` fallback that read the dropped flat `valueObjects` block of `contract.d.ts`.
- The CLI statement resolver (`resolve-statements.ts`, `hasValueObject`): it still refuses a statement that names a value object (PR 4 replaces that), but finds value objects in storage. Fix the test type error at `test/control-api/statements/statement-fixtures.ts:68`.
- `contract print` in the Postgres target (`psl-print/domain-types.ts`, `scalar-fields.ts`, `refusals.ts`): prints `type` blocks from storage value objects. The print round trip of a contract with nested, list and enum-member value objects must be lossless.
- `contract infer` produces no value objects; no change, unless a type error says otherwise.
- `db verify` compares tables and checks by name; confirm it needs no change.
- The SQL ORM has no run-time value object reader; confirm, and fix only what its type tests need.

## Do

1. **Tests first, red before each change:** a Mongo ORM read and write of a nested and a list value object through `mongodb-memory-server`; a query builder path into a value object member; the CLI refusal of a statement naming a value object, now found in storage; the Postgres print round trip.
2. Implement. Grep the whole repo, both families, for `valueObjects`, `domainValueObjectsAtDefaultNamespace` and `kind: 'valueObject'` with `name`, and leave none outside committed fixtures and snapshots (dispatch 16).

## Do not

- Do not change authoring, emit or derived checks (dispatch 15). Do not re-emit fixtures or examples (dispatch 16). Leave the derived-check parts of `psl-print/model-attributes.ts` and `psl-infer` to dispatch 15.

## Rules

- Never run `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all`. Only named files inside `test/integration` with `pnpm test <file>`.
- Use `mise exec --` for node and pnpm. Never `npx`. Do not write to `/tmp` or any system temp directory; save slow output under `wip/` and read the file.
- No comments where the code can say it; no bare `as` casts in production code; no `any`; no file extensions in imports; no backwards-compatibility exports; framework packages name no family or target. No invented nouns.
- Commit with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`. No AI attribution lines. Stage files explicitly.
- Do not push. Do not open a PR.

## Done when

- Typecheck, lint and `test --coverage` pass in `mongo-orm`, `mongo-query-builder`, `target-mongo`, `target-postgres`, the CLI, and every other package this dispatch touches; `lint:deps`; `lint:ratchets`.
- The report lists what is still red and why (committed fixtures for dispatch 16).

## Report

Plain English, short sentences: each reader and how it now finds value objects, the grep result, the test that was red first for each change, the checks, what is still red, and the commits.
