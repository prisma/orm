import { describe, expect, it } from 'vitest';
import { INSTANT_NOW_GENERATOR_ID, instantNow } from '../src/core/instant-now-generator';
import { postgresNowGeneratorIdFor, postgresNowGeneratorIds } from '../src/core/now-generators';
import {
  PLAIN_DATE_TIME_NOW_GENERATOR_ID,
  plainDateTimeNow,
} from '../src/core/plain-date-time-now-generator';
import { postgresCodecRegistry } from '../src/core/registry';

const generate: Readonly<Record<string, () => unknown>> = {
  [INSTANT_NOW_GENERATOR_ID]: instantNow,
  [PLAIN_DATE_TIME_NOW_GENERATOR_ID]: plainDateTimeNow,
};

describe('the "now" generator for each codec', () => {
  it.each(Object.entries(postgresNowGeneratorIds))(
    'generates a value %s encodes',
    async (codecId, generatorId) => {
      const value = generate[generatorId]?.();
      expect(value).toBeDefined();
      const descriptor = postgresCodecRegistry.descriptorFor(codecId);
      const codec = descriptor?.factory({})({ name: '<test>' });
      expect(codec).toBeDefined();
      await expect(codec?.encode(value, {})).resolves.toBeDefined();
      expect(codec?.encodeJson(value)).toBeDefined();
    },
  );

  it('has no generator for a codec without one', () => {
    expect(
      ['pg/date-temporal@1', 'pg/time-temporal@1', 'pg/timetz@1', 'pg/text@1'].map(
        postgresNowGeneratorIdFor,
      ),
    ).toEqual([undefined, undefined, undefined, undefined]);
  });

  it('pairs timestamp with plainDateTimeNow and timestamptz with instantNow', () => {
    expect(postgresNowGeneratorIds).toEqual({
      'pg/timestamp-temporal@1': PLAIN_DATE_TIME_NOW_GENERATOR_ID,
      'pg/timestamptz-temporal@1': INSTANT_NOW_GENERATOR_ID,
    });
  });
});
