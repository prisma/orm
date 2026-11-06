import { describe, expect, it } from 'vitest';
import { ListCollectionsCommand, ListIndexesCommand } from '../src/inspection-commands';
import { buildIndexOpId, defaultMongoIndexName, keysToKeySpec } from '../src/migration-helpers';
import {
  isInspectionCheckSource,
  isMongoDmlOperation,
  type MongoMigrationCheckSource,
} from '../src/migration-operation-types';
import { RawAggregateCommand } from '../src/raw-commands';

describe('buildIndexOpId', () => {
  it('produces deterministic create ID for single key', () => {
    expect(buildIndexOpId('create', 'users', [{ field: 'email', direction: 1 }])).toBe(
      'index.users.create(email:1)',
    );
  });

  it('produces deterministic drop ID for single key', () => {
    expect(buildIndexOpId('drop', 'users', [{ field: 'email', direction: 1 }])).toBe(
      'index.users.drop(email:1)',
    );
  });

  it('produces deterministic ID for compound key', () => {
    expect(
      buildIndexOpId('create', 'users', [
        { field: 'email', direction: 1 },
        { field: 'name', direction: -1 },
      ]),
    ).toBe('index.users.create(email:1,name:-1)');
  });

  it('includes text direction', () => {
    expect(buildIndexOpId('create', 'posts', [{ field: 'content', direction: 'text' }])).toBe(
      'index.posts.create(content:text)',
    );
  });
});

describe('defaultMongoIndexName', () => {
  it('matches MongoDB convention for single ascending key', () => {
    expect(defaultMongoIndexName([{ field: 'email', direction: 1 }])).toBe('email_1');
  });

  it('matches MongoDB convention for compound key', () => {
    expect(
      defaultMongoIndexName([
        { field: 'email', direction: 1 },
        { field: 'tenantId', direction: 1 },
      ]),
    ).toBe('email_1_tenantId_1');
  });

  it('includes descending direction', () => {
    expect(defaultMongoIndexName([{ field: 'createdAt', direction: -1 }])).toBe('createdAt_-1');
  });
});

describe('keysToKeySpec', () => {
  it('converts single key to spec object', () => {
    expect(keysToKeySpec([{ field: 'email', direction: 1 }])).toEqual({ email: 1 });
  });

  it('converts compound keys to spec object', () => {
    expect(
      keysToKeySpec([
        { field: 'email', direction: 1 },
        { field: 'name', direction: -1 },
      ]),
    ).toEqual({ email: 1, name: -1 });
  });

  it('preserves text direction as string', () => {
    expect(keysToKeySpec([{ field: 'content', direction: 'text' }])).toEqual({ content: 'text' });
  });
});

describe('isMongoDmlOperation', () => {
  it('tells an operation that runs queries from one that executes DDL, whatever its class', () => {
    const common = { id: 'op', label: 'op', precheck: [], postcheck: [] };
    expect([
      isMongoDmlOperation({ ...common, operationClass: 'widening', execute: [] }),
      isMongoDmlOperation({
        ...common,
        operationClass: 'widening',
        name: 'rewrite',
        run: [],
      }),
      isMongoDmlOperation({ ...common, operationClass: 'data', name: 'data', run: [] }),
    ]).toEqual([false, true, true]);
  });
});

describe('isInspectionCheckSource', () => {
  it('tells a catalog inspection from a read of documents', () => {
    const documents = {
      collection: 'users',
      command: new RawAggregateCommand('users', [{ $limit: 1 }]),
      meta: { target: 'mongo', storageHash: '', lane: 'mongo-raw' },
    };
    const anotherInspection = {
      kind: 'listSearchIndexes',
      collection: 'users',
      accept: () => [],
    } as unknown as MongoMigrationCheckSource;
    expect([
      isInspectionCheckSource(new ListCollectionsCommand()),
      isInspectionCheckSource(new ListIndexesCommand('users')),
      isInspectionCheckSource(anotherInspection),
      isInspectionCheckSource(documents),
    ]).toEqual([true, true, true, false]);
  });
});
