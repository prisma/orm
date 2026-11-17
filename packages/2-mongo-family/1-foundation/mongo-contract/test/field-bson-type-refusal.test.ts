import { dataType, dataTypeId } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import { mongoCodecLookup, mongoDataTypeLookup, mongoTypeLookups } from '../src/fake-type-lookups';
import { fieldBsonTypeRefusalOf } from '../src/field-bson-type-refusal';

describe('fieldBsonTypeRefusalOf', () => {
  it('accepts a codec whose data type is a MongoDB data type', () => {
    expect(fieldBsonTypeRefusalOf('mongo/string@1', mongoTypeLookups)).toBeUndefined();
  });

  it('names a codec no pack provides', () => {
    expect(fieldBsonTypeRefusalOf('geo/point@1', mongoTypeLookups)).toEqual({
      kind: 'unknownCodec',
      reason:
        'uses codec "geo/point@1", which no pack in the contract provides, so its BSON type is unknown and the contract cannot describe the field.',
    });
  });

  it('names the data type of a codec whose data type is not a MongoDB data type', () => {
    const lookups = {
      codecLookup: {
        descriptorFor: (id: string) =>
          id === 'geo/point@1'
            ? {
                ...mongoCodecLookup.descriptorFor('mongo/string@1')!,
                codecId: id,
                dataType: dataTypeId('geo/point'),
              }
            : mongoCodecLookup.descriptorFor(id),
      },
      dataTypeLookup: {
        get: (id: string) =>
          id === 'geo/point'
            ? dataType('geo/point', { read: (json) => json })
            : mongoDataTypeLookup.get(id),
      },
    };
    expect(fieldBsonTypeRefusalOf('geo/point@1', lookups)).toEqual({
      kind: 'notMongoDataType',
      dataType: 'geo/point',
      reason:
        'uses codec "geo/point@1", whose data type "geo/point" is not a MongoDB data type of any pack in the contract, so its BSON type is unknown and the contract cannot describe the field.',
    });
  });
});
