import { describe, expect, it } from 'vitest';
import { mongoCodecDescriptors } from '../src/core/codecs';

/** Every codec this pack ships and the data type it represents. ADR 254, spec B4. */
const EXPECTED: Readonly<Record<string, string>> = {
  'mongo/objectId@1': 'mongo/objectid',
  'mongo/string@1': 'mongo/string',
  'mongo/double@1': 'mongo/double',
  'mongo/int32@1': 'mongo/int32',
  'mongo/bool@1': 'mongo/bool',
  'mongo/date@1': 'mongo/date',
  'mongo/vector@1': 'mongo/vector',
  'mongo/int64@1': 'mongo/int64',
  'mongo/int64Number@1': 'mongo/int64',
  'mongo/decimal128@1': 'mongo/decimal128',
  'mongo/binary@1': 'mongo/binary',
  'mongo/json@1': 'mongo/json',
  'mongo/bson@1': 'mongo/bson',
  'mongo/date-instant@1': 'mongo/date',
  'mongo/date-instant-string@1': 'mongo/date',
  'mongo/date-string@1': 'mongo/date',
  'mongo/date-temporal@1': 'mongo/date',
  'mongo/time-string@1': 'mongo/time',
  'mongo/time-temporal@1': 'mongo/time',
  'mongo/duration-string@1': 'mongo/duration',
};

describe('Mongo data type inventory', () => {
  it('names the data type of every codec it ships', () => {
    expect(
      Object.fromEntries(
        mongoCodecDescriptors.map((descriptor) => [descriptor.codecId, descriptor.dataType]),
      ),
    ).toEqual(EXPECTED);
  });
});
