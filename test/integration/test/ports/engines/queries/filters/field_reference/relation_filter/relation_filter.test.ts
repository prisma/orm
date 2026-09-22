import { BinaryExpr, ColumnRef } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../../../_harness/postgres';
import {
  referencedListHasEvery,
  referencedListHasSome,
  referencedScalarInList,
} from '../postgres-list-field-reference';
import type { Contract as ComplexContract } from './_fixture/complex/generated/contract';
import complexContractJson from './_fixture/complex/generated/contract.json' with { type: 'json' };
import type { Contract as OneToManyContract } from './_fixture/one-to-many/generated/contract';
import oneToManyContractJson from './_fixture/one-to-many/generated/contract.json' with {
  type: 'json',
};
import type { Contract as OneToOneContract } from './_fixture/one-to-one/generated/contract';
import oneToOneContractJson from './_fixture/one-to-one/generated/contract.json' with {
  type: 'json',
};
import type { Contract as OneToOneListContract } from './_fixture/one-to-one-list/generated/contract';
import oneToOneListContractJson from './_fixture/one-to-one-list/generated/contract.json' with {
  type: 'json',
};

const childColumn = (name: string) => ColumnRef.of('child', name);
const toOneColumn = (name: string) => ColumnRef.of('toOne', name);

describe('ports/engines/queries/filters/field-reference/relation-filter', () => {
  it(
    'ensure_scalar_list_filters_can_run',
    () =>
      withPostgresPort<OneToOneListContract>(
        { contractJson: oneToOneListContractJson },
        async ({ db }) => {
          expect(
            await db.public.TestModel.where((model) =>
              model.child.some(() =>
                referencedScalarInList(childColumn('string1'), childColumn('string2')),
              ),
            )
              .select('id')
              .all(),
          ).toEqual([]);
          expect(
            await db.public.TestModel.where((model) =>
              model.child.some(() =>
                referencedScalarInList(childColumn('string1'), childColumn('string2'), true),
              ),
            )
              .select('id')
              .all(),
          ).toEqual([]);
          expect(
            await db.public.TestModel.where((model) =>
              model.child.some(() =>
                referencedListHasSome(childColumn('string2'), childColumn('string2')),
              ),
            )
              .select('id')
              .all(),
          ).toEqual([]);
          expect(
            await db.public.TestModel.where((model) =>
              model.child.some(() =>
                referencedListHasEvery(childColumn('string2'), childColumn('string2')),
              ),
            )
              .select('id')
              .all(),
          ).toEqual([]);
        },
      ),
    timeouts.spinUpPpgDev,
  );

  it(
    'one_to_one',
    () =>
      withPostgresPort<OneToOneContract>({ contractJson: oneToOneContractJson }, async ({ db }) => {
        await db.public.Child.createAll([
          { id: 1, string1: 'abc', string2: 'abc' },
          { id: 2, string1: 'abc', string2: 'bcd' },
        ]);
        await db.public.TestModel.createAll([
          { id: 1, childId: 1 },
          { id: 2, childId: 2 },
        ]);

        const rows = await db.public.TestModel.where((model) =>
          model.child.some(() => BinaryExpr.eq(childColumn('string1'), childColumn('string2'))),
        )
          .orderBy((model) => model.id.asc())
          .select('id')
          .all();

        expect(rows).toEqual([{ id: 1 }]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'one_to_many',
    () =>
      withPostgresPort<OneToManyContract>(
        { contractJson: oneToManyContractJson },
        async ({ db }) => {
          await db.public.TestModel.createAll([{ id: 1 }, { id: 2 }, { id: 3 }]);
          await db.public.Child.createAll([
            { id: 1, string1: 'abc', string2: 'abc', testId: 1 },
            { id: 2, string1: 'abc', string2: 'abc', testId: 1 },
            { id: 3, string1: 'abc', string2: 'abc', testId: 2 },
            { id: 4, string1: 'abc', string2: 'bcd', testId: 2 },
            { id: 5, string1: 'bcd', string2: 'abc', testId: 3 },
            { id: 6, string1: 'abc', string2: 'bcd', testId: 3 },
          ]);
          const equalsFields = () => BinaryExpr.eq(childColumn('string1'), childColumn('string2'));

          const some = await db.public.TestModel.where((model) => model.children.some(equalsFields))
            .orderBy((model) => model.id.asc())
            .select('id')
            .all();
          const none = await db.public.TestModel.where((model) => model.children.none(equalsFields))
            .orderBy((model) => model.id.asc())
            .select('id')
            .all();
          const every = await db.public.TestModel.where((model) =>
            model.children.every(equalsFields),
          )
            .orderBy((model) => model.id.asc())
            .select('id')
            .all();

          expect(some).toEqual([{ id: 1 }, { id: 2 }]);
          expect(none).toEqual([{ id: 3 }]);
          expect(every).toEqual([{ id: 1 }]);
        },
      ),
    timeouts.spinUpPpgDev,
  );

  it(
    'complex_relation_traversal',
    () =>
      withPostgresPort<ComplexContract>({ contractJson: complexContractJson }, async ({ db }) => {
        await db.public.ToOne.createAll([
          { id: 1, string1: 'abc', string2: 'abc' },
          { id: 2, string1: 'abc', string2: 'bcd' },
        ]);
        await db.public.TestModel.create({ id: 1 });
        await db.public.OneToMany.createAll([
          { id: 1, testId: 1, toOneId: 1 },
          { id: 2, testId: 1, toOneId: 2 },
        ]);

        const rows = await db.public.TestModel.where((model) =>
          model.toMany.some((many) =>
            many.toOne.some(() => BinaryExpr.eq(toOneColumn('string1'), toOneColumn('string2'))),
          ),
        )
          .select('id')
          .all();

        expect(rows).toEqual([{ id: 1 }]);
      }),
    timeouts.spinUpPpgDev,
  );
});
