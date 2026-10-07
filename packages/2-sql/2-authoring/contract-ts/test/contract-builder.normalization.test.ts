import type { FamilyPackRef, TargetPackRef } from '@internal/framework-components/components';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { testTypeLookups } from '../../../1-core/contract/test/test-type-lookups';
import { defineContract, field, model } from '../src/contract-builder';
import { modelsOf } from './contract-test-helpers';
import { columnDescriptor } from './helpers/column-descriptor';
import { testIndexPack } from './helpers/test-index-pack';
import { unboundTables } from './unbound-tables';

const int4Column = columnDescriptor('pg/int4@1');
const textColumn = columnDescriptor('pg/text@1');

const bareFamilyPack: FamilyPackRef<'sql'> = {
  kind: 'family',
  id: 'sql',
  familyId: 'sql',
  version: '0.0.1',
};

const postgresTargetPack: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
};

describe('contract builder normalization', () => {
  it('normalizes nullable to false when not provided', () => {
    const contract = defineContract({
      ...testTypeLookups,
      family: bareFamilyPack,
      target: postgresTargetPack,
      createNamespace: createTestSqlNamespace,
      models: {
        User: model('User', {
          fields: {
            id: field.column(int4Column).id(),
          },
        }).sql({ table: 'user' }),
      },
    });

    expect(unboundTables(contract.storage)['user']!.columns['id']!.nullable).toBe(false);
  });

  it('normalizes nullable to provided value', () => {
    const contract = defineContract({
      ...testTypeLookups,
      family: bareFamilyPack,
      target: postgresTargetPack,
      createNamespace: createTestSqlNamespace,
      models: {
        User: model('User', {
          fields: {
            id: field.column(int4Column),
            email: field.column(textColumn).optional(),
          },
        }).sql({ table: 'user' }),
      },
    });

    expect(unboundTables(contract.storage)['user']!.columns['id']!.nullable).toBe(false);
    expect(unboundTables(contract.storage)['user']!.columns['email']!.nullable).toBe(true);
  });

  it('normalizes uniques to empty array when not provided', () => {
    const contract = defineContract({
      ...testTypeLookups,
      family: bareFamilyPack,
      target: postgresTargetPack,
      createNamespace: createTestSqlNamespace,
      models: {
        User: model('User', {
          fields: {
            id: field.column(int4Column).id(),
          },
        }).sql({ table: 'user' }),
      },
    });

    expect(unboundTables(contract.storage)['user']!.uniques).toEqual([]);
    expect(Array.isArray(unboundTables(contract.storage)['user']!.uniques)).toBe(true);
  });

  it('normalizes indexes to empty array when not provided', () => {
    const contract = defineContract({
      ...testTypeLookups,
      family: bareFamilyPack,
      target: postgresTargetPack,
      createNamespace: createTestSqlNamespace,
      models: {
        User: model('User', {
          fields: {
            id: field.column(int4Column).id(),
          },
        }).sql({ table: 'user' }),
      },
    });

    expect(unboundTables(contract.storage)['user']!.indexes).toEqual([]);
    expect(Array.isArray(unboundTables(contract.storage)['user']!.indexes)).toBe(true);
  });

  it('normalizes foreignKeys to empty array when not provided', () => {
    const contract = defineContract({
      ...testTypeLookups,
      family: bareFamilyPack,
      target: postgresTargetPack,
      createNamespace: createTestSqlNamespace,
      models: {
        User: model('User', {
          fields: {
            id: field.column(int4Column).id(),
          },
        }).sql({ table: 'user' }),
      },
    });

    expect(unboundTables(contract.storage)['user']!.foreignKeys).toEqual([]);
    expect(Array.isArray(unboundTables(contract.storage)['user']!.foreignKeys)).toBe(true);
  });

  it('normalizes relations to empty object when not provided', () => {
    const contract = defineContract({
      ...testTypeLookups,
      family: bareFamilyPack,
      target: postgresTargetPack,
      createNamespace: createTestSqlNamespace,
      models: {
        User: model('User', {
          fields: {
            id: field.column(int4Column).id(),
          },
        }).sql({ table: 'user' }),
      },
    });

    const userModel = (
      modelsOf(contract) as Record<string, { relations?: Record<string, unknown> }>
    )['User']!;
    expect(userModel).toHaveProperty('relations');
    expect(userModel.relations).toEqual({});
    expect(typeof userModel.relations).toBe('object');
    expect(Array.isArray(userModel.relations)).toBe(false);
  });

  it('normalizes all required fields in a complete contract', () => {
    const contract = defineContract({
      ...testTypeLookups,
      family: bareFamilyPack,
      target: postgresTargetPack,
      createNamespace: createTestSqlNamespace,
      models: {
        User: model('User', {
          fields: {
            id: field.column(int4Column).id(),
            email: field.column(textColumn),
          },
        }).sql({ table: 'user' }),
        Post: model('Post', {
          fields: {
            id: field.column(int4Column).id(),
            userId: field.column(int4Column),
          },
        }).sql({ table: 'post' }),
      },
    });

    // Verify all tables have normalized fields
    expect(unboundTables(contract.storage)['user']!.uniques).toEqual([]);
    expect(unboundTables(contract.storage)['user']!.indexes).toEqual([]);
    expect(unboundTables(contract.storage)['user']!.foreignKeys).toEqual([]);
    expect(unboundTables(contract.storage)['post']!.uniques).toEqual([]);
    expect(unboundTables(contract.storage)['post']!.indexes).toEqual([]);
    expect(unboundTables(contract.storage)['post']!.foreignKeys).toEqual([]);

    // Verify all models have normalized relations
    const userModel = (
      modelsOf(contract) as Record<string, { relations?: Record<string, unknown> }>
    )['User']!;
    const postModel = (
      modelsOf(contract) as Record<string, { relations?: Record<string, unknown> }>
    )['Post']!;
    expect(userModel.relations).toEqual({});
    expect(postModel.relations).toEqual({});

    // Verify nullable is normalized
    expect(unboundTables(contract.storage)['user']!.columns['id']!.nullable).toBe(false);
    expect(unboundTables(contract.storage)['user']!.columns['email']!.nullable).toBe(false);
  });

  it('passes type and options on indexes through to storage IR', () => {
    const contract = defineContract(
      {
        ...testTypeLookups,
        family: bareFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
        extensions: { testIndexes: testIndexPack },
      },
      ({ model, field }) => ({
        models: {
          Item: model('Item', {
            fields: {
              id: field.column(int4Column).id(),
              description: field.column(textColumn),
            },
          }).sql(({ cols, constraints }) => ({
            table: 'items',
            indexes: [
              constraints.index([cols.description], {
                name: 'search_idx',
                type: 'bm25',
                options: { key_field: 'id' },
              }),
            ],
          })),
        },
      }),
    );

    const indexes = unboundTables(contract.storage)['items']!.indexes;
    expect(indexes).toHaveLength(1);
    expect(indexes[0]).toEqual({
      name: 'search_idx_da5afa32',
      prefix: 'search_idx',
      columns: ['description'],
      unique: false,
      type: 'bm25',
      options: { key_field: 'id' },
    });
  });

  it('preserves plain indexes without extension config', () => {
    const contract = defineContract({
      ...testTypeLookups,
      family: bareFamilyPack,
      target: postgresTargetPack,
      createNamespace: createTestSqlNamespace,
      models: {
        User: model('User', {
          fields: {
            id: field.column(int4Column).id(),
            email: field.column(textColumn),
          },
        }).sql(({ cols, constraints }) => ({
          table: 'user',
          indexes: [constraints.index([cols.email])],
        })),
      },
    });

    const idx = unboundTables(contract.storage)['user']!.indexes[0]!;
    expect(idx.columns).toEqual(['email']);
    expect(idx).not.toHaveProperty('using');
    expect(idx).not.toHaveProperty('config');
  });
});
