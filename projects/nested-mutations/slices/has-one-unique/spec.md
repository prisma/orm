# Slice: has-one-unique

Parent project `projects/nested-mutations/`. Slice 9, independent of every other slice. It makes the SQL contract build refuse a one-to-one relation whose child key is not unique, so that every `1:1` relation in a SQL contract has a unique key on the child, which slice `nested-upsert` uses as the conflict target of a to-one upsert.

## At a glance

Today PSL and Prisma 7 authoring reject a singular back-relation over a non-unique foreign key (`PSL_NON_UNIQUE_BACKRELATION`), and TypeScript authoring accepts `rel.hasOne(Profile, { by: 'userId' })` when `Profile.userId` has no unique constraint. After this slice the shared SQL contract build throws for it:

```ts
const User = model('User', {
  fields: { id: field.column(int4Column).id() },
  relations: { profile: rel.hasOne(() => Profile, { by: 'userId' }) },
});
const Profile = model('Profile', {
  fields: { id: field.column(int4Column).id(), userId: field.column(int4Column) },
});

defineContract({ models: { User, Profile } });
// throws CONTRACT.RELATION_INVALID:
// Relation "User.profile" is one-to-one, but the fields "userId" of model "Profile" are not unique.
// Add a unique constraint over exactly those fields, or make "profile" a hasMany relation.
```

`userId: field.column(int4Column).unique()` makes it valid.

## Chosen design

### Where the rule lives

In `lowerRelations` (`packages/2-sql-family/2-authoring/contract-ts/src/model-relations.ts`), which `buildSqlContractFromDefinition` calls for every model. That function is shared by the TypeScript builder, the PSL interpreter and the Prisma 7 interpreter, and already holds the to-one nullability check that is the TypeScript counterpart of `PSL_REQUIRED_ONE_TO_ONE_BACKRELATION`. Decided by the project owner (2026-11-13). PSL and Prisma 7 report their own diagnostic earlier, so for them the check is never reached; for TypeScript it is the only check, and it holds for a `ContractDefinition` from any source.

### The rule

For each local relation with `cardinality: '1:1'` (cross-space relations are skipped, as `lowerRelations` already does), take the target model node (already resolved there as `targetModel`) and its unique column sets:

- the primary key's columns (`id.columns`);
- each unique constraint's columns (`uniques[].columns`);
- each index with `unique: true`, `columns` present (not an expression index) and no `where`.

The relation is valid when one of those sets is equal, as a set, to `relation.on.childColumns`. This is the same rule as `fkColumnsAreUnique` in `contract-psl/src/psl-relation-resolution.ts`: set equality, not a subset or superset. Postgres and SQLite need the conflict target of `ON CONFLICT` to match a unique index's columns exactly, which is what slice `nested-upsert` relies on.

### The error

`contractError('CONTRACT.RELATION_INVALID', message, { meta })`, the code the neighbouring relation checks use.

- Message: `Relation "<Model>.<relation>" is one-to-one, but the fields <"a", "b"> of model "<Target>" are not unique. Add a unique constraint over exactly those fields, or make "<relation>" a hasMany relation.` Fields are named by field name (the `targetFields` the function already computes), not by column name.
- Meta: `{ modelName, relationName, targetModel, fields, reason: 'has-one-key-not-unique' }`.

The exact wording may be adjusted while building, provided it names the relation, the target model and the fields, and says how to fix it.

### In-repo contracts

Each TypeScript contract whose `hasOne` has a non-unique child key keeps `hasOne` and gets `.unique()` on the child's key field (decided by the project owner, 2026-11-13). Their seed data already has at most one child per parent, and their tests treat the relation as one row. The fixtures' generated `contract.json` / `contract.d.ts` are regenerated.

| Contract | Field made unique |
| --- | --- |
| `test/e2e/framework/test/sqlite/fixtures/contract.ts` | `Profile.userId` |
| `test/integration/test/sql-builder/fixtures/contract.ts` | `Profile.userId` |
| `test/integration/test/sql-builder/fixtures/contract-no-pgvector.ts` | `Profile.userId` |
| `test/integration/test/contract-parity/fixtures/postgres/contract.ts` | `Profile.userId` |
| `test/integration/test/contract-parity/fixtures/sqlite/contract.ts` | `Profile.userId` |
| `packages/3-targets/postgres/9-facade/test/contract-builder/include-row-types.test-d.ts` | `Profile.userId` (type-checked only, never run; changed so it shows a valid contract) |
| `packages/3-targets/sqlite/9-facade/test/contract-builder/include-row-types.test-d.ts` | `Profile.userId` (same) |
| Tests in `packages/2-sql-family/2-authoring/contract-ts/test/` that build a `hasOne` or a `1:1` definition over a non-unique key | the key, unless the test is about something the key does not affect |

