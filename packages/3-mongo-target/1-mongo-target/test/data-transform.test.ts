import { CliStructuredError } from '@internal/errors/control';
import { placeholder } from '@internal/errors/migration';
import type {
  AnyMongoMigrationOperation,
  MongoDataTransformOperation,
} from '@internal/mongo-query-ast/control';
import {
  AggregateCommand,
  type MongoExistsExpr,
  MongoFieldFilter,
  MongoLimitStage,
  MongoMatchStage,
  type MongoQueryPlan,
  RawUpdateManyCommand,
} from '@internal/mongo-query-ast/execution';
import { describe, expect, it } from 'vitest';
import { dataTransform } from '../src/core/migrations/migration-factories';
import {
  deserializeMongoOps,
  serializeMongoOps,
} from '../src/core/migrations/mongo-ops-serializer';

function asDataTransformOp(op: AnyMongoMigrationOperation): MongoDataTransformOperation {
  if (op.operationClass !== 'data') {
    throw new Error('Expected data transform operation');
  }
  return op as MongoDataTransformOperation;
}

function makePlanMeta() {
  return {
    target: 'mongo' as const,
    storageHash: 'test',
    lane: 'mongo-raw',
  };
}

function makeCheckPlan(): MongoQueryPlan {
  return {
    collection: 'users',
    command: new AggregateCommand('users', [
      new MongoMatchStage(MongoFieldFilter.eq('status', null)),
      new MongoLimitStage(1),
    ]),
    meta: { ...makePlanMeta(), lane: 'mongo-pipeline' },
  };
}

function makeRunPlan(): MongoQueryPlan {
  return {
    collection: 'users',
    command: new RawUpdateManyCommand(
      'users',
      { status: { $exists: false } },
      { $set: { status: 'active' } },
    ),
    meta: makePlanMeta(),
  };
}

describe('dataTransform', () => {
  it('produces correct operation structure with check', () => {
    const op = dataTransform('backfill-status', {
      check: {
        source: () => makeCheckPlan(),
      },
      run: () => makeRunPlan(),
    });

    expect(op.id).toBe('data_transform.backfill-status');
    expect(op.label).toBe('Data transform: backfill-status');
    expect(op.operationClass).toBe('data');
    expect(op.name).toBe('backfill-status');
    expect(op.precheck).toHaveLength(1);
    expect(op.postcheck).toHaveLength(1);
  });

  it('populates precheck and postcheck from check config', () => {
    const op = dataTransform('test', {
      check: {
        source: () => makeCheckPlan(),
        expect: 'exists',
        description: 'custom description',
      },
      run: () => makeRunPlan(),
    });

    expect(op.precheck).toHaveLength(1);
    expect(op.precheck[0]!.description).toBe('custom description');
    expect(op.precheck[0]!.expect).toBe('exists');
    expect(op.precheck[0]!.source.command.kind).toBe('aggregate');

    expect(op.postcheck).toHaveLength(1);
    expect(op.postcheck[0]!.description).toBe('custom description');
    expect(op.postcheck[0]!.expect).toBe('notExists');
  });

  it('defaults precheck expect to exists and inverts for postcheck', () => {
    const op = dataTransform('test', {
      check: { source: () => makeCheckPlan() },
      run: () => makeRunPlan(),
    });

    expect(op.precheck[0]!.expect).toBe('exists');
    expect(op.postcheck[0]!.expect).toBe('notExists');
  });

  it('defaults filter to match-all (MongoExistsExpr _id)', () => {
    const op = dataTransform('test', {
      check: { source: () => makeCheckPlan() },
      run: () => makeRunPlan(),
    });

    const filter = op.precheck[0]!.filter;
    expect(filter.kind).toBe('exists');
    const existsFilter = filter as MongoExistsExpr;
    expect(existsFilter.field).toBe('_id');
    expect(existsFilter.exists).toBe(true);
  });

  it('accepts custom filter', () => {
    const customFilter = MongoFieldFilter.eq('status', 'active');
    const op = dataTransform('test', {
      check: {
        source: () => makeCheckPlan(),
        filter: customFilter,
      },
      run: () => makeRunPlan(),
    });

    expect(op.precheck[0]!.filter.kind).toBe('field');
  });

  it('auto-generates description when omitted', () => {
    const op = dataTransform('backfill-status', {
      check: { source: () => makeCheckPlan() },
      run: () => makeRunPlan(),
    });

    expect(op.precheck[0]!.description).toBe('Check for data transform: backfill-status');
  });

  it('produces empty precheck/postcheck when check is omitted', () => {
    const op = dataTransform('seed-defaults', {
      run: () => makeRunPlan(),
    });

    expect(op.precheck).toHaveLength(0);
    expect(op.postcheck).toHaveLength(0);
  });

  it('forwards invariantId onto the op when supplied', () => {
    const op = dataTransform('backfill-status', {
      invariantId: 'backfill-user-status',
      run: () => makeRunPlan(),
    });

    expect(op.invariantId).toBe('backfill-user-status');
  });

  it('omits invariantId when not supplied', () => {
    const op = dataTransform('seed-defaults', {
      run: () => makeRunPlan(),
    });

    expect(op).not.toHaveProperty('invariantId');
  });

  it('resolves check source closure and calls .build() on Buildable', () => {
    const buildable = { build: () => makeCheckPlan() };
    const op = dataTransform('test', {
      check: { source: () => buildable },
      run: () => makeRunPlan(),
    });

    expect(op.precheck[0]!.source.command.kind).toBe('aggregate');
  });

  it('resolves run closure and calls .build() on Buildable', () => {
    const buildable = { build: () => makeRunPlan() };
    const op = dataTransform('test', {
      run: () => buildable,
    });

    expect(op.run).toHaveLength(1);
    expect(op.run[0]!.command.kind).toBe('rawUpdateMany');
  });

  it('propagates placeholder() errors from check.source as structured CliStructuredError (MIGRATION.UNFILLED_PLACEHOLDER)', () => {
    let thrown: unknown;
    try {
      dataTransform('backfill-product-status', {
        check: {
          source: () => placeholder('backfill-product-status:check.source'),
        },
        run: () => makeRunPlan(),
      });
    } catch (error) {
      thrown = error;
    }

    expect(CliStructuredError.is(thrown)).toBe(true);
    expect(thrown).toMatchObject({
      code: 'MIGRATION.UNFILLED_PLACEHOLDER',
      meta: { slot: 'backfill-product-status:check.source' },
    });
  });

  it('propagates placeholder() errors from run as structured CliStructuredError (MIGRATION.UNFILLED_PLACEHOLDER)', () => {
    let thrown: unknown;
    try {
      dataTransform('backfill-product-status', {
        run: () => placeholder('backfill-product-status:run'),
      });
    } catch (error) {
      thrown = error;
    }

    expect(CliStructuredError.is(thrown)).toBe(true);
    expect(thrown).toMatchObject({
      code: 'MIGRATION.UNFILLED_PLACEHOLDER',
      meta: { slot: 'backfill-product-status:run' },
    });
  });
});

