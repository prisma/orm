import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { mongoCodecLookup } from '@internal/mongo-contract/test';
import { describe, expect, it } from 'vitest';
import { interpretMongoContract } from './interpreter-test-helpers';
import { mongoDataTypeSupport } from './mongo-type-lookups';

const SCHEMA = `type NavItem {
  label    String
  children NavItem[]
}

model Menu {
  id    ObjectId @id @map("_id")
  items NavItem[]

  @@map("menus")
}
`;

function interpretMenu() {
  const result = interpretMongoContract(SCHEMA, {
    scalarTypes: new Map([
      ['String', 'mongo/string@1'],
      ['ObjectId', 'mongo/objectId@1'],
    ]),
    defaultFunctionRegistry: new Map(),
    codecLookup: mongoCodecLookup,
    dataTypes: mongoDataTypeSupport,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.failure));
  return result.value;
}

describe('a composite type that contains itself', () => {
  it('gives the collection a validator that accepts any object where the type repeats', () => {
    const emittedStorage: unknown = interpretMenu().storage;
    const storage = emittedStorage as {
      namespaces: Record<
        string,
        { entries: { collection: Record<string, { validator?: unknown }> } }
      >;
    };

    expect(
      storage.namespaces[UNBOUND_NAMESPACE_ID]?.entries.collection['menus']?.validator,
    ).toMatchObject({
      jsonSchema: {
        bsonType: 'object',
        required: ['_id', 'items'],
        properties: {
          _id: { bsonType: 'objectId' },
          items: {
            bsonType: 'array',
            items: {
              bsonType: 'object',
              required: ['children', 'label'],
              properties: {
                label: { bsonType: 'string' },
                children: { bsonType: 'array', items: { bsonType: 'object' } },
              },
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      },
      validationLevel: 'strict',
      validationAction: 'error',
    });
  });
});
