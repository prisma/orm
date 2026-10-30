import mongo from '@internal/mongo/runtime';
import { contractFromJson } from '@internal/mongo/static';
import { describe, expect, it } from 'vitest';
import { timeouts, withMongoPort } from '../../_harness/mongo';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

const generated = {
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
  createdAtT: Temporal.Instant.from('2024-01-01T00:00:00Z'),
  createdAtS: '2024-01-01T00:00:00.000Z',
  createdOn: '2024-01-01',
  createdOnT: Temporal.PlainDate.from('2024-01-01'),
  createdAtTime: '00:00:00.000',
  createdAtTimeT: Temporal.PlainTime.from('00:00'),
};

const document = (label: string) => ({
  label,
  paidAt: new Date('2024-02-29T10:00:00.123Z'),
  settledAt: Temporal.Instant.from('2024-02-29T10:00:00.5Z'),
  shippedAt: '2024-02-29T15:30:00+05:30',
  shipBy: '2024-02-29',
  deliverBy: Temporal.PlainDate.from('2024-03-01'),
  opensAt: '09:30',
  closesAt: Temporal.PlainTime.from('17:45:00.25'),
  lasts: 'PT1H30M',
  days: ['2024-02-29'],
  slots: ['09:30'],
  ...generated,
});

describe('writes of the MongoDB date and time types through the query builder against mongod', () => {
  it(
    'store each value through its field codec, in inserts, updates and upserts',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db, client, mongoDb }) => {
        const facade = mongo({
          contract: contractFromJson<Contract>(contractJson),
          mongoClient: client,
          dbName: 'test',
        });
        try {
          const runtime = await facade.runtime();
          const run = async (plan: Parameters<typeof runtime.query>[0]) => {
            await runtime.query(plan).toArray();
          };
          const orders = () => facade.query.from('orders');
          await run(orders().insertOne(document('a')));
          await run(orders().insertMany([document('b')]));
          await run(
            orders()
              .match((f) => f.label.eq('b'))
              .updateMany((f) => [
                f.shipBy.set('2024-03-05'),
                f.closesAt.set(Temporal.PlainTime.from('18:00')),
                f.days.push('2024-03-01'),
                f.slots.addToSet('10:00'),
                f.deliverBy.max(Temporal.PlainDate.from('2024-03-10')),
              ]),
          );
          await run(
            orders().upsertOne(
              (f) => f.label.eq('c'),
              (f) => [
                f.shipBy.setOnInsert('2024-04-01'),
                f.paidAt.setOnInsert(new Date('2024-04-01T10:00:00.000Z')),
                f.settledAt.setOnInsert(Temporal.Instant.from('2024-04-01T10:00:00Z')),
                f.shippedAt.setOnInsert('2024-04-01T10:00:00Z'),
                f.deliverBy.setOnInsert(Temporal.PlainDate.from('2024-04-02')),
                f.opensAt.setOnInsert('08:00'),
                f.closesAt.setOnInsert(Temporal.PlainTime.from('16:00')),
                f.lasts.setOnInsert('PT2H'),
                f.days.setOnInsert(['2024-04-01']),
                f.slots.setOnInsert(['08:00']),
                ...Object.entries(generated).map(([name, value]) =>
                  f.rawPath(name).setOnInsert(value),
                ),
              ],
            ),
          );

          const stored = await mongoDb
            .collection('orders')
            .find(
              {},
              { projection: { _id: 0, label: 1, shipBy: 1, days: 1, slots: 1, closesAt: 1 } },
            )
            .sort({ label: 1 })
            .toArray();
          const read = (await db.orders.all()).sort((x, y) => x.label.localeCompare(y.label));

          expect({
            stored,
            read: read.map((row) => ({
              label: row.label,
              shipBy: row.shipBy,
              deliverBy: row.deliverBy.toString(),
              settledAt: row.settledAt.toString(),
              shippedAt: row.shippedAt,
              opensAt: row.opensAt,
              closesAt: row.closesAt.toString(),
              days: row.days,
              slots: row.slots,
            })),
          }).toEqual({
            stored: [
              {
                label: 'a',
                shipBy: new Date('2024-02-29T00:00:00.000Z'),
                closesAt: '17:45:00.250',
                days: [new Date('2024-02-29T00:00:00.000Z')],
                slots: ['09:30:00.000'],
              },
              {
                label: 'b',
                shipBy: new Date('2024-03-05T00:00:00.000Z'),
                closesAt: '18:00:00.000',
                days: [new Date('2024-02-29T00:00:00.000Z'), new Date('2024-03-01T00:00:00.000Z')],
                slots: ['09:30:00.000', '10:00:00.000'],
              },
              {
                label: 'c',
                shipBy: new Date('2024-04-01T00:00:00.000Z'),
                closesAt: '16:00:00.000',
                days: [new Date('2024-04-01T00:00:00.000Z')],
                slots: ['08:00:00.000'],
              },
            ],
            read: [
              {
                label: 'a',
                shipBy: '2024-02-29',
                deliverBy: '2024-03-01',
                settledAt: '2024-02-29T10:00:00.5Z',
                shippedAt: '2024-02-29T10:00:00.000Z',
                opensAt: '09:30:00.000',
                closesAt: '17:45:00.25',
                days: ['2024-02-29'],
                slots: ['09:30:00.000'],
              },
              {
                label: 'b',
                shipBy: '2024-03-05',
                deliverBy: '2024-03-10',
                settledAt: '2024-02-29T10:00:00.5Z',
                shippedAt: '2024-02-29T10:00:00.000Z',
                opensAt: '09:30:00.000',
                closesAt: '18:00:00',
                days: ['2024-02-29', '2024-03-01'],
                slots: ['09:30:00.000', '10:00:00.000'],
              },
              {
                label: 'c',
                shipBy: '2024-04-01',
                deliverBy: '2024-04-02',
                settledAt: '2024-04-01T10:00:00Z',
                shippedAt: '2024-04-01T10:00:00.000Z',
                opensAt: '08:00:00.000',
                closesAt: '16:00:00',
                days: ['2024-04-01'],
                slots: ['08:00:00.000'],
              },
            ],
          });
        } finally {
          await facade.close();
        }
      }),
    timeouts.spinUpMongoMemoryServer,
  );
});
