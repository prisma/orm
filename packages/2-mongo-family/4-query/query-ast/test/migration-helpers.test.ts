import { describe, expect, it } from 'vitest';
import { ListCollectionsCommand, ListIndexesCommand } from '../src/inspection-commands';
import { buildIndexOpId, keysToKeySpec } from '../src/migration-helpers';
import {
  isInspectionCheckSource,
  isMongoDmlOperation,
  type MongoMigrationCheckSource,
} from '../src/migration-operation-types';
import { RawAggregateCommand } from '../src/raw-commands';

describe('buildIndexOpId', () => {
  it('names the collection, the verb and the index name', () => {
    expect({
      create: buildIndexOpId('create', 'users', 'email_1'),
      drop: buildIndexOpId('drop', 'users', 'User_email_key'),
    }).toEqual({
      create: 'index.users.create(email_1)',
      drop: 'index.users.drop(User_email_key)',
    });
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
  it("tells a catalog inspection from a read of documents by the inspection command's kind", () => {
    const documents = {
      collection: 'users',
      command: new RawAggregateCommand('users', [{ $limit: 1 }]),
      meta: { target: 'mongo', storageHash: '', lane: 'mongo-raw' },
    };
    const inspectionWithACommandField = {
      kind: 'listIndexes',
      collection: 'users',
      command: 'listIndexes',
      accept: () => [],
    } as unknown as MongoMigrationCheckSource;
    expect([
      isInspectionCheckSource(new ListCollectionsCommand()),
      isInspectionCheckSource(new ListIndexesCommand('users')),
      isInspectionCheckSource(inspectionWithACommandField),
      isInspectionCheckSource(documents),
    ]).toEqual([true, true, true, false]);
  });
});
