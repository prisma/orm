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
});

const codecLookup: CodecLookupWithDescriptors = {
  ...mongoCodecLookup,
  descriptorFor: (id) =>
    id === 'test/vector@1'
      ? ({ codecId: id, dataType: vector.id, traits: [] } as unknown as AnyCodecDescriptor)
      : mongoCodecLookup.descriptorFor(id),
};

const dataTypeLookup = createDataTypeLookup([vector]);

function vectorPreset(length: number): AuthoringContributions {
  return {
    field: {
      embedding: {
        kind: 'fieldPreset',
        output: { codecId: 'test/vector@1', typeParams: { length } },
      },
    },
  };
}

function interpret(length: number) {
  return interpretMongoContract(
    `model Doc {
  id     ObjectId    @id @map("_id")
  values embedding()
}
`,
    {
      scalarTypeCodecIds: new Map([['ObjectId', 'mongo/objectId@1']]),
      defaultFunctionRegistry: new Map(),
      codecLookup,
      dataTypes: {
        entries: {},
        lookup: {
          get: (id) => dataTypeLookup.get(id) ?? mongoDataTypeLookup.get(id),
          has: (id) => dataTypeLookup.has(id) || mongoDataTypeLookup.has(id),
        },
      },
      authoringContributions: vectorPreset(length),
    },
  );
}

describe('Mongo PSL field type parameters', () => {
  it('keeps type parameters the data type accepts', () => {
    const result = interpret(3);
    if (!result.ok) throw new Error(JSON.stringify(result.failure));
    expect(result.value.domain.namespaces['__unbound__']?.models['Doc']?.fields['values']).toEqual({
      nullable: false,
      many: false,
      type: { kind: 'scalar', codecId: 'test/vector@1', typeParams: { length: 3 } },
    });
  });

  it.each([0, -1, 2.5])('reports a length of %s as a diagnostic at the field', (length) => {
    const result = interpret(length);
    if (result.ok) throw new Error('Expected interpretation to fail');
    expect(result.failure.diagnostics).toEqual([
      expect.objectContaining({
        code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
        message: expect.stringMatching(
          /^Field "Doc\.values" uses field preset "embedding", whose type parameters are refused: test\/vector: length /,
        ),
        span: expect.objectContaining({ start: expect.any(Object) }),
      }),
    ]);
  });
});