describe('data transform serialization', () => {
  it('round-trips a data transform with check', () => {
    const op = dataTransform('backfill-status', {
      check: { source: () => makeCheckPlan() },
      run: () => makeRunPlan(),
    });

    const serialized = serializeMongoOps([op]);
    const deserialized = deserializeMongoOps(JSON.parse(serialized) as unknown[]);

    expect(deserialized).toHaveLength(1);
    const restored = asDataTransformOp(deserialized[0]!);
    expect(restored.id).toBe('data_transform.backfill-status');
    expect(restored.operationClass).toBe('data');
    expect(restored.name).toBe('backfill-status');
    expect(restored.precheck).toHaveLength(1);
    expect(restored.postcheck).toHaveLength(1);
    expect(restored.precheck[0]!.expect).toBe('exists');
    expect(restored.postcheck[0]!.expect).toBe('notExists');
    expect(restored.precheck[0]!.source.command.kind).toBe('aggregate');
  });

  it('round-trips empty precheck/postcheck (no check)', () => {
    const op = dataTransform('always-run', {
      run: () => makeRunPlan(),
    });

    const serialized = serializeMongoOps([op]);
    const deserialized = deserializeMongoOps(JSON.parse(serialized) as unknown[]);
    const restored = asDataTransformOp(deserialized[0]!);
    expect(restored.precheck).toHaveLength(0);
    expect(restored.postcheck).toHaveLength(0);
  });

  it('round-trips check filter', () => {
    const op = dataTransform('test', {
      check: {
        source: () => makeCheckPlan(),
        filter: MongoFieldFilter.eq('migrated', false),
        expect: 'notExists',
      },
      run: () => makeRunPlan(),
    });

    const serialized = serializeMongoOps([op]);
    const deserialized = deserializeMongoOps(JSON.parse(serialized) as unknown[]);
    const restored = asDataTransformOp(deserialized[0]!);
    expect(restored.precheck[0]!.filter.kind).toBe('field');
    expect(restored.precheck[0]!.expect).toBe('notExists');
  });

  it('round-trips run as MongoQueryPlan array', () => {
    const op = dataTransform('test', {
      run: () => makeRunPlan(),
    });

    const serialized = serializeMongoOps([op]);
    const deserialized = deserializeMongoOps(JSON.parse(serialized) as unknown[]);
    const restored = asDataTransformOp(deserialized[0]!);
    expect(restored.run).toHaveLength(1);
    expect(restored.run[0]!.command.kind).toBe('rawUpdateMany');
  });

  it('round-trips mixed DDL and data transform operations', () => {
    const ddlOp = {
      id: 'collection.users.create',
      label: 'Create collection users',
      operationClass: 'additive' as const,
      precheck: [],
      execute: [],
      postcheck: [],
    };
    const dtOp = dataTransform('backfill', {
      run: () => makeRunPlan(),
    });

    const serialized = serializeMongoOps([ddlOp, dtOp]);
    const deserialized = deserializeMongoOps(JSON.parse(serialized) as unknown[]);

    expect(deserialized).toHaveLength(2);
    expect(deserialized[0]!.operationClass).toBe('additive');
    expect(deserialized[1]!.operationClass).toBe('data');
  });
});
