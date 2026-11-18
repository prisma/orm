import { describe, expect, it } from 'vitest';
import { pgDate, pgTimestamp, pgTimestamptz } from '../src/core/data-types';
import { postgresCodecDescriptorRegistry } from '../src/core/registry';

/** Text PostgreSQL prints for a value of each type under DateStyle German. */
const GERMAN_TEXT: Readonly<Record<string, string>> = {
  [pgDate.id]: '02.01.2026',
  [pgTimestamp.id]: '02.01.2026 03:04:05.123456',
  [pgTimestamptz.id]: '02.01.2026 03:04:05.123456 UTC',
};

const dateBearingCodecs = [...postgresCodecDescriptorRegistry.values()].filter((descriptor) =>
  Object.hasOwn(GERMAN_TEXT, descriptor.dataType),
);

describe('every Postgres codec of a date, timestamp or timestamptz column', () => {
  it('is found in the registry', () => {
    expect(new Set(dateBearingCodecs.map(({ dataType }) => dataType))).toEqual(
      new Set(Object.keys(GERMAN_TEXT)),
    );
  });

  it.each(dateBearingCodecs.map((descriptor) => ({ codecId: descriptor.codecId, descriptor })))(
    '$codecId refuses text PostgreSQL prints under DateStyle German, naming the setting',
    async ({ codecId, descriptor }) => {
      const codec = descriptor.factory(undefined)({ name: 'date-style' });
      const wire = GERMAN_TEXT[descriptor.dataType];
      await expect(codec.fromWire(wire, {})).rejects.toMatchObject({
        code: 'RUNTIME.DATE_STYLE_NOT_ISO',
        meta: { codecId, received: wire },
      });
    },
  );
});
