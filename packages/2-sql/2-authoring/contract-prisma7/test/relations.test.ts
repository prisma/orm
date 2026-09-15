import { describe, expect, it } from 'vitest';
import { loadFixtureTable } from './support';

describe('omitted referential actions', () => {
  const onDelete = async (tableName: string) =>
    (await loadFixtureTable('referential-action-defaults', tableName)).foreignKeys.map((fk) => ({
      onDelete: fk['onDelete'],
      onUpdate: fk['onUpdate'],
    }));

  it('restricts deletes when any foreign key field is required, as Prisma 7 does', async () => {
    expect(await onDelete('MixedChild')).toEqual([{ onDelete: 'restrict', onUpdate: 'cascade' }]);
  });

  it('sets null on delete only when every foreign key field is optional', async () => {
    expect(await onDelete('OptionalChild')).toEqual([{ onDelete: 'setNull', onUpdate: 'cascade' }]);
  });

  it('accepts an optional relation field over required fields, with the foreign key of a required relation', async () => {
    expect(await onDelete('Post')).toEqual([{ onDelete: 'restrict', onUpdate: 'cascade' }]);
  });
});
