# Slice 1: the contract definition holds columns and tables with no model

_Parent project: `projects/unmapped-storage/`. Linear: TML-3468. Outcome: a `ContractDefinition` can carry columns and tables no model maps, and the build lowers them through exactly the code that lowers a model's columns and tables._

## At a glance

```ts
const definition: ContractDefinition = {
  ...base,
  models: [userWithoutLegacyKey],
  tables: [
    {
      tableName: 'User',
      columns: [{ columnName: 'legacy_key', descriptor: textColumn, nullable: true }],
    },
    {
      tableName: 'audit_rows',
      columns: [
        { columnName: 'id', descriptor: int4Column, nullable: false },
        { columnName: 'recorded_at', descriptor: timestamptzTemporalColumn, nullable: false },
      ],
      id: { columns: ['id'] },
    },
  ],
};
```

`buildSqlContractFromDefinition(definition, ...)` gives a storage plane with tables `User` (`id`, `email`, `legacy_key`) and `audit_rows`, and a domain plane with model `User` (`id`, `email`) only. The storage plane equals, by deep equality, the one built from a definition where `legacy_key` is a field of `User`. The names in this example are illustrative; the implementer chooses the final shape of the definition members.

## Chosen design

### The build has two stages

1. **Each model and each table node is described on its own.** A model becomes a table description and its domain model. The table description holds one column description per field, the primary key, uniques, indexes, checks, resolved foreign keys and control policy. The domain model holds fields, the field-to-column bridge and relations. A single-table variant has no table of its own: every source already copies its columns onto the base model, and the build refuses a variant column the base table lacks. A definition table node becomes a table description the same way. This step reads other models only to resolve references (relation targets, foreign key targets, namespaces); it never reads another model's output.
2. **Tables are merged, lowered, and the contract is assembled.** The table descriptions are merged per table: a definition table node that names a table a model maps contributes only columns, and a definition table node for a table no model maps is lowered as a whole table. Then one column lowering runs over every column (data type, encoded default, value-set refs, native enum qualification, `noCheck`, derived checks) and one table lowering over every table (index and check naming, the reserved-prefix check, foreign key backing indexes, checks in canonical order); foreign key targets were resolved in step 1. Then roots, namespaces, enums, the storage hash and the domain are assembled as today.

The equation follows from the structure: a field's column and a declared column are the same kind of node by the time they are lowered.

### Definition members

- **Column node**: `FieldNode` minus the field part (`fieldName`, `executionDefaults`). `FieldNode` extends the column node, so the two cannot drift. The `enumType()` handle sits on the column node, because it decides storage: the column's value-set reference and its membership check.
- **Table node**: namespace, table name, column nodes, primary key, uniques, indexes, checks, foreign keys, control policy. Built from the existing node types.
- **Foreign key target**: a `ForeignKeyNode` may name a target table (with namespace) instead of a model. A model-targeted foreign key behaves as today.

### Refusals (structured `CONTRACT.*` errors)

- A column present both as a field's column and as a column node of the same table, including a single-table variant's field whose column a column node of the base table declares. A column a table node lists twice.
- A definition table node that names a table a model maps and also states table-level properties (primary key, uniques, indexes, checks, foreign keys, control). One declaration owns each table's table-level properties. Its columns are allowed.
- A single-table variant's column that its base table does not have. The base owns the table; the error names the variant. (A column node cannot be addressed to a variant: a table node names a table, and a variant's table is its base's.)
- A foreign key to a table nothing declares.
- Two definition table nodes for the same table in the same namespace.

### Intended differences from `main`

- A relation whose target names no namespace resolves to the target model's own namespace, not to the first model of that name the build met. The old behaviour depended on model order when two models share a name across namespaces.
- A single-table variant's column that its base table lacks is refused. Every source today copies variant columns onto the base, so no existing definition reaches this.
- A table's checks come out of the build in the canonical order. The emitted `contract.json` and the storage hash do not change.

## Coherence rationale

One reviewer can hold it: one function's restructuring, two new definition members, and the tests that prove the restructuring changed nothing and the new members lower like fields. No source and no consumer changes.

## Scope

In:

- `contract-definition.ts`, `build-contract.ts` and the modules it calls in `packages/2-sql/2-authoring/contract-ts/src/`.
- The equation matrix test and the refusal tests.
- The old-versus-new comparison, run and reported in the PR.

Deliberately out:

- Any source producing column or table nodes (PSL, TypeScript DSL, Prisma 7 reader).
- The ORM, the emitter, `contract print`, verify, the planner.
- `SqlContractResult` (no-emit types): it reads the TypeScript builder's definition type, which gains nothing in this slice.

## Pre-investigated edge cases

| Case | Disposition |
|---|---|
| Foreign key order in the hash | Canonicalization sorts checks, indexes and uniques but not foreign keys (`packages/2-sql/1-core/contract/src/canonicalization-hooks.ts`). Merged foreign keys must come out in a deterministic order that does not depend on whether they came from a model or a table node. |
| Backing index for a foreign key | `materializeForeignKeysAndIndexes` adds an index only when the table's own indexes, uniques and primary key do not cover the key. It must run once per merged table, after declared indexes are merged, or the two forms differ. |
| `definition.storageHash` pin | Test escape hatch. The equation matrix must not use it. |
| Relation join columns | `columnToField.get(col) ?? col` in the relation lowering. Unchanged here; slice 2 refuses a join column with no field. |

## Slice-specific done conditions

- The equation matrix passes with one row per column kind: plain scalar, list, `enumType()` handle, `pg.enum(handle)`, named storage type, value-object column, TypeScript literal default, canonical literal default, function default, column inside a foreign key with a backing index, column inside an authored index, column on a single-table base table, column on a multi-table variant's table, column on a table that is not `managed`. Each row compares the whole storage plane with deep equality, and rows that derive checks also move a field from the middle of the model.
- The old-versus-new comparison over every definition the repository's tests and fixtures produce reports no difference in contract, flushed warnings, or thrown error code and message.

## Dispatch plan

| # | Outcome | Builds on | Hands to |
|---|---|---|---|
| 1 | The build is restructured into the two stages with no new input. The comparison harness captures every definition built while the contract-ts, contract-psl and contract-prisma7 test suites and the fixture checks run, builds each with the old and the new code, and reports zero differences. The harness and the old code are not committed. | main | A two-stage build that behaves exactly as before, and the harness report. |
| 2 | Column nodes, table nodes and table-targeted foreign keys exist in the definition, flow through stage 2, and are refused where the spec says. The equation matrix and refusal tests pass, written red first. | Dispatch 1 | The slice outcome. |

## References

- ADR 267 (prisma/orm#30641), ADR 181.
- Reviews of ADR 267 (principal engineer, items 1 and 5): the lowering outputs a declared column needs, and where the loop is not per model.
- `packages/2-sql/2-authoring/contract-ts/src/build-contract.ts:1183` (`buildSqlContractFromDefinition`).
