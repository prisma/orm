import { type AnyCodecDescriptor, dataType } from '@internal/framework-components/codec';
import type {
  ExtensionPackRef,
  FamilyPackRef,
  TargetPackRef,
} from '@internal/framework-components/components';
import { mongoDataType } from '@internal/mongo-contract/data-type';
import { mongoTestCodecDescriptors, mongoTestDataTypes } from '@internal/mongo-contract/test';
import { blindCast } from '@internal/utils/casts';
import { type as arktype } from 'arktype';
import { describe, expect, it } from 'vitest';
import { defineContract } from '../src/contract-builder';
import { mongoTargetPack as testTargetPack } from './mongo-test-packs';

const mongoFamilyPack = {
  kind: 'family',
  id: 'mongo',
  familyId: 'mongo',
  version: '0.0.1',
} as const satisfies FamilyPackRef<'mongo'>;

const mongoTargetPack = {
  kind: 'target',
  id: 'mongo',
  familyId: 'mongo',
  targetId: 'mongo',
  version: '0.0.1',
  defaultNamespaceId: '__unbound__',
  dataTypes: [dataType('mongo/string', { read: (json) => json })],
} as const satisfies TargetPackRef<'mongo', 'mongo'>;

const duplicateString = {
  kind: 'extension',
  id: 'duplicate-string',
  familyId: 'mongo',
  targetId: 'mongo',
  version: '0.0.1',
  dataTypes: [dataType('mongo/string', { read: (json) => json })],
} as const satisfies ExtensionPackRef<'mongo', 'mongo'>;

describe('mongo defineContract data types', () => {
  it('refuses an extension that registers a data type the target already registers', () => {
    expect(() =>
      defineContract(
        { family: mongoFamilyPack, target: mongoTargetPack, extensions: { duplicateString } },
        () => ({ models: {} }),
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.DATA_TYPE_DUPLICATE',
        details: expect.objectContaining({
          dataType: 'mongo/string',
          contributedBy: 'duplicate-string',
        }),
      }),
    );
  });
});

const vectorParams = arktype({ 'length?': 'number.integer >= 1' });

const vectorTargetPack = {
  ...testTargetPack,
  dataTypes: [
    ...mongoTestDataTypes.filter((each) => each.id !== 'mongo/vector'),
    mongoDataType('mongo/vector', {
      params: vectorParams,
      bsonTypes: ['array'],
      read: (json) => json,
    }),
  ],
  types: {
    codecTypes: {
      codecDescriptors: [
        ...mongoTestCodecDescriptors.filter((each) => each.codecId !== 'mongo/vector@1'),
        blindCast<
          AnyCodecDescriptor,
          'a test descriptor needs only the id, the data type and the parameter flag the build reads'
        >({
          codecId: 'mongo/vector@1',
          dataType: 'mongo/vector',
          traits: ['equality'],
          paramsSchema: vectorParams,
          isParameterized: true,
          factory: () => () => ({}),
        }),
      ],
    },
  },
} as const satisfies TargetPackRef<'mongo', 'mongo'>;

const vectorOfLength = (length: number) =>
  ({ kind: 'scalar', codecId: 'mongo/vector@1', typeParams: { length } }) as const;

describe('mongo defineContract type parameters', () => {
  const build = (length: number, inValueObject = false) =>
    defineContract(
      { family: mongoFamilyPack, target: vectorTargetPack },
      ({ field, model, valueObject, type }) => {
        const Embedding = valueObject('Embedding', {
          fields: { values: field.scalar(vectorOfLength(length)) },
        });
        return {
          models: {
            Doc: model('Doc', {
              collection: 'docs',
              fields: inValueObject
                ? { _id: field.scalar(type.ObjectId()), embedding: field.valueObject(Embedding) }
                : {
                    _id: field.scalar(type.ObjectId()),
                    embedding: field.scalar(vectorOfLength(length)),
                  },
            }),
          },
          valueObjects: { Embedding },
        };
      },
    );

  it('accepts a vector length its data type allows', () => {
    expect(() => build(3)).not.toThrow();
  });

  it.each([0, -1, 2.5])('refuses a vector length of %s', (length) => {
    expect(() => build(length)).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.TYPE_PARAMS_INVALID',
        meta: expect.objectContaining({
          dataType: 'mongo/vector',
          parameters: ['length'],
          modelName: 'Doc',
          fieldName: 'embedding',
        }),
      }),
    );
  });

  it('refuses one in a value object field', () => {
    expect(() => build(0, true)).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.TYPE_PARAMS_INVALID',
        meta: expect.objectContaining({ valueObjectName: 'Embedding', fieldName: 'values' }),
      }),
    );
  });
});
