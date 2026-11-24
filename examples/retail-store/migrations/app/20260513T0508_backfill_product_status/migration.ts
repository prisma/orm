#!/usr/bin/env -S node
import {
  AggregateCommand,
  MongoExistsExpr,
  MongoLimitStage,
  MongoMatchStage,
  type MongoQueryPlan,
  RawUpdateManyCommand,
} from '@prisma/orm-mongo/query-ast/execution';
import {
  dataTransform,
  Migration,
  MigrationCLI,
  setValidation,
} from '@prisma/orm-mongo/target/migration';
import type { Contract as Start } from '../../snapshots/87af11776eb9e56ef9b74c7c16877e90a8a28e9013adfbdf3ff07d15e691326e/contract';
import startContract from '../../snapshots/87af11776eb9e56ef9b74c7c16877e90a8a28e9013adfbdf3ff07d15e691326e/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../../snapshots/f6146e922053633f815e208705396f57f232a93ac6a95e78b39ee7fb695d0d70/contract';
import endContract from '../../snapshots/f6146e922053633f815e208705396f57f232a93ac6a95e78b39ee7fb695d0d70/contract.json' with {
  type: 'json',
};

function existingProductsWithoutStatus(storageHash: string): MongoQueryPlan {
  return {
    collection: 'products',
    command: new AggregateCommand('products', [
      new MongoMatchStage(new MongoExistsExpr('status', false)),
      new MongoLimitStage(1),
    ]),
    meta: { target: 'mongo', storageHash, lane: 'mongo-pipeline' },
  };
}

function backfillRun(storageHash: string): MongoQueryPlan {
  return {
    collection: 'products',
    // Raw command form: the typed query-builder (`mongoQuery(...).updateMany(...)`)
    // produces the same logical plan but its JSON form is not yet handled by
    // the runner's ops deserializer (TML-2506), so hand-authored data
    // transforms use the raw command shape — matching the framework's
    // data-transform test fixtures.
    command: new RawUpdateManyCommand(
      'products',
      { status: { $exists: false } },
      { $set: { status: 'active' } },
    ),
    meta: { target: 'mongo', storageHash, lane: 'mongo-raw' },
  };
}

class BackfillProductStatus extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  // `migration new` records the contract delta as `from` → `to` but produces an
  // empty `operations` array; the author is responsible for declaring the work
  // that bridges the two contract states. This migration's contract delta adds
  // `embedding` and `status` fields to `products` (with `status` becoming
  // required via its `@default("active")`), so two ops are needed:
  //
  // 1. `setValidation` — refresh the live `$jsonSchema` so it includes the new
  //    fields. Without this, `db verify` would fail with `VALIDATOR_MISMATCH`
  //    after this migration applies because the live validator (still the
  //    state-1 shape from migration 1's `createCollection`) wouldn't match the
  //    contract-derived expected validator for state 3.
  //
  // 2. `dataTransform` — backfill `status: "active"` on pre-existing products
  //    so they satisfy the new `required: [..., "status", ...]` rule.
  //
  // The validator is sourced from the end-state contract view so the op stays
  // in sync with the contract if the chain is ever re-emitted.
  override get operations() {
    const storageHash = this.endContract.storage.storageHash;
    const productsValidator = this.endContract.collection.products.validator;
    return [
      setValidation('products', productsValidator.jsonSchema, {
        validationLevel: productsValidator.validationLevel,
        validationAction: productsValidator.validationAction,
      }),
      dataTransform('backfill-product-status', {
        check: { source: () => existingProductsWithoutStatus(storageHash) },
        run: () => backfillRun(storageHash),
      }),
    ];
  }
}

export default BackfillProductStatus;
MigrationCLI.run(import.meta.url, BackfillProductStatus);
