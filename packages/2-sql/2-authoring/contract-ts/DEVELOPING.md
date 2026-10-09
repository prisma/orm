# Developing `@internal/sql-contract-ts`

This note keeps contributor-facing lowering details and warning semantics out of the package README.

## Lowering Pipeline

1. `defineContract(...)` captures structural authoring state from `field`, `model`, `rel`, and any pack-composed helper namespaces.
2. Internal SQL resolution normalizes table and column names, relation anchors, indexes, foreign keys, named storage types, and FK defaults into the shared contract definition shape.
3. SQL contract generation turns that definition into the canonical SQL contract consumed by emitted `contract.json`, emitted `contract.d.ts`, `schema()`, `sql()`, `orm()`, the runtime, and migration tooling.

## Building the contract from the definition

`buildSqlContractFromDefinition` (`src/build-contract.ts`) runs in two stages, so a model's columns and the columns a table node declares go through the same lowering. ADR 267 (prisma/orm#30641) gives the reason.

1. Describe. `describeModel` (`src/describe-model.ts`) turns each model on its own into the table it describes and its domain model; it reads other models only to resolve references (`src/model-references.ts`, `src/model-relations.ts`, `src/resolve-foreign-key.ts`). `describeTableNode` (`src/describe-table-node.ts`) does the same for each table node. Both build their columns with `describeColumn` (`src/describe-column.ts`). The description types are in `src/storage-description.ts`.
2. Lower. `mergeTables` (`src/merge-tables.ts`) merges the descriptions into one per namespace and table name, and refuses conflicting declarations. `lowerTable` (`src/lower-table.ts`) lowers each table, calling `lowerColumn` (`src/lower-column.ts`) for every column. Then `build-contract.ts` assembles roots, namespaces, enums, the storage hash and the domain.

Errors name the declaration the author wrote, through `src/declaration-sites.ts`.

## Validation and Warnings

- Duplicate named primary keys, uniques, indexes, and foreign keys are rejected during build and validation. Later declarations do not silently override earlier ones.
- Prefer `field.namedType(types.Role)` when the storage type is declared in the same contract. `field.namedType('Role')` still works, but it emits a typed-fallback warning when a local typed reference is available.
- Prefer named model tokens plus `User.refs.id` or `User.ref('id')` for cross-model foreign-key and relation authoring. String fallbacks still work, but they emit typed-fallback warnings when the named model token is available in the same contract.
- Keep field-local and FK-local storage overrides next to the authoring site with `field.sql({ column | id | unique })` and `rel.belongsTo(...).sql({ fk })`. Contract-wide defaults belong on `foreignKeyDefaults`.
