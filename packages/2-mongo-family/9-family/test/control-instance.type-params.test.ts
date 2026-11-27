import type { ContractModelBase } from '@internal/contract/types';
import { UNBOUND_DOMAIN_NAMESPACE_ID } from '@internal/contract/types';
import {
  type CodecLookupWithDescriptors,
  createDataTypeLookup,
} from '@internal/framework-components/codec';
import { type ControlStack, createControlStack } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { mongoDataType } from '@internal/mongo-contract/data-type';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { mongoFamilyDescriptor } from '../src/core/control-descriptor';
import { createMongoFamilyInstance } from '../src/core/control-instance';
import { mongoContractJson } from './mongo-contract-json-fixture';
import { stubMongoTargetDescriptor } from './test-target-descriptor';

const VECTOR_CODEC_ID = 'test/vector@1';

const vectorType = mongoDataType('test/vector', {
  read: (json) => json,
  bsonTypes: ['array'],
  params: type({ '+': 'reject', length: 'number' }),
});

const codecLookup: CodecLookupWithDescriptors = {
  get: () => undefined,
  renderOutputTypeFor: () => undefined,
  descriptorFor: (codecId) =>
    codecId === VECTOR_CODEC_ID
      ? {
          codecId,
          dataType: vectorType.id,
          traits: [],
          paramsSchema: undefined,
          isParameterized: true,
          factory: () => () => {
            throw new Error('not used');
          },
        }
      : undefined,
};

function familyInstance() {
  const stack = createControlStack({
    family: mongoFamilyDescriptor,
    target: stubMongoTargetDescriptor,
  });
  const withVector: ControlStack<'mongo', 'mongo'> = {
    ...stack,
    codecLookup: { ...stack.codecLookup, ...codecLookup },
    dataTypes: { ...stack.dataTypes, lookup: createDataTypeLookup([vectorType]) },
  };
  return createMongoFamilyInstance(withVector);
}

const vectorField = (typeParams: Record<string, unknown>) => ({
  type: { kind: 'scalar', codecId: VECTOR_CODEC_ID, typeParams },
  nullable: false,
  many: false,
});

function withModelField(typeParams: Record<string, unknown>) {
  return mongoContractJson({
    models: {
      Item: {
        fields: {
          _id: { type: { kind: 'scalar', codecId: 'mongo/objectId@1' }, nullable: false },
          embedding: vectorField(typeParams),
        },
        storage: {
          fields: { _id: { field: '_id' }, embedding: { field: 'embedding' } },
          collection: 'items',
        },
      } as unknown as ContractModelBase,
    },
  });
}

describe('deserializeContract checks type parameters against their data type', () => {
  const refusal = 'test/vector: zzz must be removed';

  it('accepts a model field whose parameters its data type defines', () => {
    expect(() => familyInstance().deserializeContract(withModelField({ length: 3 }))).not.toThrow();
  });

  it('refuses a model field with a parameter its data type does not define, naming the field', () => {
    expect(() =>
      familyInstance().deserializeContract(withModelField({ length: 3, zzz: 1 })),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.VALIDATION_FAILED',
        message: expect.stringContaining(
          `domain.namespaces.${UNBOUND_DOMAIN_NAMESPACE_ID}.models.Item.fields.embedding.type.typeParams: ${refusal}`,
        ),
      }),
    );
  });

  it('refuses a value-object field with a parameter its data type does not define', () => {
    const contract = mongoContractJson({
      storageValueObjects: {
        Point: { fields: { coordinates: vectorField({ length: 2, zzz: 1 }) } },
      },
    });
    expect(() => familyInstance().deserializeContract(contract)).toThrow(
      expect.objectContaining({
        message: expect.stringContaining(
          `storage.namespaces.${UNBOUND_NAMESPACE_ID}.entries.valueObject.Point.fields.coordinates.type.typeParams: ${refusal}`,
        ),
      }),
    );
  });
});
