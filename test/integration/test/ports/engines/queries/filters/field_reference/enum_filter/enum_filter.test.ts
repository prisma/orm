import type { AnyExpression } from '@internal/sql-relational-core/ast';
import { ColumnRef } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../../../_harness/postgres';
import type { Contract } from '../_fixture/enum/generated/contract';
import contractJson from '../_fixture/enum/generated/contract.json' with { type: 'json' };
import { referencedScalarInList } from '../postgres-list-field-reference';

const column = (name: string) => ColumnRef.of('testModel', name);

function withEnumFieldReference(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, async (ctx) => {
    await ctx.db.public.TestModel.createAndCount([
      { id: 1, enum: 'a', enum2: ['a', 'b'] },
      { id: 2, enum: 'b', enum2: ['a', 'c'] },
      { id: 3, enum2: [] },
    ]);
    await fn(ctx);
  });
}

describe('ports/engines/queries/filters/field-reference/enum-filter', () => {
  it.fails(
    'inclusion_filter',
    () =>
      withEnumFieldReference(async ({ db }) => {
        const scalar = column('enum');
        const list = column('enum2');
        const ids = (filter: AnyExpression) =>
          db.public.TestModel.where(filter)
            .orderBy((row) => row.id.asc())
            .select('id')
            .all();

        expect(await ids(referencedScalarInList(scalar, list, true)), 'notIn').toEqual([{ id: 2 }]);
        expect(await ids(referencedScalarInList(scalar, list, true)), 'not: { in }').toEqual([
          { id: 2 },
        ]);
        expect(
          await db.public.TestModel.where(referencedScalarInList(scalar, list))
            .orderBy((row) => row.id.asc())
            .select('id', 'enum', 'enum2')
            .all(),
          'in',
        ).toEqual([{ id: 1, enum: 'a', enum2: ['a', 'b'] }]);
      }),
    timeouts.spinUpPpgDev,
  );
});
