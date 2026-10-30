import mongo from '@internal/mongo/runtime';
import { contractFromJson } from '@internal/mongo/static';
import { MongoFieldFilter, type MongoFilterExpr } from '@internal/mongo-query-ast/execution';
import { describe, expect, it } from 'vitest';
import { timeouts, withMongoPort } from '../../_harness/mongo';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

const order = (label: string, day: string, time: string) => ({
  label,
  paidAt: new Date(`${day}T10:00:00.123Z`),
  settledAt: Temporal.Instant.from(`${day}T10:00:00.5Z`),
  shippedAt: `${day}T15:30:00+05:30`,
  shipBy: day,
  deliverBy: Temporal.PlainDate.from(day),
  opensAt: time,
  closesAt: Temporal.PlainTime.from(time),
  lasts: 'PT1H30M',
  days: [day],
  slots: [time],
});

const ORDERS = [order('a', '2024-02-29', '09:30'), order('b', '2024-03-05', '17:45:00.25')];

describe('filters on the MongoDB date and time types against mongod', () => {
  it(
    'compare a field with the value its type gives, in the query builder and the ORM',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db, client }) => {
        await db.orders.createAll(ORDERS).toArray();
        const facade = mongo({
          contract: contractFromJson<Contract>(contractJson),
          mongoClient: client,
          dbName: 'test',
        });
        try {
          const runtime = await facade.runtime();
          const orders = () => facade.query.from('orders');
          const builderLabels = async (
            filter: Parameters<ReturnType<typeof orders>['match']>[0],
          ) => {
            const rows = await runtime.query(orders().match(filter).build()).toArray();
            return rows.map((row) => row['label']).sort();
          };
          const ormLabels = async (filter: MongoFilterExpr) =>
            (await db.orders.where(filter).all()).map((row) => row.label).sort();

          expect({
            builder: {
              dateEq: await builderLabels((f) => f.shipBy.eq('2024-02-29')),
              dateGte: await builderLabels((f) => f.shipBy.gte('2024-03-01')),
              dateIn: await builderLabels((f) => f.shipBy.in(['2024-03-05', '2024-01-01'])),
              dateNin: await builderLabels((f) => f.shipBy.nin(['2024-03-05'])),
              plainDate: await builderLabels((f) =>
                f.deliverBy.lt(Temporal.PlainDate.from('2024-03-01')),
              ),
              instantString: await builderLabels((f) =>
                f.shippedAt.eq('2024-02-29T15:30:00+05:30'),
              ),
              instant: await builderLabels((f) =>
                f.settledAt.gt(Temporal.Instant.from('2024-03-01T00:00:00Z')),
              ),
              time: await builderLabels((f) => f.opensAt.eq('09:30')),
              plainTime: await builderLabels((f) =>
                f.closesAt.gte(Temporal.PlainTime.from('12:00')),
              ),
              jsDate: await builderLabels((f) =>
                f.paidAt.lte(new Date('2024-03-01T00:00:00.000Z')),
              ),
            },
            orm: {
              dateEq: await ormLabels(MongoFieldFilter.eq('shipBy', '2024-02-29')),
              dateGte: await ormLabels(MongoFieldFilter.gte('shipBy', '2024-03-01')),
              dateIn: await ormLabels(MongoFieldFilter.in('shipBy', ['2024-03-05'])),
              plainTime: await ormLabels(
                MongoFieldFilter.gte('closesAt', Temporal.PlainTime.from('12:00')),
              ),
            },
          }).toEqual({
            builder: {
              dateEq: ['a'],
              dateGte: ['b'],
              dateIn: ['b'],
              dateNin: ['a'],
              plainDate: ['a'],
              instantString: ['a'],
              instant: ['b'],
              time: ['a'],
              plainTime: ['b'],
              jsDate: ['a'],
            },
            orm: { dateEq: ['a'], dateGte: ['b'], dateIn: ['b'], plainTime: ['b'] },
          });
        } finally {
          await facade.close();
        }
      }),
    timeouts.spinUpMongoMemoryServer,
  );
});
