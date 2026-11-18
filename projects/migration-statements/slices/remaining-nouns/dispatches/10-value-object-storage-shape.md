# Dispatch 10 — value objects in the storage plane: contract shape and validators

**Plan:** [`../plan-pr3.md`](../plan-pr3.md) · **ADR:** `docs/architecture docs/adrs/ADR 309 - Value objects are storage entities, and a discriminator column names a value set.md` · **Grounding:** `wip/pr3-grounding.md` § A, B · **Branch:** `tml-3537-value-objects-storage`

## Outcome

The contract types and validators accept a value object as a storage entity, at `storage.namespaces.<ns>.entries.valueObject.<Name>`, in both families, with the same definition it has in the domain plane today. A domain field that holds a value object refers to it by a storage coordinate, and so does a value object member that holds another. Validation checks the reference across the two planes. The domain plane no longer has a `valueObjects` key. Nothing writes the new shape yet; authoring and emit change in dispatches 12 and 13, so this dispatch keeps the old fixtures passing only where a test needs them and says which tests it left for dispatch 12.

## What the grounding found

- Nothing in the domain plane refers to storage today. An enum field's `valueSet` refers to the domain enum (`value-set-ref.ts`). This reference is the first from domain to storage, which ADR 221 allows (a domain entity may refer to a storage entity, never the reverse).
- Domain validation (`validate-domain.ts`) sees only the domain plane and needs read access to storage for this check.
- No existing type fits the reference as it is. `EntityCoordinate` lives in framework-components, which foundation cannot import. Decide the reference type from the code: a storage coordinate in foundation, consistent with the existing cross-plane references (`plane`, `namespaceId`, `entityKind`, `entityName`), reused rather than duplicated. Report the name and shape you chose, and why.

## Do

1. Read ADR 221, ADR 309, ADR 178, `domain-types.ts`, `value-set-ref.ts`, `validate-domain.ts`, the SQL and Mongo storage types and their validators, the JSON schema `data-contract-sql-v1.json`, and the domain accessors (`domainValueObjectsAtDefaultNamespace` and friends).
2. **Tests first, red before each change:** a contract with a value object in storage and a field referring to it validates; a reference to a missing storage value object is refused with a message naming the field and the coordinate; a nested reference resolves; a value object that refers to itself validates; the old domain `valueObjects` key is refused; both families.
3. Implement the types, the validators and the accessors. Keep every name from the existing vocabulary (`valueObject` is the entity kind, as ADR 309 says). Do not invent new nouns; if a new name is unavoidable, say so in the report with candidates.
4. Update the JSON schema.

## Do not

- Do not change authoring, emit, runtime or the MongoDB validator derivation; those are dispatches 12 to 14.
- Do not re-emit fixtures; that is dispatch 16.

## Rules

- Never run `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all`. Only named files inside `test/integration` with `pnpm test <file>`.
- Use the shell's Node and `pnpm`. Never `npx`.
- No comments where the code can say it; no bare `as` casts in production code; no `any`; arktype, not zod; no file extensions in imports; no backwards-compatibility exports; framework packages name no family or target.
- Commit with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`. No AI attribution lines. Stage files explicitly.
- Do not push. Do not open a PR.
- Save slow command output under `wip/` and read the file. The machine may be loaded: run tests by file where you can.

## Done when

- Typecheck of the touched packages; lint and `test --coverage` in the contract foundation, framework-components, SQL contract and Mongo contract packages; `lint:deps`; `lint:ratchets`.
- The report lists every test outside those packages that now fails because nothing writes the new shape yet, for dispatch 12.

## Report

Plain English, short sentences: the reference type and why, the validation rules and messages, the test that was red first for each change, the gates, the tests left failing for dispatch 12, and the commits.
