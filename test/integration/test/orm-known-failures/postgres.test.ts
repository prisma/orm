import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../_harness/postgres';
import type { Contract } from './fixtures/postgres/generated/contract';
import contractJson from './fixtures/postgres/generated/contract.json' with { type: 'json' };

describe('Postgres ORM calls known to fail', { timeout: timeouts.spinUpPpgDev }, () => {
  it.fails('a TimeTemporal value the database rounds up to 24:00:00 leaves a row that can be read', async () => {
    await withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
      await db.public.Shift.create({
        id: 1,
        startsAt: Temporal.PlainTime.from('23:59:59.5'),
      }).catch(() => undefined);
      expect(await db.public.Shift.select('id', 'startsAt').all()).toEqual([
        { id: 1, startsAt: expect.anything() },
      ]);
    });
  });
});
