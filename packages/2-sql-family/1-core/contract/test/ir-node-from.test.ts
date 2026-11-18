import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { parseNaming } from '@internal/sql-schema-ir/naming';
import { describe, expect, it } from 'vitest';
import { ForeignKey } from '../src/ir/foreign-key';
import { ForeignKeyReference } from '../src/ir/foreign-key-reference';
import { PrimaryKey } from '../src/ir/primary-key';
import { Index, type IndexInput } from '../src/ir/sql-index';
import { StorageColumn } from '../src/ir/storage-column';
import { StorageTable } from '../src/ir/storage-table';
import { UniqueConstraint } from '../src/ir/unique-constraint';

const columnInput = { codecId: 'pg/int4@1', dataType: 'pg/int4', nullable: false } as const;
const referenceInput = {
  namespaceId: UNBOUND_NAMESPACE_ID,
  tableName: 'user',
  columns: ['id'],
} as const;
const foreignKeyInput = {
  source: { namespaceId: UNBOUND_NAMESPACE_ID, tableName: 'post', columns: ['author_id'] },
  target: referenceInput,
} as const;
const indexInput: IndexInput = {
  naming: parseNaming('users_email_idx_ab12cd34', 'users_email_idx'),
  columns: ['email'],
  where: undefined,
  unique: false,
  type: undefined,
  options: undefined,
};

// Each factory has two paths. Building from raw input is what the constructors
// always did; returning an existing instance untouched is the property that
// would silently disappear if `from` were "simplified" to always construct,
// so both are pinned per class.
describe('IR node from() factories', () => {
  it('StorageColumn builds from input and passes an instance through', () => {
    const built = StorageColumn.from(columnInput);
    expect(built).toBeInstanceOf(StorageColumn);
    expect(Object.isFrozen(built)).toBe(true);
    expect(StorageColumn.from(built)).toBe(built);
  });

  it('PrimaryKey builds from input and passes an instance through', () => {
    const built = PrimaryKey.from({ columns: ['id'] });
    expect(built).toBeInstanceOf(PrimaryKey);
    expect(Object.isFrozen(built)).toBe(true);
    expect(PrimaryKey.from(built)).toBe(built);
  });

  it('UniqueConstraint builds from input and passes an instance through', () => {
    const built = UniqueConstraint.from({ columns: ['email'] });
    expect(built).toBeInstanceOf(UniqueConstraint);
    expect(Object.isFrozen(built)).toBe(true);
    expect(UniqueConstraint.from(built)).toBe(built);
  });

  it('Index builds from input and passes an instance through', () => {
    const built = Index.from(indexInput);
    expect(built).toBeInstanceOf(Index);
    expect(Object.isFrozen(built)).toBe(true);
    expect(Index.from(built)).toBe(built);
  });

  it('ForeignKeyReference builds from input and passes an instance through', () => {
    const built = ForeignKeyReference.from(referenceInput);
    expect(built).toBeInstanceOf(ForeignKeyReference);
    expect(Object.isFrozen(built)).toBe(true);
    expect(ForeignKeyReference.from(built)).toBe(built);
  });

  it('ForeignKey builds from input, normalizes its references, and passes an instance through', () => {
    const built = ForeignKey.from(foreignKeyInput);
    expect(built).toBeInstanceOf(ForeignKey);
    expect(built.source).toBeInstanceOf(ForeignKeyReference);
    expect(built.target).toBeInstanceOf(ForeignKeyReference);
    expect(ForeignKey.from(built)).toBe(built);
  });

  it('StorageTable hydrates raw inputs and carries instances over untouched', () => {
    const raw = new StorageTable({
      columns: { id: columnInput },
      primaryKey: { columns: ['id'] },
      uniques: [{ columns: ['email'] }],
      indexes: [indexInput],
      foreignKeys: [foreignKeyInput],
    });

    expect(raw.columns['id']).toBeInstanceOf(StorageColumn);
    expect(raw.primaryKey).toBeInstanceOf(PrimaryKey);
    expect(raw.uniques[0]).toBeInstanceOf(UniqueConstraint);
    expect(raw.indexes[0]).toBeInstanceOf(Index);
    expect(raw.foreignKeys[0]).toBeInstanceOf(ForeignKey);

    const carriedPrimaryKey = raw.primaryKey;
    if (carriedPrimaryKey === undefined) throw new Error('expected a primary key');
    const rehydrated = new StorageTable({
      columns: raw.columns,
      primaryKey: carriedPrimaryKey,
      uniques: raw.uniques,
      indexes: raw.indexes,
      foreignKeys: raw.foreignKeys,
    });

    expect(rehydrated.columns['id']).toBe(raw.columns['id']);
    expect(rehydrated.primaryKey).toBe(raw.primaryKey);
    expect(rehydrated.uniques[0]).toBe(raw.uniques[0]);
    expect(rehydrated.indexes[0]).toBe(raw.indexes[0]);
    expect(rehydrated.foreignKeys[0]).toBe(raw.foreignKeys[0]);
  });
});
