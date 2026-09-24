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
};

describe('Mongo data type inventory', () => {
  it('ships codecs to check', () => {
    expect(mongoCodecDescriptors.length).toBeGreaterThan(0);
  });

  it('names the data type of every codec it ships', () => {
    expect(
      Object.fromEntries(
        mongoCodecDescriptors.map((descriptor) => [descriptor.codecId, descriptor.dataType]),
      ),
    ).toEqual(EXPECTED);
  });
});
