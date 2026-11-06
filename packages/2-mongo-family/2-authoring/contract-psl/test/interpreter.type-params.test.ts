import type { AuthoringContributions } from '@internal/framework-components/authoring';
import {
  type AnyCodecDescriptor,
  type CodecLookupWithDescriptors,
  createDataTypeLookup,
} from '@internal/framework-components/codec';
import { mongoDataType } from '@internal/mongo-contract/data-type';
import { mongoCodecLookup, mongoDataTypeLookup } from '@internal/mongo-contract/test';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { interpretMongoContract } from './interpreter-test-helpers';

const vector = mongoDataType('test/vector', {
  bsonTypes: ['array'],
  params: type({ 'length?': 'number.integer >= 1' }),
  read: (json) => json,
});

const codecLookup: CodecLookupWithDescriptors = {
  ...mongoCodecLookup,
  descriptorFor: (id) =>
    id === 'test/vector@1'
      ? ({ codecId: id, dataType: vector.id, traits: [] } as unknown as AnyCodecDescriptor)
      : mongoCodecLookup.descriptorFor(id),
};

const dataTypeLookup = createDataTypeLookup([vector]);

function interpretSchema(schema: string, authoringContributions: AuthoringContributions) {
  return interpretMongoContract(schema, {
    scalarTypes: new Map([['ObjectId', 'mongo/objectId@1']]),
    defaultFunctionRegistry: new Map(),
    codecLookup,
    dataTypes: {
      entries: {},
      lookup: {
        get: (id) => dataTypeLookup.get(id) ?? mongoDataTypeLookup.get(id),
        has: (id) => dataTypeLookup.has(id) || mongoDataTypeLookup.has(id),
      },
      dataTypeOfCodec: (codecId) => (codecId === 'test/vector@1' ? vector.id : undefined),
    },
    authoringContributions,
  });
}

describe('Mongo PSL field type parameters', () => {
  it('keeps the type parameters of a bare type constructor, on a field and through a types {} alias', () => {
    const result = interpretSchema(
      `types {
  Embedding = Vector3
}

model Doc {
  id      ObjectId  @id @map("_id")
  values  Vector3
  aliased Embedding
}
`,
      {
        type: {
          Vector3: {
            kind: 'typeConstructor',
            output: { codecId: 'test/vector@1', typeParams: { length: 3 } },
          },
        },
      },
    );
    if (!result.ok) throw new Error(JSON.stringify(result.failure));
    const vector3 = {
      nullable: false,
      many: false,
      type: { kind: 'scalar', codecId: 'test/vector@1', typeParams: { length: 3 } },
    };
    expect(result.value.domain.namespaces['__unbound__']?.models['Doc']?.fields).toEqual({
      id: { nullable: false, many: false, type: { kind: 'scalar', codecId: 'mongo/objectId@1' } },
      values: vector3,
      aliased: vector3,
    });
  });

  it('refuses a type constructor with a required argument written without a call', () => {
    const result = interpretSchema(
      `model Doc {
  id     ObjectId @id @map("_id")
  values Sized
}
`,
      {
        type: {
          Sized: {
            kind: 'typeConstructor',
            args: [{ kind: 'value', dataType: 'mongo/int32', name: 'length' }],
            output: { codecId: 'test/vector@1', typeParams: { length: { kind: 'arg', index: 0 } } },
          },
        },
      },
    );
    expect(
      result.ok ? [] : result.failure.diagnostics.map(({ code, message }) => ({ code, message })),
    ).toEqual([
      {
        code: 'PSL_TYPE_CONSTRUCTOR_NOT_CALLED',
        message:
          'Field "Doc.values" uses type constructor "Sized" without arguments. Write Sized(length).',
      },
    ]);
  });
});
