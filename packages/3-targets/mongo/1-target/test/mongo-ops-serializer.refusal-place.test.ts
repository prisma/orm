import { describe, expect, it } from 'vitest';
import { createIndex, fillField } from '../src/core/migrations/migration-factories';
import { deserializeMongoOps } from '../src/core/migrations/mongo-ops-serializer';

const index: Record<string, unknown> & { readonly id: string } = JSON.parse(
  JSON.stringify(createIndex('users', [{ field: 'email', direction: 1 }], { unique: true })),
);
const fill = JSON.parse(
  JSON.stringify(fillField({ collection: 'users', field: 'status', value: 'active' })),
);

function withUnknownIndexKey(op: Record<string, unknown>) {
  const copy = structuredClone(op) as {
    execute: [{ command: { keys: [Record<string, unknown>] } }];
  };
  copy.execute[0].command.keys[0]['zzz'] = 1;
  return copy;
}

const location = {
  space: 'app',
  migrations: [
    { dirName: '20260101T0000_first', operationCount: 1 },
    { dirName: '20260102T0000_second', operationCount: 1 },
  ],
};

describe('a refused Mongo operation names where it is', () => {
  it('names the migration, the operation and the path of the key from the operation', () => {
    expect(() => deserializeMongoOps([fill, withUnknownIndexKey(index)], location)).toThrow(
      expect.objectContaining({
        code: 'MIGRATION.INVALID_OPERATION_ENTRY',
        why: `Operation 0 ("${index.id}") of migration "20260102T0000_second" in space "app" is not in a format this release of Prisma reads: at execute[0].command: Invalid createIndex command: keys[0].zzz must be removed.`,
        fix: expect.stringContaining('restore it from version control'),
        meta: expect.objectContaining({
          index: 0,
          operationId: index.id,
          migration: '20260102T0000_second',
          space: 'app',
          path: 'execute[0].command',
        }),
      }),
    );
  });

  it('counts operations from the start of the list when it is given no migrations', () => {
    expect(() => deserializeMongoOps([fill, withUnknownIndexKey(index)])).toThrow(
      expect.objectContaining({
        why: expect.stringMatching(/^Operation 1 \(".*"\) is not in a format/),
      }),
    );
  });
});
