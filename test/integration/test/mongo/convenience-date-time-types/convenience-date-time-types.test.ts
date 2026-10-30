import { describe, expect, it } from 'vitest';
import { timeouts, withMongoPort } from '../../_harness/mongo';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

const written = {
  label: 'a',
  paidAt: new Date('2024-02-29T10:00:00.123Z'),
  settledAt: Temporal.Instant.from('2024-02-29T15:30:00.5+05:30'),
  shippedAt: '2024-02-29T15:30:00+05:30',
  shipBy: '2024-02-29',
  deliverBy: Temporal.PlainDate.from('2024-03-01'),
  opensAt: '09:30',
  closesAt: Temporal.PlainTime.from('17:45:00.25'),
  lasts: 'PT1H30M',
  days: ['2024-02-29'],
  slots: ['09:30'],
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIME = /^\d{2}:\d{2}:\d{2}\.\d{3}$/;

describe('the MongoDB convenience date and time types against mongod', () => {
  it(
    'write every type as its BSON type and read each back as the value its type gives',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db, mongoDb }) => {
        await db.orders.create(written);
        const stored = await mongoDb.collection('orders').findOne({ label: 'a' });
        const read = await db.orders.where({ label: 'a' }).first();

        expect({
          stored: {
            paidAt: stored?.['paidAt'],
            settledAt: stored?.['settledAt'],
            shippedAt: stored?.['shippedAt'],
            shipBy: stored?.['shipBy'],
            deliverBy: stored?.['deliverBy'],
            opensAt: stored?.['opensAt'],
            closesAt: stored?.['closesAt'],
            lasts: stored?.['lasts'],
          },
          read: {
            paidAt: read?.paidAt,
            settledAt: read?.settledAt.toString(),
            shippedAt: read?.shippedAt,
            shipBy: read?.shipBy,
            deliverBy: read?.deliverBy.toString(),
            opensAt: read?.opensAt,
            closesAt: read?.closesAt.toString(),
            lasts: read?.lasts,
          },
        }).toEqual({
          stored: {
            paidAt: new Date('2024-02-29T10:00:00.123Z'),
            settledAt: new Date('2024-02-29T10:00:00.500Z'),
            shippedAt: new Date('2024-02-29T10:00:00.000Z'),
            shipBy: new Date('2024-02-29T00:00:00.000Z'),
            deliverBy: new Date('2024-03-01T00:00:00.000Z'),
            opensAt: '09:30:00.000',
            closesAt: '17:45:00.250',
            lasts: 'PT1H30M',
          },
          read: {
            paidAt: new Date('2024-02-29T10:00:00.123Z'),
            settledAt: '2024-02-29T10:00:00.5Z',
            shippedAt: '2024-02-29T10:00:00.000Z',
            shipBy: '2024-02-29',
            deliverBy: '2024-03-01',
            opensAt: '09:30:00.000',
            closesAt: '17:45:00.25',
            lasts: 'PT1H30M',
          },
        });
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'write now() on create for every date and time type, read back as the current time',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db }) => {
        const before = Date.now();
        await db.orders.create(written);
        const after = Date.now();
        const read = await db.orders.where({ label: 'a' }).first();

        expect({
          createdAt: read?.createdAt instanceof Date,
          createdAtT: read?.createdAtT instanceof Temporal.Instant,
          createdAtS: read?.createdAtS,
          createdOn: read?.createdOn,
          createdOnT: read?.createdOnT instanceof Temporal.PlainDate,
          createdAtTime: read?.createdAtTime,
          createdAtTimeT: read?.createdAtTimeT instanceof Temporal.PlainTime,
        }).toEqual({
          createdAt: true,
          createdAtT: true,
          createdAtS: expect.stringMatching(/Z$/),
          createdOn: expect.stringMatching(ISO_DATE),
          createdOnT: true,
          createdAtTime: expect.stringMatching(ISO_TIME),
          createdAtTimeT: true,
        });
        for (const instant of [
          read?.createdAt.getTime(),
          read?.createdAtT.epochMilliseconds,
          Date.parse(read?.createdAtS ?? ''),
        ]) {
          expect(instant).toBeGreaterThanOrEqual(before);
          expect(instant).toBeLessThanOrEqual(after);
        }
        expect(read?.createdOn).toBe(read?.createdOnT.toString());
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'refuse to read a calendar date stored at another time than midnight UTC, naming the field',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db, mongoDb }) => {
        await db.orders.create(written);
        await mongoDb
          .collection('orders')
          .updateOne({ label: 'a' }, { $set: { shipBy: new Date('2024-02-29T09:30:00.000Z') } });

        await expect(db.orders.where({ label: 'a' }).first()).rejects.toMatchObject({
          code: 'RUNTIME.DECODE_FAILED',
          message: expect.stringMatching(
            /^Failed to decode field shipBy of the document with _id \w+ in collection 'orders' with codec 'mongo\/date-string@1': Codec 'mongo\/date-string@1' cannot read 2024-02-29T09:30:00.000Z: a calendar date is stored as a BSON date at midnight UTC\./,
          ),
        });
      }),
    timeouts.spinUpMongoMemoryServer,
  );
});
