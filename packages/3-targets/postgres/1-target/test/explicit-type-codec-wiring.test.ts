import { describe, expect, it } from 'vitest';
import { postgresAggregateDescriptors } from '../src/core/aggregates';
import { codecDescriptorMap } from '../src/core/codec-type-map';
import { codecDescriptors } from '../src/core/codecs';
import * as codecIds from '../src/exports/codec-ids';
import * as codecs from '../src/exports/codecs';

const rowsFor = (codecId: string) =>
  postgresAggregateDescriptors.filter(
    (row) => row.input.kind === 'codec' && row.input.codecId === codecId,
  );

const preserved = (codecId: string) =>
  ['min', 'max'].map((operation) => ({
    operation,
    input: { kind: 'codec', codecId },
    output: { kind: 'self' },
    nullable: true,
  }));

describe.each([
  {
    codecId: 'pg/timestamp-date@1',
    constant: 'PG_TIMESTAMP_DATE_CODEC_ID',
    mapKey: 'timestamp-date',
    exported: [
      'PgTimestampDateCodec',
      'PgTimestampDateDescriptor',
      'pgTimestampDateColumn',
      'pgTimestampDateDescriptor',
    ],
  },
  {
    codecId: 'pg/timestamp-instant@1',
    constant: 'PG_TIMESTAMP_INSTANT_CODEC_ID',
    mapKey: 'timestamp-instant',
    exported: [],
  },
  {
    codecId: 'pg/interval-string@1',
    constant: 'PG_INTERVAL_STRING_CODEC_ID',
    mapKey: 'interval-string',
    exported: [
      'PgIntervalStringCodec',
      'PgIntervalStringDescriptor',
      'pgIntervalStringColumn',
      'pgIntervalStringDescriptor',
    ],
  },
])('$codecId', ({ codecId, constant, mapKey, exported }) => {
  it('has an exported id, is registered once and is in the codec type map', () => {
    const registered = codecs.postgresCodecRegistry.descriptorFor(codecId);
    expect(codecIds).toHaveProperty(constant, codecId);
    for (const name of exported) expect(codecs).toHaveProperty(name);
    expect(codecDescriptorMap).toHaveProperty(mapKey, registered);
    expect(codecDescriptors.filter((entry) => entry.codecId === codecId)).toEqual([registered]);
  });
});

describe('the aggregates over the explicit timestamp and interval codecs', () => {
  it.each(['pg/timestamp-date@1', 'pg/timestamp-instant@1'])(
    'keep %s for min and max and offer no sum or avg',
    (codecId) => {
      expect(rowsFor(codecId)).toEqual(preserved(codecId));
    },
  );

  it('sum and average an interval read as a string into the same codec, as PostgreSQL does', () => {
    const codecId = 'pg/interval-string@1';
    expect(rowsFor(codecId)).toEqual([
      ...['sum', 'avg'].map((operation) => ({
        operation,
        input: { kind: 'codec', codecId },
        output: { kind: 'codec', codecId },
        nullable: true,
      })),
      ...preserved(codecId),
    ]);
  });
});
