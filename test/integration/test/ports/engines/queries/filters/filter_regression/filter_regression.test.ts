import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../../_harness/postgres';
import type { Contract as CompoundContract } from './_fixture/compound-one-to-many/generated/contract';
import compoundContractJson from './_fixture/compound-one-to-many/generated/contract.json' with {
  type: 'json',
};
import type { Contract as ManyToManyContract } from './_fixture/many-to-many/generated/contract';
import manyToManyContractJson from './_fixture/many-to-many/generated/contract.json' with {
  type: 'json',
};
import type { Contract as OneToManyContract } from './_fixture/one-to-many/generated/contract';
import oneToManyContractJson from './_fixture/one-to-many/generated/contract.json' with {
  type: 'json',
};

const locations = [
  { id: 310, name: 'A' },
  { id: 311, name: 'A' },
  { id: 314, name: 'A' },
  { id: 312, name: 'B' },
  { id: 317, name: 'B' },
  { id: 313, name: 'C' },
  { id: 315, name: 'C' },
  { id: 316, name: 'D' },
] as const;

describe('ports/engines/queries/filters/filter_regression', () => {
  it(
    'work_with_nulls (one-to-many)',
    () =>
      withPostgresPort<OneToManyContract>(
        { contractJson: oneToManyContractJson },
        async ({ db }) => {
          await db.public.Company.createAll([
            { id: 134, name: '1' },
            { id: 135, name: '2' },
            { id: 136, name: '3' },
          ]);
          await db.public.Location.createAll(locations.map((location) => ({ ...location })));
          await db.public.Location.where((location) => location.id.eq(310)).update({
            companyId: 134,
          });
          await db.public.Location.where((location) => location.id.in([312, 313])).updateAll({
            companyId: 134,
          });
          await db.public.Location.where((location) => location.id.in([311, 314])).updateAll({
            companyId: 135,
          });
          await db.public.Location.where((location) => location.id.in([315, 317])).updateAll({
            companyId: 136,
          });

          expect(
            await db.public.Company.where((company) =>
              company.locations.none((location) => location.name.eq('D')),
            )
              .select('id')
              .all(),
          ).toEqual([{ id: 134 }, { id: 135 }, { id: 136 }]);
          expect(
            await db.public.Company.where((company) =>
              company.locations.every((location) => location.name.eq('A')),
            )
              .select('id')
              .all(),
          ).toEqual([{ id: 135 }]);
          expect(
            await db.public.Location.where((location) =>
              location.company.some((company) => company.id.eq(135)),
            )
              .select('id')
              .all(),
          ).toEqual([{ id: 311 }, { id: 314 }]);
        },
      ),
    timeouts.spinUpPpgDev,
  );

  it(
    'work_with_nulls (compound one-to-many)',
    () =>
      withPostgresPort<CompoundContract>({ contractJson: compoundContractJson }, async ({ db }) => {
        await db.public.Company.createAll([
          { id: 134, id2: 134, name: '1' },
          { id: 135, id2: 135, name: '2' },
          { id: 136, id2: 136, name: '3' },
        ]);
        await db.public.Location.createAll(locations.map((location) => ({ ...location })));
        await db.public.Location.where((location) => location.id.in([310, 312, 313])).updateAll({
          companyId: 134,
          companyId2: 134,
        });
        await db.public.Location.where((location) => location.id.in([311, 314])).updateAll({
          companyId: 135,
          companyId2: 135,
        });
        await db.public.Location.where((location) => location.id.in([315, 317])).updateAll({
          companyId: 136,
          companyId2: 136,
        });

        expect(
          await db.public.Company.where((company) =>
            company.locations.none((location) => location.name.eq('D')),
          )
            .select('id')
            .all(),
        ).toEqual([{ id: 134 }, { id: 135 }, { id: 136 }]);
        expect(
          await db.public.Company.where((company) =>
            company.locations.every((location) => location.name.eq('A')),
          )
            .select('id')
            .all(),
        ).toEqual([{ id: 135 }]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'work_with_nulls (many-to-many)',
    () =>
      withPostgresPort<ManyToManyContract>(
        { contractJson: manyToManyContractJson },
        async ({ db }) => {
          await db.public.Location.createAll(locations.map((location) => ({ ...location })));
          await db.public.Company.create({
            id: 134,
            name: '1',
            locations: (relation) => relation.connect([{ id: 310 }, { id: 312 }, { id: 313 }]),
          });
          await db.public.Company.create({
            id: 135,
            name: '2',
            locations: (relation) => relation.connect([{ id: 311 }, { id: 314 }]),
          });
          await db.public.Company.create({
            id: 136,
            name: '3',
            locations: (relation) => relation.connect([{ id: 315 }, { id: 317 }]),
          });

          expect(
            await db.public.Company.where((company) =>
              company.locations.none((location) => location.name.eq('D')),
            )
              .orderBy((company) => company.id.asc())
              .select('id')
              .all(),
          ).toEqual([{ id: 134 }, { id: 135 }, { id: 136 }]);
          expect(
            await db.public.Company.where((company) =>
              company.locations.every((location) => location.name.eq('A')),
            )
              .select('id')
              .all(),
          ).toEqual([{ id: 135 }]);
        },
      ),
    timeouts.spinUpPpgDev,
  );
});
