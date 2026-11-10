import {
  ListCollectionsCommand,
  MongoFieldFilter,
  type MongoMigrationPlanOperation,
} from '@internal/mongo-query-ast/control';
import { describe, expect, it } from 'vitest';
import { createCollection } from '../src/core/migrations/migration-factories';
import {
  deserializeMongoOps,
  serializeMongoOps,
} from '../src/core/migrations/mongo-ops-serializer';

function writtenCheck(object: unknown) {
  const check = {
    description: 'collection orders does not exist',
    source: new ListCollectionsCommand(),
    filter: MongoFieldFilter.eq('name', 'orders'),
    expect: 'notExists',
  } as const;
  const op: MongoMigrationPlanOperation = {
    id: 'collection.orders.create',
    label: 'Create collection orders',
    operationClass: 'additive',
    precheck: [check],
    execute: [],
    postcheck: [],
  };
  const [json] = JSON.parse(serializeMongoOps([op])) as Record<string, unknown>[];
  const [checkJson] = (json?.['precheck'] ?? []) as Record<string, unknown>[];
  return object === undefined ? [json] : [{ ...json, precheck: [{ ...checkJson, object }] }];
}

function firstPrecheck(json: unknown[]) {
  const [op] = deserializeMongoOps(json) as MongoMigrationPlanOperation[];
  return op?.precheck[0];
}

describe('the object a Mongo check names', () => {
  it('survives a round trip through ops.json', () => {
    const [op] = deserializeMongoOps(
      JSON.parse(serializeMongoOps([createCollection('orders')])),
    ) as MongoMigrationPlanOperation[];

    expect(op?.precheck.map(({ description, object }) => ({ description, object }))).toEqual([
      { description: 'collection orders does not exist', object: 'collection "orders"' },
    ]);
  });

  it('is left out when ops.json written before it does not carry it', () => {
    expect(firstPrecheck(writtenCheck(undefined))).not.toHaveProperty('object');
  });

  it('refuses an ops.json whose check names its object with anything but a non-empty string', () => {
    expect(() => firstPrecheck(writtenCheck(''))).toThrow(
      expect.objectContaining({ code: 'MIGRATION.INVALID_OPERATION_ENTRY' }),
    );
    expect(() => firstPrecheck(writtenCheck(7))).toThrow(
      expect.objectContaining({ code: 'MIGRATION.INVALID_OPERATION_ENTRY' }),
    );
  });
});
