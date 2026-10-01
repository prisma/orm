import type { Contract } from '@internal/contract/types';
import { deriveProvidedInvariants } from '@internal/migration-tools/invariants';
import { Migration } from '@internal/migration-tools/migration';
import type { SqlStorage } from '@internal/sql-contract/types';
import { isThenable } from '@internal/utils/promise';
import type { SqlMigrationPlanOperation, SqlPlanTargetDetails } from './migrations/types';

/**
 * Family-owned base class for SQL migrations.
 *
 * Generic in `TDetails` (family plan target details, e.g. Postgres vs SQLite)
 * and in `TTargetId` (the literal target identifier, e.g. `'postgres'`).
 *
 * Adapters (Postgres, SQLite, …) extend this with a concrete `TDetails` and
 * a fixed `TTargetId` literal, so the public `Migration<TOp>` base sees the
 * fully concrete operation shape. Target-free code in SQL family / tooling
 * parameterises over `TDetails` (and usually `TTargetId = string`).
 *
 * The `Start` / `End` contract generics are forwarded to the framework
 * `Migration` base so the derived `describe()` and the per-target view getters
 * (`PostgresMigration` / `SqliteMigration`) carry each migration's precise
 * contract types. The view getters themselves live on the per-target bases
 * because the SQL ContractView shapes differ per target (SQLite unwraps its
 * sole namespace to the root; Postgres is schema-qualified).
 *
 * Keeps target-free contract/runtime features in the family layer while
 * letting adapters own target shape.
 */
export abstract class SqlMigration<
  TDetails extends SqlPlanTargetDetails,
  TTargetId extends string = string,
  Start extends Contract<SqlStorage> = Contract<SqlStorage>,
  End extends Contract<SqlStorage> = Contract<SqlStorage>,
> extends Migration<SqlMigrationPlanOperation<TDetails>, 'sql', TTargetId, Start, End> {
  /**
   * Sorted, deduplicated invariant ids declared by this migration's
   * data-transform ops. Derived from a fresh read of `this.operations` so the field remains
   * consistent with the operation list — planner-built plans (`db init`,
   * `db update`) yield `[]` because they emit no data-transform ops.
   *
   * Required by `SqlMigrationPlan.providedInvariants` (tightened from
   * optional at the SQL-family layer); the framework-level
   * `MigrationPlan.providedInvariants?` stays optional.
   */
  get providedInvariants(): readonly string[] {
    this.resetAuthoringState();
    const ops = this.operations.filter(
      (op): op is SqlMigrationPlanOperation<TDetails> => !isThenable(op),
    );
    return deriveProvidedInvariants(ops);
  }
}
