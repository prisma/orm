import { Migration, MigrationContractViews } from '@internal/migration-tools/migration';
import type { MongoContract } from '@internal/mongo-contract';
import type { AnyMongoMigrationOperation } from '@internal/mongo-query-ast/control';
import { MongoContractView } from './ir/mongo-contract-view';

/**
 * Family-owned base class for Mongo migrations.
 *
 * Provides the fixed `targetId = 'mongo'` so that user-authored migrations
 * and renderer-generated scaffolds (e.g. the output of
 * `renderCallsToTypeScript`) inherit it directly and don't have to re-declare
 * the abstract `targetId` member from `Migration`.
 *
 * The operation type parameter is `AnyMongoMigrationOperation` — the union
 * of DDL-shaped `MongoMigrationPlanOperation` and `MongoDmlOperation` —
 * so subclasses can return a mix of schema operations (e.g. `createIndex`,
 * `setValidation`) and DML operations (e.g. `dataTransform`, `renameField`).
 * Mirrors the generic parameter used by `PlannerProducedMongoMigration`.
 *
 * Binds the framework base's `Start` / `End` contract generics so a subclass
 * that assigns its snapshot-store `contract.json` imports to
 * `startContractJson` / `endContractJson` gets fully-typed view accessors:
 * `this.endContract` is a `MongoContractView<End>`
 * (and `this.startContract` a `MongoContractView<Start> | null`), built lazily
 * from those JSON fields via the shared `MigrationContractViews` helper. The
 * framework base derives `describe()` from the same JSON. View getters live on
 * the family base (not the framework base) because `MongoContractView`'s shape
 * is Mongo-specific.
 */
export abstract class MongoMigration<
  Start extends MongoContract = MongoContract,
  End extends MongoContract = MongoContract,
> extends Migration<AnyMongoMigrationOperation, string, string, Start, End> {
  readonly targetId = 'mongo' as const;

  #endView = new MigrationContractViews<MongoContractView<End>>(this, 'MongoMigration', (json) =>
    MongoContractView.fromJson<End>(json),
  );
  #startView = new MigrationContractViews<MongoContractView<Start>>(
    this,
    'MongoMigration',
    (json) => MongoContractView.fromJson<Start>(json),
  );

  /**
   * The typed, namespace-unwrapped view over this migration's end-state
   * contract — `this.endContract.collection.<name>.validator`, etc. Throws if
   * no `endContractJson` was provided (a `describe()`-overriding migration
   * with no contract has no view to expose).
   */
  get endContract(): MongoContractView<End> {
    return this.#endView.endContract;
  }

  /**
   * The typed view over this migration's start-state contract, or `null` for
   * a baseline migration (no `startContractJson`).
   */
  get startContract(): MongoContractView<Start> | null {
    return this.#startView.startContract;
  }
}
