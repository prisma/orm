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
        { columnName: 'recorded_at', descriptor: timestamptzColumn, nullable: false },
      ],
      id: { columns: ['id'] },
    },
  ],
};
```

`buildSqlContractFromDefinition(definition, ...)` gives a storage plane with tables `User` (`id`, `email`, `legacy_key`) and `audit_rows`, and a domain plane with model `User` (`id`, `email`) only. The storage plane equals, by deep equality, the one built from a definition where `legacy_key` is a field of `User`. The names in this example are illustrative; the implementer chooses the final shape of the definition members.

## Chosen design

### The build has two stages

1. **A model becomes definition components.** Each model is converted, on its own, into the storage it implies and its domain model. Its storage half is a table node: the table's column nodes (one per field), primary key, uniques, indexes, checks, foreign keys and control policy. Its domain half is the domain model: fields, the field-to-column bridge, relations. A single-table variant contributes column nodes to its base's table, not a table of its own. This step reads other models only to resolve references (relation targets, namespaces); it never reads another model's output.
2. **Tables are lowered and the contract is assembled.** The table nodes from step 1 and the table nodes in the definition are merged per table: a definition table node that names a table a model maps contributes only columns, and a definition table node for a table no model maps is lowered as a whole table. Then one column lowering runs over every column (data type, encoded default, value-set refs, native enum qualification, `noCheck`, derived checks) and one table lowering over every table (index and check naming, the reserved-prefix check, foreign key resolution and backing indexes). Then roots, namespaces, enums, the storage hash and the domain are assembled as today.

The equation follows from the structure: a field's column and a declared column are the same kind of node by the time they are lowered.

### Definition members

- **Column node**: `FieldNode` minus the field part (`fieldName`, `executionDefaults`, `enumTypeHandle`). `FieldNode` is restated as field part plus column node, so the two cannot drift.
- **Table node**: namespace, table name, column nodes, primary key, uniques, indexes, checks, foreign keys, control policy. Built from the existing node types.
- **Foreign key target**: a `ForeignKeyNode` may name a target table (with namespace) instead of a model. A model-targeted foreign key behaves as today.

### Refusals (structured `CONTRACT.*` errors)

- A column present both as a field's column and as a column node of the same table.
- A definition table node that names a table a model maps and also states table-level properties (primary key, uniques, indexes, checks, foreign keys, control). One declaration owns each table's table-level properties. Its columns are allowed.
- A column node addressed to a single-table variant's table through the variant. The base owns the table; the error names the variant.
- Two definition table nodes for the same table in the same namespace.

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

- The equation matrix passes with one row per column kind: plain scalar, list, `enumType()` handle, `pg.enum(handle)`, named storage type, value-object column, TypeScript literal default, canonical literal default, function default, column inside a foreign key with a backing index, column inside an authored index, column on a single-table base table, column on a multi-table variant's table, column on a table that is not `managed`. Each row compares the whole storage plane with deep equality.
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
