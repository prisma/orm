# Dispatch 13 — `contract.d.ts` reads value objects from storage

**Plan:** [`../plan-pr3.md`](../plan-pr3.md) · **ADR:** ADR 309 · **Grounding:** `wip/pr3-grounding.md` § A (foundation `field-value-types.ts`, framework emitter, SQL and Mongo emitters), C · **Builds on:** dispatch 10 · **Branch:** `tml-3537-value-objects-storage`

## Outcome

The emitted `contract.d.ts` describes value objects in the storage plane, and field types resolve a value object through its storage coordinate:

- The framework emitter renders a value object field type as its coordinate, not `{ kind: "valueObject"; name }`. It drops the domain `valueObjects` line and writes value objects from storage.
- The SQL and Mongo emitters write `entries.valueObject` in the storage namespaces type.
- `FieldTypesFromDomain` (foundation `field-value-types.ts`) finds value objects in the storage namespaces, matched by `namespaceId` and `entityName`. The new type parameter goes last and has a default, so a contract without value objects emits the same `contract.d.ts` text as today (grounding C: 329 committed files otherwise change).
- Whether the top-level flat `valueObjects` block in `contract.d.ts` stays: decide from what reads it, and say why in the report.

## Do

1. **Tests first, red before each change:** emitter golden or snapshot tests for a contract with nested, list and enum-member value objects in both families; a type test that a field holding a value object gets the member types, including a nested one and a self-referring one; a contract without value objects emits unchanged text.
2. Implement in foundation, the framework emitter and both family emitters.
3. Fix the source type errors dispatch 10 left in `emitter`.

## Do not

- Do not change authoring (dispatch 12), runtimes, the CLI or `contract print` (dispatch 14), or Postgres checks (dispatch 15).
- Do not re-emit committed fixtures or examples (dispatch 16).

## Rules

- Never run `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all`. Only named files inside `test/integration` with `pnpm test <file>`.
- Use `mise exec --` for node and pnpm. Never `npx`.
- No comments where the code can say it; no bare `as` casts in production code; no `any`; no file extensions in imports; no backwards-compatibility exports; framework packages name no family or target.
- Commit with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`. No AI attribution lines. Stage files explicitly.
- Do not push. Do not open a PR.
- Save slow command output under `wip/` and read the file.

## Done when

- Typecheck, lint and `test --coverage` pass in foundation, the framework emitter and both family emitters; `lint:deps`; `lint:ratchets`.
- Emitting one SQL and one Mongo fixture without value objects gives byte-identical `contract.d.ts`.

## Report

Plain English, short sentences: the new type parameter and its default, the rendered field type, the decision on the flat block, the test that was red first for each change, the checks, what is still red, and the commits.
