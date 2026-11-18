import { mongoCodecLookup } from '@internal/mongo-contract/test';
import { describe, expect, it } from 'vitest';
import { interpretMongoContract } from './interpreter-test-helpers';
import { mongoDataTypeSupport } from './mongo-type-lookups';

const schema = `
model User {
  id    ObjectId @id @map("_id")
  email String
  @@map("users")
}

model Admin {
  id    ObjectId @id @map("_id")
  level Int
  @@map("users")
}
`;

describe('a PSL MongoDB collection that stores two models', () => {
  it('gets a validator that accepts a document of either model', () => {
    const result = interpretMongoContract(schema, {
      scalarTypes: new Map([
        ['String', 'mongo/string@1'],
        ['Int', 'mongo/int32@1'],
        ['ObjectId', 'mongo/objectId@1'],
      ]),
      defaultFunctionRegistry: new Map(),
      codecLookup: mongoCodecLookup,
      dataTypes: mongoDataTypeSupport,
    });
    if (!result.ok) throw new Error(result.failure.summary);

    expect(
      JSON.parse(JSON.stringify(result.value.storage)).namespaces.__unbound__.entries.collection,
    ).toEqual({
      users: {
        kind: 'mongo-collection',
        validator: {
          kind: 'mongo-validator',
          validationLevel: 'strict',
          validationAction: 'error',
          jsonSchema: {
            bsonType: 'object',
            anyOf: [
              {
                bsonType: 'object',
                additionalProperties: false,
                required: ['_id', 'level'],
                properties: { _id: { bsonType: 'objectId' }, level: { bsonType: 'int' } },
              },
              {
                bsonType: 'object',
                additionalProperties: false,
                required: ['_id', 'email'],
                properties: { _id: { bsonType: 'objectId' }, email: { bsonType: 'string' } },
              },
            ],
          },
        },
      },
    });
  });
});
