import type { JsonValue } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import { mongoCodecDescriptors } from '../src/core/codecs';

/** A stored value of each data type. */
const storedValues: Readonly<Record<string, JsonValue>> = {
  'mongo/objectid': '65a1b2c3d4e5f6a7b8c9d0e1',
  'mongo/string': 'low',
  'mongo/double': 1.5,
  'mongo/int32': 1,
  'mongo/bool': true,
  'mongo/date': '2024-01-01T00:00:00.000Z',
  'mongo/vector': [1, 2],
  'mongo/int64': '1',
  'mongo/decimal128': '1.5',
  'mongo/binary': 'aGVsbG8=',
  'mongo/json': 'x',
  'mongo/bson': { a: 1 },
};

describe('the literal each registered codec renders', () => {
  it('is pinned for a stored value of its data type', () => {
    const rendered = Object.fromEntries(
      mongoCodecDescriptors.map((descriptor) => [
        descriptor.codecId,
        descriptor.renderValueLiteral?.(storedValues[descriptor.dataType] ?? null, 'output'),
      ]),
    );

    expect(rendered).toEqual({
      'mongo/objectId@1': undefined,
      'mongo/string@1': '"low"',
      'mongo/double@1': '1.5',
      'mongo/int32@1': '1',
      'mongo/bool@1': 'true',
      'mongo/date@1': undefined,
      'mongo/vector@1': undefined,
      'mongo/int64@1': '1n',
      'mongo/int64Number@1': '1',
      'mongo/decimal128@1': undefined,
      'mongo/binary@1': undefined,
      'mongo/json@1': undefined,
      'mongo/bson@1': undefined,
    });
  });
});