`test/integration/test/sql-orm-client/fixtures/contract.ts` and the ports string fixture (`Parent.childId` has a unique in `.attributes`) are already valid. Where a suite creates its tables with hand-written SQL, a `UNIQUE` is added to that SQL only if a test compares the database schema with the contract.

## Plan amendments

Recorded here because this session does not edit `plan.md`; the owner applies them.

- The package path in slice 9's focus is `packages/2-sql-family/2-authoring/contract-ts`, not `packages/2-sql/2-authoring/contract-ts`.
- The rule is in the shared SQL contract build (`lowerRelations`), so it applies to every SQL authoring source, not only TypeScript authoring. The plan's outcome is unchanged.
- Two more fixtures break under the rule: `test/integration/test/contract-parity/fixtures/postgres/contract.ts` and `.../sqlite/contract.ts`.

## Contract impact

No contract entity, kind or emitted artifact changes for a contract that was valid before. One authoring rule is added: the SQL contract build refuses a `1:1` relation whose child columns are not exactly a unique column set of the child model. The contract validator (`validateContract` / `contractFromJson`) is not changed, so an already-emitted `contract.json` with such a relation still loads; it fails the next time it is built from source.

## Adapter impact

None. No adapter code changes; the fixtures of both targets are edited.

## Coherence rationale

One rule, its tests, the in-repo contracts it breaks, and the upgrade entry for the authors it breaks. A reviewer checks the rule against PSL's `fkColumnsAreUnique` and sees each fixture change as the fix the error message asks for. Estimated diff: about 500 lines, most of it regenerated fixtures and tests. One PR.

## Scope

**In:**

- The check in `model-relations.ts`, with unit tests in `contract-ts/test/` through `defineContract` (TypeScript authoring) covering: non-unique single key refused; composite key covered only by a superset or a subset refused; key equal to the primary key, an inline `.unique()`, an `.attributes` unique, a unique index accepted; a partial (`where`) or expression unique index refused; column order of the unique not mattering; a `hasOne` and a `belongsTo` on the same key pair accepted when the key is unique.
- The contracts in the table above and their regenerated fixtures.
- An upgrade-instructions entry for app authors, under `upgrade-instructions/pending/has-one-unique/app/`, written with the `record-upgrade-instructions` skill: the error, and the two fixes (add a unique constraint over the key, or switch to `hasMany`).
- Docs: the `rel.hasOne` bullet of ADR 181 § Relations and ownership states that the target's `by` fields must be unique; the `contract-ts` README, if it describes `hasOne`.

**Out:**

- `packages/1-framework` (not changed), the contract validator, and the PSL / Prisma 7 interpreters (they keep their own diagnostics; no refactor to share `fkColumnsAreUnique`).
- Mongo authoring (`packages/2-mongo-family`), which has its own `hasOne` and its own build.
- The ORM client and any use of the guarantee; that is slice `nested-upsert`.
- TML-3086 (`contract infer` with a bare unique index).

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
| --- | --- | --- |
| `1:1` relation whose target is a polymorphic variant | Same rule against the variant's model node | If a variant node does not carry the unique sets its key is subject to (for example a variant stored in its base table), stop and bring it to the owner instead of special-casing it. |
| Cross-space relation | Not checked | `lowerRelations` handles these before the target lookup, and only `N:1` crosses spaces. |

## Slice-specific done conditions

- [ ] `pnpm fixtures:check` passes with the regenerated fixtures committed.

## Open questions

None.

## References

- Project spec: [`../../spec.md`](../../spec.md) § Contract impact; project plan on branch `nested-mutation-unique-key-writes`, slice 9.
- PSL rule: `packages/2-sql-family/2-authoring/contract-psl/src/psl-relation-resolution.ts` (`fkColumnsAreUnique`, `PSL_NON_UNIQUE_BACKRELATION`); unique sets assembled in `contract-psl/src/interpreter.ts` (`modelUniqueColumnSets`).
- Shared build: `packages/2-sql-family/2-authoring/contract-ts/src/build-contract.ts` (`buildSqlContractFromDefinition`), `src/model-relations.ts` (`lowerRelations`, `toOneRelationNullable`).
- [ADR 181 — Contract authoring DSL for SQL TS authoring](../../../../docs/architecture%20docs/adrs/ADR%20181%20-%20Contract%20authoring%20DSL%20for%20SQL%20TS%20authoring.md); [ADR 250](../../../../docs/architecture%20docs/adrs/ADR%20250%20-%20Models%20and%20views%20are%20emitted%20from%20the%20contract.md) (one-to-one back-relations are nullable).
