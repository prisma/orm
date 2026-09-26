import type { Collection } from '@internal/sql-orm-client';
import type { Char } from '@internal/target-postgres/codec-types';
import { describe, expectTypeOf, test } from 'vitest';
import type { Contract } from './fixtures/generated/contract';

declare const tags: Collection<Contract, 'Tag'>;

const id = '123e4567-e89b-12d3-a456-426614174000';

describe('ORM writes take the codec input type', () => {
  test('create and createAll accept a plain string for a char column', async () => {
    await tags.create({ id, name: 'rust' });
    await tags.createAll([{ id, name: 'rust' }]);
  });

  test('upsert accepts a plain string for a char column', async () => {
    await tags.upsert({
      create: { id, name: 'rust' },
      update: { id },
      conflictOn: { name: 'rust' },
    });
  });

  test('update, updateAll and updateAndCount accept a plain string for a char column', async () => {
    const filtered = tags.where({ name: 'rust' });
    await filtered.update({ id });
    await filtered.updateAll({ id });
    expectTypeOf(filtered.updateAndCount({ id })).resolves.toEqualTypeOf<number>();
  });

  test('reads keep the refined output type', () => {
    const rows = tags.select('id').all();
    type Row = Awaited<typeof rows>[number];
    expectTypeOf<Row['id']>().toEqualTypeOf<Char<36>>();
  });
});
