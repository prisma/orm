import { createDataTypeLookup } from '@internal/framework-components/codec';
import { temporaryValueOfCodec } from '@internal/mongo-contract/data-type';
import { describe, expect, it } from 'vitest';
import { mongoDescriptorById } from '../src/core/codecs';
import { mongoDataTypes } from '../src/core/data-types';

const lookups = {
  codecLookup: { descriptorFor: mongoDescriptorById },
  dataTypeLookup: createDataTypeLookup(mongoDataTypes),
};

describe('the temporary value of each MongoDB codec', () => {
  it('is a typed expression for the scalar codecs, and none for the others', () => {
    const codecs = [
      'mongo/string@1',
      'mongo/int32@1',
      'mongo/int64@1',
      'mongo/int64Number@1',
      'mongo/double@1',
      'mongo/decimal128@1',
      'mongo/bool@1',
      'mongo/date@1',
      'mongo/objectId@1',
      'mongo/binary@1',
      'mongo/json@1',
      'mongo/bson@1',
      'mongo/vector@1',
    ];

    expect(
      Object.fromEntries(codecs.map((codec) => [codec, temporaryValueOfCodec(codec, lookups)])),
    ).toEqual({
      'mongo/string@1': { expression: { $literal: '' }, text: '""' },
      'mongo/int32@1': { expression: 0, text: '0' },
      'mongo/int64@1': { expression: { $toLong: 0 }, text: '0' },
      'mongo/int64Number@1': { expression: { $toLong: 0 }, text: '0' },
      'mongo/double@1': { expression: { $toDouble: 0 }, text: '0' },
      'mongo/decimal128@1': { expression: { $toDecimal: '0' }, text: '0' },
      'mongo/bool@1': { expression: false, text: 'false' },
      'mongo/date@1': undefined,
      'mongo/objectId@1': undefined,
      'mongo/binary@1': undefined,
      'mongo/json@1': undefined,
      'mongo/bson@1': undefined,
      'mongo/vector@1': undefined,
    });
  });
});
