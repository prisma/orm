import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../_harness/postgres';
import type { Contract } from './_fixture-timestamp/generated/contract';
import contractJson from './_fixture-timestamp/generated/contract.json' with { type: 'json' };

function withStamps(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, fn);
}

describe('temporal.timestamp and temporal.timestamptz with onCreate: now, onUpdate: now', () => {
  const previousTz = process.env['TZ'];
  beforeAll(() => {
    process.env['TZ'] = 'Etc/GMT-3';
  });
  afterAll(() => {
    if (previousTz === undefined) delete process.env['TZ'];
    else process.env['TZ'] = previousTz;
  });

  it(
    'the timestamp column takes a UTC PlainDateTime from the generator on a host outside UTC and advances on update',
    () =>
      withStamps(async ({ db }) => {
        const created = await db.public.Stamp.create({ id: 1, label: 'a' });
        expect(created.updatedAt).toBeInstanceOf(Temporal.PlainDateTime);
        expect(
          Math.abs(created.updatedAt.toZonedDateTime('UTC').epochMilliseconds - Date.now()),
        ).toBeLessThan(60_000);

        await new Promise((resolve) => setTimeout(resolve, 5));
        const updated = await db.public.Stamp.where({ id: 1 }).update({ label: 'b' });

        expect(updated?.label).toBe('b');
        expect(updated?.updatedAt).toBeInstanceOf(Temporal.PlainDateTime);
        expect(
          Temporal.PlainDateTime.compare(updated!.updatedAt, created.updatedAt),
        ).toBeGreaterThan(0);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'the timestamptz column keeps taking an Instant and advances on update',
    () =>
      withStamps(async ({ db }) => {
        const created = await db.public.Stamp.create({ id: 2, label: 'a' });
        expect(created.updatedAtTz).toBeInstanceOf(Temporal.Instant);

        await new Promise((resolve) => setTimeout(resolve, 5));
        const updated = await db.public.Stamp.where({ id: 2 }).update({ label: 'b' });

        expect(updated?.updatedAtTz).toBeInstanceOf(Temporal.Instant);
        expect(Temporal.Instant.compare(updated!.updatedAtTz, created.updatedAtTz)).toBeGreaterThan(
          0,
        );
      }),
    timeouts.spinUpPpgDev,
  );
});
