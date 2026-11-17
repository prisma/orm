import type {
  AnyCodecDescriptor,
  CodecLookupWithDescriptors,
} from '@internal/framework-components/codec';
import { createDataTypeLookup, dataType, dataTypeId } from '@internal/framework-components/codec';
import {
  mongoCodecLookup,
  mongoTestCodecDescriptors,
  mongoTestDataTypes,
} from '@internal/mongo-contract/test';
import { describe, expect, it } from 'vitest';
import { interpretMongoContract } from './interpreter-test-helpers';

const pointDescriptor: AnyCodecDescriptor = {
  ...mongoTestCodecDescriptors[0],
  codecId: 'geo/point@1',
  dataType: dataTypeId('geo/point'),
} as AnyCodecDescriptor;

const codecLookup: CodecLookupWithDescriptors = {
  ...mongoCodecLookup,
  descriptorFor: (id) =>
    id === 'geo/point@1' ? pointDescriptor : mongoCodecLookup.descriptorFor(id),
};

function interpret(schema: string) {
  return interpretMongoContract(schema, {
    scalarTypes: new Map([
      ['String', 'mongo/string@1'],
      ['ObjectId', 'mongo/objectId@1'],
      ['Point', 'geo/point@1'],
    ]),
    defaultFunctionRegistry: new Map(),
    codecLookup,
    dataTypes: {
      entries: {},
      lookup: createDataTypeLookup([
        ...mongoTestDataTypes,
        dataType('geo/point', { read: (json) => json }),
      ]),
      dataTypeOfCodec: () => undefined,
    },
  });
}

describe('a PSL MongoDB field whose codec has no MongoDB data type', () => {
  it('is refused at the field, in a model and in a composite type', () => {
    const result = interpret(`
      type Address {
        location Point
      }

      model Place {
        id       ObjectId @id @map("_id")
        location Point
        address  Address
        @@map("places")
      }
    `);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics.map(({ code, message }) => ({ code, message }))).toEqual([
      {
        code: 'PSL_UNSUPPORTED_FIELD_TYPE',
        message:
          'Field "Place.location" uses codec "geo/point@1", whose data type "geo/point" is not a MongoDB data type of any pack in the contract, so its BSON type is unknown and the contract cannot describe the field.',
      },
      {
        code: 'PSL_UNSUPPORTED_FIELD_TYPE',
        message:
          'Field "Address.location" uses codec "geo/point@1", whose data type "geo/point" is not a MongoDB data type of any pack in the contract, so its BSON type is unknown and the contract cannot describe the field.',
      },
    ]);
  });
});
