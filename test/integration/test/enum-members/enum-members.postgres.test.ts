import { describe, expect, expectTypeOf, it } from 'vitest';
import { type PortContext, timeouts, withPostgresPort } from '../_harness/postgres';
import type { Contract } from './_fixture-postgres/generated/contract';
import contractJson from './_fixture-postgres/generated/contract.json' with { type: 'json' };

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
            special: client.enums.public.FloatSpecial.members.Nan,
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
            special: client.enums.public.FloatSpecial.members.Negative,
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
            special: levels.FloatSpecial.has(row.special),
          })),
        ).toEqual([
          {
            text: true,
            int4: true,
            int8: true,
            uuid: true,
            stamp: true,
            day: true,
            float8: true,
            special: true,
          },
          {
            text: true,
            int4: true,
            int8: true,
            uuid: true,
            stamp: true,
            day: true,
            float8: true,
            special: true,
          },
        ]);

        expect({
          text: levels.TextLevel.members.High === high.text,
          int4: levels.Int4Level.members.High === high.int4,
          int8: levels.Int8Level.members.High === high.int8,
          uuid: levels.UuidLevel.members.Second === high.uuid,
          stamp: levels.StampLevel.members.Sunset.equals(high.stamp),
          day: levels.DayLevel.members.Sunset.equals(high.day),
          float8: levels.Float8Level.members.Whole === high.float8,
          special: [
            Number.isNaN(low.special),
            levels.FloatSpecial.members.Negative === high.special,
          ],
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
          special: [true, true],
          names: ['Low', 'Sunset', 'Launch'],
        });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'enforces inet and numeric list members in the element type',
    () =>
      withEnumMembers(async ({ client, db }) => {
        const { Host, Ratio } = client.enums.public;
        await db.public.Network.createAndCount([
          {
            id: 1,
            hosts: [Host.members.Loopback, Host.members.Private, Host.members.Local6],
            ratios: [Ratio.members.Half, Ratio.members.Whole],
            ratio: Ratio.members.Half,
          },
          { id: 2, hosts: [], ratios: ['0.50'], ratio: '0.50' },
        ]);
        const refused = await Promise.all(
          [
            { id: 3, hosts: ['10.0.0.1'], ratios: [], ratio: Ratio.members.Half },
            { id: 4, hosts: ['10.0.0.0/16'], ratios: [], ratio: Ratio.members.Half },
            { id: 5, hosts: [], ratios: ['0.7'], ratio: Ratio.members.Half },
            { id: 6, hosts: [], ratios: [], ratio: '0.7' },
          ].map((row) =>
            db.public.Network.createAndCount([row]).then(
              () => 'accepted',
              (error: Error) =>
                /violates check constraint "networks_\w+_check_/.test(error.message),
            ),
          ),
        );
        const rows = await db.public.Network.orderBy((n) => n.id.asc()).all();

        expect({
          rows: rows.map((row) => ({
            ...row,
            hostsFound: row.hosts.map((host) => Host.has(host)),
            ratiosFound: row.ratios.map((ratio) => Ratio.has(ratio)),
          })),
          refused,
        }).toEqual({
          rows: [
            {
              id: 1,
              hosts: ['127.0.0.1', '10.0.0.0/8', '::1'],
              ratios: ['0.5', '1.50'],
              ratio: '0.5',
              hostsFound: [true, true, true],
              ratiosFound: [true, true],
            },
            {
              id: 2,
              hosts: [],
              ratios: ['0.50'],
              ratio: '0.50',
              hostsFound: [],
              ratiosFound: [false],
            },
          ],
          refused: [true, true, true, true],
        });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'enforces a float enum that mixes a finite and a NaN member, in the column type',
    () =>
      withEnumMembers(async ({ client, db }) => {
        const { FloatMixed } = client.enums.public;
        await db.public.Gauge.createAndCount([
          { id: 1, level: Number.NaN, levels: [Number.NaN, 1.5] },
          { id: 2, level: 1.5, levels: [] },
        ]);
        const refused = await Promise.all(
          [
            { id: 3, level: 2, levels: [] },
            { id: 4, level: 1.5, levels: [2] },
          ].map((row) =>
            db.public.Gauge.createAndCount([row]).then(
              () => 'accepted',
              (error: Error) => /violates check constraint "gauges_\w+_check_/.test(error.message),
            ),
          ),
        );
        const rows = await db.public.Gauge.orderBy((g) => g.id.asc()).all();

        expect({
          rows: rows.map((row) => ({
            id: row.id,
            level: FloatMixed.nameOf(row.level),
            levels: row.levels.map((level) => FloatMixed.nameOf(level)),
          })),
          refused,
        }).toEqual({
          rows: [
            { id: 1, level: 'Nan', levels: ['Nan', 'Half'] },
            { id: 2, level: 'Half', levels: [] },
          ],
          refused: [true, true],
        });
        expectTypeOf(rows[0]?.level).toEqualTypeOf<number | undefined>();
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
    expectTypeOf<Levels['FloatSpecial']['members']['Nan']>().toEqualTypeOf<number>();
    expectTypeOf<Levels['Int8Level']['values']>().toEqualTypeOf<readonly [1n, 10n]>();
  });
});
