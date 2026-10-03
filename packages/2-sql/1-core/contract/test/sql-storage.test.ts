import { coreHash } from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import {
  isMaterializedSqlNamespace,
  isSqlAuthoringContributions,
  SqlStorage,
  type SqlStorageTypeEntry,
} from '../src/ir/sql-storage';
import { StorageTable } from '../src/ir/storage-table';
import { createTestSqlNamespace } from './test-support';

/**
 * Pins the strict-deserialization contract for the polymorphic
 * `SqlStorage.types` slot (TML-2536). The constructor previously had a
 * silent fallthrough that stamped `kind: 'codec-instance'` on untagged
 * codec-triple inputs; the strict form rejects every entry that doesn't
 * match a known discriminator so format drift surfaces loudly at the
 * deserializer boundary instead of corrupting downstream IR walks.
 */
describe('SqlStorage — polymorphic storage.types normalisation', () => {
  const baseTable = new StorageTable({
    columns: {
      id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
    },
    primaryKey: { columns: ['id'] },
    uniques: [],
    indexes: [],
    foreignKeys: [],
  });

  const unboundWithUsers = createTestSqlNamespace({
    id: UNBOUND_NAMESPACE_ID,
    entries: { table: { users: baseTable } },
  });

  it('accepts a tagged codec-instance entry unchanged', () => {
    const storage = new SqlStorage({
      storageHash: coreHash('abc'),
      namespaces: { [UNBOUND_NAMESPACE_ID]: unboundWithUsers },
      types: {
        Score: {
          kind: 'codec-instance',
          codecId: 'pg/int4@1',
          nativeType: 'int4',
          typeParams: {},
        },
      },
    });
    expect(storage.types?.['Score']).toEqual({
      kind: 'codec-instance',
      codecId: 'pg/int4@1',
      nativeType: 'int4',
      typeParams: {},
    });
  });

  it('stamps the discriminator on an untagged codec triple authored via toStorageTypeInstance input', async () => {
    const { toStorageTypeInstance } = await import('../src/ir/storage-type-instance');
    const storage = new SqlStorage({
      storageHash: coreHash('abc'),
      namespaces: { [UNBOUND_NAMESPACE_ID]: unboundWithUsers },
      types: {
        Score: toStorageTypeInstance({
          codecId: 'pg/int4@1',
          nativeType: 'int4',
          typeParams: {},
        }),
      },
    });
    expect(storage.types?.['Score']).toMatchObject({ kind: 'codec-instance' });
  });

  it('throws on a raw untagged codec triple (no discriminator)', () => {
    const untagged = {
      codecId: 'pg/vector@1',
      nativeType: 'vector(1536)',
      typeParams: { dimensions: 1536 },
    } as unknown as SqlStorageTypeEntry;
    expect(
      () =>
        new SqlStorage({
          storageHash: coreHash('abc'),
          namespaces: { [UNBOUND_NAMESPACE_ID]: unboundWithUsers },
          types: { Embedding1536: untagged },
        }),
    ).toThrow(/Embedding1536/);
  });

  it('mentions the missing-`kind` diagnostic when the discriminator is absent', () => {
    const untagged = {
      codecId: 'pg/int4@1',
      nativeType: 'int4',
      typeParams: {},
    } as unknown as SqlStorageTypeEntry;
    expect(
      () =>
        new SqlStorage({
          storageHash: coreHash('abc'),
          namespaces: { [UNBOUND_NAMESPACE_ID]: unboundWithUsers },
          types: { Score: untagged },
        }),
    ).toThrow(/missing.*kind/i);
  });

  it('throws on an entry with an unknown `kind` discriminator', () => {
    const unknownKind = {
      kind: 'mystery-kind',
      whatever: true,
    } as unknown as SqlStorageTypeEntry;
    expect(
      () =>
        new SqlStorage({
          storageHash: coreHash('abc'),
          namespaces: { [UNBOUND_NAMESPACE_ID]: unboundWithUsers },
          types: { Mystery: unknownKind },
        }),
    ).toThrow(/Mystery.*mystery-kind/);
  });

  it('normalises a tagged codec-instance that omits typeParams to typeParams: {}', () => {
    const onDiskShape = {
      kind: 'codec-instance',
      codecId: 'pg/int4@1',
      nativeType: 'int4',
      // typeParams omitted — the on-disk canonical form strips empty typeParams
    } as unknown as SqlStorageTypeEntry;
    const storage = new SqlStorage({
      storageHash: coreHash('abc'),
      namespaces: { [UNBOUND_NAMESPACE_ID]: unboundWithUsers },
      types: { Score: onDiskShape },
    });
    expect(storage.types?.['Score']?.typeParams).toEqual({});
  });

  it('rejects a raw postgres-enum JSON envelope when no serializer hydrated it (pre-existing strict path)', () => {
    const rawPostgresEnum = {
      kind: 'postgres-enum',
      name: 'user_type',
      nativeType: 'user_type',
      values: ['admin', 'user'],
      codecId: 'app/test-enum@1',
    } as unknown as SqlStorageTypeEntry;
    expect(
      () =>
        new SqlStorage({
          storageHash: coreHash('abc'),
          namespaces: { [UNBOUND_NAMESPACE_ID]: unboundWithUsers },
          types: { user_type: rawPostgresEnum },
        }),
    ).toThrow(/postgres-enum/);
  });
});

describe('isSqlAuthoringContributions', () => {
  it('returns false when authoring is undefined', () => {
    expect(isSqlAuthoringContributions(undefined)).toBe(false);
  });

  it('returns false when authoring lacks a createNamespace property', () => {
    expect(isSqlAuthoringContributions({} as never)).toBe(false);
  });

  it('returns false when createNamespace is present but not a function', () => {
    expect(isSqlAuthoringContributions({ createNamespace: 'not-a-function' } as never)).toBe(false);
  });

  it('returns true when createNamespace is a function', () => {
    const authoring = { createNamespace: () => ({}) as never };
    expect(isSqlAuthoringContributions(authoring as never)).toBe(true);
  });
});

describe('isMaterializedSqlNamespace', () => {
  it('returns false for null', () => {
    expect(isMaterializedSqlNamespace(null)).toBe(false);
  });

  it('returns false for a non-object primitive', () => {
    expect(isMaterializedSqlNamespace('not-an-object')).toBe(false);
  });

  it('returns false when qualifyTable is missing', () => {
    expect(isMaterializedSqlNamespace({ id: 'ns' })).toBe(false);
  });

  it('returns false when qualifyTable is present but not a function', () => {
    expect(isMaterializedSqlNamespace({ qualifyTable: 'nope' })).toBe(false);
  });

  it('returns true when qualifyTable is a function', () => {
    expect(isMaterializedSqlNamespace({ qualifyTable: () => 'x' })).toBe(true);
  });
});
