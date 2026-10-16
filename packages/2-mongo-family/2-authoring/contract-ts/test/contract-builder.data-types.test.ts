import { type AnyCodecDescriptor, dataType } from '@internal/framework-components/codec';
import type {
  ExtensionPackRef,
  FamilyPackRef,
  TargetPackRef,
} from '@internal/framework-components/components';
import { blindCast } from '@internal/utils/casts';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { defineContract } from '../src/contract-builder';

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
  dataTypes: [dataType('mongo/string', {})],
} as const satisfies TargetPackRef<'mongo', 'mongo'>;

const duplicateString = {
  kind: 'extension',
  id: 'duplicate-string',
  familyId: 'mongo',
  targetId: 'mongo',
  version: '0.0.1',
  dataTypes: [dataType('mongo/string', {})],
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

const vectorParams = type({ 'length?': 'number.integer >= 1' });

const vectorTargetPack = {
  kind: 'target',
  id: 'mongo',
  familyId: 'mongo',
  targetId: 'mongo',
  version: '0.0.1',
  defaultNamespaceId: '__unbound__',
  dataTypes: [dataType('mongo/vector', { params: vectorParams })],
  types: {
    codecTypes: {
      codecDescriptors: [
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

describe('mongo defineContract type parameters', () => {
  const build = (length: number, inValueObject = false) =>
    defineContract(
      { family: mongoFamilyPack, target: vectorTargetPack },
      ({ field, model, valueObject }) => {
        const Embedding = valueObject('Embedding', {
          fields: { values: field.vector({ typeParams: { length } }) },
        });
        return {
          models: {
            Doc: model('Doc', {
              collection: 'docs',
              fields: inValueObject
                ? { _id: field.objectId(), embedding: field.valueObject(Embedding) }
                : { _id: field.objectId(), embedding: field.vector({ typeParams: { length } }) },
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
