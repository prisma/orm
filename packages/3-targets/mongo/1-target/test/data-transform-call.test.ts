import { CliStructuredError } from '@internal/errors/control';
import { RawAggregateCommand, RawUpdateManyCommand } from '@internal/mongo-query-ast/execution';
import { describe, expect, it } from 'vitest';
import {
  dataTransform,
  rawAggregate,
  rawUpdateMany,
} from '../src/core/migrations/migration-factories';
import { DataTransformCall, UnsetFieldCall } from '../src/core/migrations/op-factory-call';
import { PlannerProducedMongoMigration } from '../src/core/migrations/planner-produced-migration';

const RAW_META = { target: 'mongo', storageHash: '', lane: 'mongo-raw' };
const AGE_NOT_INT = { age: { $ne: null, $not: { $type: ['int'] } } };

describe('rawAggregate and rawUpdateMany', () => {
  it('build the raw query plans a migration.ts writes', () => {
    expect([
      rawAggregate('users', [{ $match: AGE_NOT_INT }, { $limit: 1 }]),
      rawUpdateMany('users', AGE_NOT_INT, [{ $set: { age: { $toInt: '$age' } } }], {
        bypassDocumentValidation: true,
      }),
    ]).toEqual([
      {
        collection: 'users',
        command: new RawAggregateCommand('users', [{ $match: AGE_NOT_INT }, { $limit: 1 }]),
        meta: RAW_META,
      },
      {
        collection: 'users',
        command: new RawUpdateManyCommand(
          'users',
          AGE_NOT_INT,
          [{ $set: { age: { $toInt: '$age' } } }],
          { bypassDocumentValidation: true },
        ),
        meta: RAW_META,
      },
    ]);
  });
});

describe('DataTransformCall', () => {
  const call = new DataTransformCall('User.age', 'users', AGE_NOT_INT);

  it('renders a data transform whose check and filter the planner wrote, and whose update is a placeholder', () => {
    expect(call.renderTypeScript()).toBe(
      [
        'dataTransform("User.age", {',
        '  check: { source: () => rawAggregate("users", [{ $match: { age: { $ne: null, $not: { $type: ["int"] } } } }, { $limit: 1 }]) },',
        '  run: () => rawUpdateMany("users", { age: { $ne: null, $not: { $type: ["int"] } } }, placeholder("User.age:update"), { bypassDocumentValidation: true }),',
        '})',
      ].join('\n'),
    );
    expect(call.importRequirements().map(({ symbol }) => symbol)).toEqual([
      'dataTransform',
      'rawAggregate',
      'rawUpdateMany',
      'placeholder',
    ]);
  });

  it('is a data operation whose unfilled slot names the operation it stands for', async () => {
    expect({ operationClass: call.operationClass, label: call.label }).toEqual({
      operationClass: 'data',
      label: 'Data transform: User.age',
    });
    const rejection = await Promise.resolve(call.toOp()).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(CliStructuredError.is(rejection) ? rejection.meta : rejection).toEqual({
      slot: 'User.age:update',
      operation: {
        id: 'data_transform.User.age',
        label: 'Data transform: User.age',
        operationClass: 'data',
      },
    });
  });

  it('leaves the other operations of the plan readable', async () => {
    const migration = new PlannerProducedMongoMigration(
      [call, new UnsetFieldCall('users', 'nickname')],
      { from: null, to: 'b'.repeat(64) },
      '../../snapshots',
    );

    const settled = await Promise.allSettled(migration.operations);

    expect(settled.map((entry) => entry.status)).toEqual(['rejected', 'fulfilled']);
  });

  it('is what the filled migration.ts writes, once the update is filled in', () => {
    const update = [{ $set: { age: { $toInt: '$age' } } }];
    const op = dataTransform('User.age', {
      check: { source: () => rawAggregate('users', [{ $match: AGE_NOT_INT }, { $limit: 1 }]) },
      run: () => rawUpdateMany('users', AGE_NOT_INT, update, { bypassDocumentValidation: true }),
    });

    expect(op).toMatchObject({
      id: 'data_transform.User.age',
      label: 'Data transform: User.age',
      operationClass: 'data',
      precheck: [{ expect: 'exists' }],
      postcheck: [{ expect: 'notExists' }],
      run: [{ command: { filter: AGE_NOT_INT, update, bypassDocumentValidation: true } }],
    });
  });
});
