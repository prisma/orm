// Re-exported so a Postgres `migration.ts` only needs the single
// `@internal/postgres/migration` import for its base class and the
// CLI entrypoint, mirroring how `placeholder` is surfaced here. The
// renderer emits the entrypoint call as
// `MigrationCLI.run(import.meta.url, M)`.
export { MigrationCLI } from '@internal/cli/migration-cli';
// Re-exported so user-edited migration.ts files only need to depend on
// `@internal/postgres/migration` to fill in planner-emitted
// `placeholder("…")` slots, instead of pulling in `@internal/errors`
// directly. The planner emits an import from this same module.
export { placeholder } from '@internal/errors/migration';
export { sql } from '@internal/sql-contract/sql-expression';
export {
  checkExpression,
  col,
  fn,
  foreignKey,
  lit,
  primaryKey,
  unique,
} from '@internal/sql-relational-core/contract-free';
export {
  type DataTransformClosure,
  type DataTransformOptions,
  dataTransform,
} from '../core/migrations/operations/data-transform';
export { createExtension } from '../core/migrations/operations/dependencies';
export { rawSql } from '../core/migrations/operations/raw';
// Target-owned base class for migrations. Aliased to `Migration` so
// user-edited migration.ts files (and the renderer's scaffold) read as
// `class M extends Migration { … }` without having to thread the
// target-details generic or redeclare `targetId`.
export { PostgresMigration as Migration } from '../core/migrations/postgres-migration';
