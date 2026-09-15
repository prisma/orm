# Dispatch 1b: Prisma 8 PSL interpreter features the round trip needs

**Slice plan:** `projects/prisma7-contract-source/slices/03-contract-to-psl-and-convert/plan.md` (added after dispatch 1 halted)
**Model tier:** Fable (implementer). **Time-box:** one session.

## Task

Dispatch 1 found three constructs that Prisma 8 PSL cannot express and one place where the PSL interpreter drops information the Prisma 7 source keeps. Build the four features in the PSL interpreter (`packages/2-sql/2-authoring/contract-psl`), each test-first, then finish dispatch 1: the hand-written `contract.prisma` uses the real spellings, and `prisma8-spelling.integration.test.ts` is green.

The operator's rule applies: these are features, designed on their own terms. No check is relaxed, no escape hatch added.

## Scope

In, one commit per numbered item, each with a red-then-green test in `contract-psl` (quote the red run in the report):

1. **A unique index makes a back-relation one-to-one.** `@@index([userId], unique: true, map: "Profile_userId_key")` on the foreign key columns makes the back-relation on the referenced model one-to-one, exactly as `@unique` does. Today `modelUniqueColumnSets` in `packages/2-sql/2-authoring/contract-psl/src/interpreter.ts` counts only `@id`, `@unique`, and `@@unique`, so the schema fails with `PSL_NON_UNIQUE_BACKRELATION`. Count column-list unique indexes too (same column set, any order). A unique index over an expression does not count.
2. **`BigInt` literal defaults keep their exact value.** `@default(9007199254740993)` on an `int8` column lowers to a `bigint` built from the number token's source text, never through a JS `number`. Today the value rounds and the codec refuses it. The Prisma 7 source already does this in `packages/2-sql/2-authoring/contract-prisma7/src/defaults.ts` (`elementValue`); the PSL interpreter's literal lowering gets the same behaviour for the `pg/int8@1` codec (and any codec whose JSON form is a bigint; find the right discriminator rather than hard-coding the id if the codec descriptors expose one). Also inside list literals.
3. **JSON literal defaults on `Json`/`Jsonb` columns.** A string literal default on a column whose codec is a JSON codec is JSON text: `@default("{\"a\":1}")` lowers to the literal default `{ a: 1 }`, `@default("{}")` to `{}`, `@default("[]")` to `[]`. Invalid JSON text is a diagnostic naming the field and the parse error. This is item 2 (JSON half) of the dbgenerated removal brief (tracked outside this project), pulled forward; add a line to that brief saying it is built in this PR.
4. **Scalar list fields keep `typeParams` in the domain plane.** `patchModelDomainFields` (`interpreter.ts`, around line 1641) rebuilds a scalar list field's type as `{ kind: 'scalar', codecId }` and drops the `typeParams` the resolved field carries (`{ length: 32 }` for `VarChar(32)[]`, `{ precision: 3 }`, `{ typeName }` for enum lists). Keep them, matching non-list fields.
5. **Finish dispatch 1.** Replace the temporary substitutions in `test/integration/test/fixtures/prisma7-source/supported-verify/contract.prisma` with the real spellings; `prisma8-spelling.integration.test.ts` green with no substitutions; update the "Slice 3 spellings" section of `projects/prisma7-contract-source/slices/01-postgres-source/verification-results.md` so every row states the final spelling and names the feature that made it possible.
6. **Docs.** `packages/2-sql/2-authoring/contract-psl/README.md`: the JSON literal default, the BigInt literal rule, and the unique-index one-to-one rule, one sentence each in the sections that already describe defaults and relations.

Out: the printer, the command, Mongo, any change to the PSL parser or `@internal/psl-parser`, any change to the Prisma 7 source, any change to `dbgenerated`.

## Completed when

- [ ] Four red-then-green tests in `contract-psl`, quoted.
- [ ] `pnpm --filter integration-tests test prisma7-source` fully green, including `prisma8-spelling.integration.test.ts` with the real spellings.
- [ ] `pnpm --filter @internal/sql-contract-psl test`, `typecheck`, `lint`, `build`; `pnpm --filter @internal/sql-contract-prisma7 test` (the Prisma 7 source is a consumer of `contract-psl`); `pnpm test:packages` once as a final check, output saved under `wip/`; root typecheck; `pnpm fixtures:check`.
- [ ] No existing test changed its expectation except where a fixture provably encoded the old, lossy behaviour; list each such change.

## Halt conditions

- Item 2 or 3 needs a change to `ColumnDefaultLiteralInputValue` or the contract validator. Report the shape and stop.
- A feature needs a parser change. Report and stop.
- `pnpm fixtures:check` changes a fixture outside `prisma7-source` and the change is not one of the four features' intended effects. List and stop.

## References

- Dispatch 1's report is in `verification-results.md` § Slice 3 spellings; the hand-written file is the target.
- Rules and commits as dispatch 1 (`dispatches/01-hand-written-prisma8-spelling.md`); F13 above all: each test must fail before its feature exists.
