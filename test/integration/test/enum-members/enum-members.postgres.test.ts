import { describe, expect, expectTypeOf, it } from 'vitest';
import { type PortContext, timeouts, withPostgresPort } from '../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

const uuidA = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const uuidB = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12';

function withEnumMembers(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, fn);
}

describe('db.enums on a contract emitted from PSL, against Postgres', () => {
  it(
    'finds every value read from the database, and holds each member as the value read',
    () =>
      withEnumMembers(async ({ client, db }) => {
        await db.public.Reading.createAndCount([
          {
            id: 1,
            text: 'low',
            int4: 1,
            int8: 1n,
            uuid: uuidA,
            stamp: Temporal.Instant.from('2024-01-01T00:00:00Z'),
            day: Temporal.PlainDate.from('2024-01-01'),
            float8: 1.5,
          },
          {
            id: 2,
            text: 'high',
            int4: 10,
            int8: 10n,
            uuid: uuidB,
            stamp: Temporal.Instant.from('2025-06-30T12:00:00Z'),
            day: Temporal.PlainDate.from('2025-06-30'),
            float8: 2.25,
          },
        ]);
        const [low, high] = await db.public.Reading.orderBy((r) => r.id.asc()).all();
        if (low === undefined || high === undefined) expect.unreachable('both rows read back');
        const levels = client.enums.public;

        expect(
          [low, high].map((row) => ({
            text: levels.TextLevel.has(row.text),
            int4: levels.Int4Level.has(row.int4),
            int8: levels.Int8Level.has(row.int8),
            uuid: levels.UuidLevel.has(row.uuid),
            stamp: levels.StampLevel.has(row.stamp),
            day: levels.DayLevel.has(row.day),
            float8: levels.Float8Level.has(row.float8),
          })),
        ).toEqual([
          { text: true, int4: true, int8: true, uuid: true, stamp: true, day: true, float8: true },
          { text: true, int4: true, int8: true, uuid: true, stamp: true, day: true, float8: true },
        ]);

        expect({
          text: levels.TextLevel.members.High === high.text,
          int4: levels.Int4Level.members.High === high.int4,
          int8: levels.Int8Level.members.High === high.int8,
          uuid: levels.UuidLevel.members.Second === high.uuid,
          stamp: levels.StampLevel.members.Sunset.equals(high.stamp),
          day: levels.DayLevel.members.Sunset.equals(high.day),
          float8: levels.Float8Level.members.Whole === high.float8,
          names: [
            levels.Int8Level.nameOf(low.int8),
            levels.StampLevel.nameOf(high.stamp),
            levels.DayLevel.nameOf(low.day),
          ],
        }).toEqual({
          text: true,
          int4: true,
          int8: true,
          uuid: true,
          stamp: true,
          day: true,
          float8: true,
          names: ['Low', 'Sunset', 'Launch'],
        });
      }),
    timeouts.spinUpPpgDev,
  );

  it('types each member as the value a query returns for it', () => {
    type Levels = PortContext<Contract>['client']['enums']['public'];
    expectTypeOf<Levels['TextLevel']['members']['Low']>().toEqualTypeOf<'low'>();
    expectTypeOf<Levels['Int4Level']['members']['Low']>().toEqualTypeOf<1>();
    expectTypeOf<Levels['Int8Level']['members']['Low']>().toEqualTypeOf<1n>();
    expectTypeOf<Levels['UuidLevel']['members']['First']>().toEqualTypeOf<typeof uuidA>();
    expectTypeOf<Levels['StampLevel']['members']['Launch']>().toEqualTypeOf<Temporal.Instant>();
    expectTypeOf<Levels['DayLevel']['members']['Launch']>().toEqualTypeOf<Temporal.PlainDate>();
    expectTypeOf<Levels['Float8Level']['members']['Half']>().toEqualTypeOf<1.5>();
    expectTypeOf<Levels['Int8Level']['values']>().toEqualTypeOf<readonly [1n, 10n]>();
  });
});
