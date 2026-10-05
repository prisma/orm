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
import type { Contract as End } from '../../snapshots/9af6d90aaa4cd03bf7eb2040a1c1b5c1225a2b33883ea3d0552f312f4684f8dc/contract';
import endContract from '../../snapshots/9af6d90aaa4cd03bf7eb2040a1c1b5c1225a2b33883ea3d0552f312f4684f8dc/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/977a060afe52c4a56f93f2f33d65b8b6b4cc4ded04d16fe6b4f8e7e9e61192d3/contract';
import startContract from '../../snapshots/977a060afe52c4a56f93f2f33d65b8b6b4cc4ded04d16fe6b4f8e7e9e61192d3/contract.json' with {
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
