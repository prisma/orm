import { afterEach, describe, expect, it, vi } from 'vitest';
import { timeouts, withPostgresPort } from '../_harness/postgres';
import type { Contract } from './_fixture-now/generated/contract';
import contractJson from './_fixture-now/generated/contract.json' with { type: 'json' };

function printed(row: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(row)
      .filter(([field]) => field !== 'id' && field !== 'label')
      .map(([field, value]) => [
        field,
        value instanceof Date ? value.toISOString() : String(value),
      ]),
  );
}

const LAST_MILLISECOND_OF_THE_DAY = new Date('2024-01-02T23:59:59.999Z');

const expectedAtLastMillisecond = {
  date: '2024-01-02',
  dateString: '2024-01-02',
  time0: '23:59:59',
  time3: '23:59:59.999',
  time6: '23:59:59.999',
  timeString0: '23:59:59',
  timeString3: '23:59:59.999',
  timeString6: '23:59:59.999',
  timetz0: '23:59:59Z',
  timetz3: '23:59:59.999Z',
  timetz6: '23:59:59.999Z',
  timestamp0: '2024-01-02T23:59:59',
  timestamp1: '2024-01-02T23:59:59.9',
  timestamp3: '2024-01-02T23:59:59.999',
  timestamp6: '2024-01-02T23:59:59.999',
  timestampString0: '2024-01-02T23:59:59',
  timestampString3: '2024-01-02T23:59:59.999',
  timestampString6: '2024-01-02T23:59:59.999',
  timestamptz0: '2024-01-02T23:59:59Z',
  timestamptz2: '2024-01-02T23:59:59.99Z',
  timestamptz3: '2024-01-02T23:59:59.999Z',
  timestamptz6: '2024-01-02T23:59:59.999Z',
  timestamptzString0: '2024-01-02T23:59:59Z',
  timestamptzString1: '2024-01-02T23:59:59.9Z',
  timestamptzString2: '2024-01-02T23:59:59.99Z',
  timestamptzString3: '2024-01-02T23:59:59.999Z',
  timestamptzString6: '2024-01-02T23:59:59.999Z',
  timestamptzJsDate0: '2024-01-02T23:59:59.000Z',
  timestamptzJsDate1: '2024-01-02T23:59:59.900Z',
  timestamptzJsDate2: '2024-01-02T23:59:59.990Z',
  timestamptzJsDate3: '2024-01-02T23:59:59.999Z',
  timestamptzJsDate6: '2024-01-02T23:59:59.999Z',
  timestampJsDate0: '2024-01-02T23:59:59.000Z',
  timestampJsDate1: '2024-01-02T23:59:59.900Z',
  timestampJsDate2: '2024-01-02T23:59:59.990Z',
  timestampInstant0: '2024-01-02T23:59:59Z',
  timestampInstant2: '2024-01-02T23:59:59.99Z',
  dateTime0: '2024-01-02T23:59:59.000Z',
};

describe('the "now" generator of every Postgres date and time codec', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it(
    'writes a value the codec reads back, at each precision, in the last millisecond of the day',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        const clock = db.public.Clock;
        vi.useFakeTimers({ toFake: ['Date'], now: LAST_MILLISECOND_OF_THE_DAY });
        const created = await clock.create({ id: 1, label: 'a' });
        const updated = await clock.where({ id: 1 }).update({ label: 'b' });
        vi.useRealTimers();
        const [read] = await clock.all();

        expect({
          created: printed(created),
          updated: updated === null ? null : printed(updated),
          read: read === undefined ? undefined : printed(read),
        }).toEqual({
          created: expectedAtLastMillisecond,
          updated: expectedAtLastMillisecond,
          read: expectedAtLastMillisecond,
        });
      }),
    timeouts.spinUpPpgDev,
  );
});
