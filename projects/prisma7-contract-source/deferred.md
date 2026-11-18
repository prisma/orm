# Deferred work

Work found during the project and left for later, with why.

## Import cycle between the Postgres planner modules

`packages/3-targets/3-targets/postgres/src/core/migrations/issue-planner.ts` imports `planner-strategies.ts`, which imports `primary-key-change.ts`, which imports `issue-planner.ts` (for `emissionSchemaName`, `fkSpecFromNode` and the issue path helpers). `planner-strategies.ts` already imported `issue-planner.ts` before slice 8; slice 8 adds a third module to the cycle. It works because only functions cross it, and they are called after every module has loaded. Fix: move the shared helpers into a small module that `issue-planner.ts`, `planner-strategies.ts` and `primary-key-change.ts` all import.

## `StrategyContext.schema` could come from `startTree`

`StrategyContext.schema` is one namespace node of the start tree, picked by `relationalNamespaceNode` in `planner.ts`. Since slice 8 the context also carries the whole `startTree`, so `schema` could be derived from it instead of being passed separately.

## A primary key cannot move while an implicit many-to-many junction references it

Found in manual QA of slice 8. When a model takes part in an implicit many-to-many relation, moving its primary key to a composite key (for example `@@id([id, email])` with `id @unique`) makes `contract emit` refuse with `PSL_JUNCTION_TARGET_FK_NOT_ID`: the junction's foreign key to that model must reference the model's full `@id` columns. The diagnostic is raised in `packages/2-sql/2-authoring/contract-psl/src/psl-relation-resolution.ts`, and the Prisma 7 reader passes it through (`packages/2-sql/2-authoring/contract-prisma7/src/relations.ts`). Whether Prisma 7 allows this change was not checked. Supporting it needs a design decision about junctions whose target key is not the model's `@id`.

## `db update` does not see a foreign key from a schema no contract space declares (TML-3623)

A primary key change refuses when a referencing foreign key is on a table in a schema the end contract does not declare. `migration plan` raises that refusal when its start contract declared the schema. `db update` introspects only the schemas the contract spaces declare, so a foreign key from any other schema is not in its start tree: the strategy does not drop it, and the key drop then meets the Postgres dependency error at apply time (not checked by a test here). Tracked as TML-3623.
