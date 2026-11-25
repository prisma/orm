import { assembleDataTypeSupport } from '@internal/framework-components/authoring';
import { extractCodecLookup } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { MongoContract } from '@internal/mongo-contract';
import { describe, expect, it } from 'vitest';
import { buildMongoContractFromDefinition } from '../src/build-contract';
import { defineContract, field, model, valueObject } from '../src/contract-builder';
import type { ContractDefinition, FieldNode, ModelNode } from '../src/contract-definition';
import { enumType, member } from '../src/enum-type';
import { nameIndexes } from '../src/name-indexes';
import { refusalError } from '../src/refusal-errors';
import { mongoFamilyPack, mongoTargetPack, type } from './mongo-test-packs';

const codecLookup = extractCodecLookup([mongoFamilyPack, mongoTargetPack]);
const { support: dataTypes } = assembleDataTypeSupport(
  [mongoFamilyPack, mongoTargetPack],
  (codecId) => codecLookup.descriptorFor(codecId)?.dataType,
);
const id: FieldNode = {
  fieldName: '_id',
  type: field.scalar(type.ObjectId()).__type,
  nullable: false,
  many: false,
};
const street: FieldNode = {
  fieldName: 'street',
  type: field.scalar(type.String()).__type,
  nullable: false,
  many: false,
};

function stored(
  modelName: string,
  collection: string,
  fields: readonly FieldNode[] = [],
): ModelNode {
  return { modelName, collection, fields: [id, ...fields] };
}

function build(overrides: Partial<ContractDefinition>) {
  return buildMongoContractFromDefinition(
    nameIndexes({
      target: mongoTargetPack,
      models: [],
      writesCollectionValidators: true,
      warnings: undefined,
      ...overrides,
    }),
    codecLookup,
    dataTypes,
  );
}

function contractOf(overrides: Partial<ContractDefinition>): MongoContract {
  const built = build(overrides);
  if (!built.ok) throw new Error(`refused: ${JSON.stringify(built.failure.refusals)}`);
  return built.value.contract;
}

function collectionsOf(contract: MongoContract) {
  return contract.storage.namespaces[UNBOUND_NAMESPACE_ID]?.entries['collection'] ?? {};
}

describe('Mongo contract names every object has as a property', () => {
  it('builds a model, value object and collection named constructor', () => {
    const contract = contractOf({
      models: [
        stored('constructor', 'constructor', [
          {
            fieldName: 'home',
            type: field.valueObject(valueObject('toString', { fields: {} })).__type,
            nullable: false,
            many: false,
          },
        ]),
      ],
      valueObjects: [{ name: 'toString', fields: [street] }],
    });
    expect({
      models: Object.keys(contract.domain.namespaces[UNBOUND_NAMESPACE_ID]?.models ?? {}),
      collections: Object.keys(collectionsOf(contract)),
      valueObjects: Object.keys(
        contract.storage.namespaces[UNBOUND_NAMESPACE_ID]?.entries['valueObject'] ?? {},
      ),
      roots: Object.keys(contract.roots),
      validator: 'validator' in (collectionsOf(contract)['constructor'] ?? {}),
    }).toEqual({
      models: ['constructor'],
      collections: ['constructor'],
      valueObjects: ['toString'],
      roots: ['constructor'],
      validator: true,
    });
  });

  it('refuses a field named __proto__ of a model or value object, whatever name stores it', () => {
    const proto: FieldNode = { ...street, fieldName: '__proto__', storedName: 'proto' };
    const built = build({
      models: [stored('User', 'users', [proto])],
      valueObjects: [{ name: 'Address', fields: [{ ...street, fieldName: '__proto__' }] }],
    });
    const reason =
      'is named "__proto__", which JavaScript reads as the prototype of an object rather than as a key. Choose another name.';
    expect(
      (built.ok ? [] : built.failure.refusals).map((refusal) => {
        const error = refusalError(refusal);
        return { code: error.code, message: error.message, meta: error.meta };
      }),
    ).toEqual([
      {
        code: 'CONTRACT.NAME_UNUSABLE_AS_KEY',
        message: `A field of model "User" ${reason}`,
        meta: { name: '__proto__', kind: 'field', modelName: 'User', reason: 'name-not-a-key' },
      },
      {
        code: 'CONTRACT.NAME_UNUSABLE_AS_KEY',
        message: `A field of value object "Address" ${reason}`,
        meta: {
          name: '__proto__',
          kind: 'valueObjectField',
          valueObjectName: 'Address',
          reason: 'name-not-a-key',
        },
      },
    ]);
  });

  const objectId: FieldNode = { ...id, fieldName: 'userId' };

  it.each<[string, readonly ModelNode[]]>([
    [
      'a reference relation',
      [
        {
          ...stored('User', 'users', [{ ...objectId, fieldName: 'postId' }]),
          relations: [
            {
              relationName: '__proto__',
              toModel: 'Post',
              cardinality: 'N:1',
              nullable: false,
              on: { localFields: ['postId'], targetFields: ['_id'] },
            },
          ],
        },
        stored('Post', 'posts'),
      ],
    ],
    [
      'an embed relation',
      [
        {
          ...stored('User', 'users'),
          relations: [
            { relationName: '__proto__', toModel: 'Address', cardinality: '1:1', nullable: false },
          ],
        },
        { modelName: 'Address', owner: 'User', fields: [street] },
      ],
    ],
    [
      'a back relation',
      [
        {
          ...stored('User', 'users'),
          relations: [
            {
              relationName: '__proto__',
              toModel: 'Post',
              cardinality: '1:N',
              nullable: undefined,
              on: { localFields: ['_id'], targetFields: ['userId'] },
            },
          ],
        },
        stored('Post', 'posts', [objectId]),
      ],
    ],
  ])('refuses %s named __proto__', (_, models) => {
    const built = build({ models });
    expect(
      (built.ok ? [] : built.failure.refusals).map((refusal) => {
        const error = refusalError(refusal);
        return { code: error.code, message: error.message, meta: error.meta };
      }),
    ).toEqual([
      {
        code: 'CONTRACT.NAME_UNUSABLE_AS_KEY',
        message:
          'A relation of model "User" is named "__proto__", which JavaScript reads as the prototype of an object rather than as a key. Choose another name.',
        meta: { name: '__proto__', kind: 'relation', modelName: 'User', reason: 'name-not-a-key' },
      },
    ]);
  });

  it('refuses an embed relation stored as __proto__', () => {
    const built = build({
      models: [
        {
          ...stored('User', 'users'),
          storageRelations: { address: { field: '__proto__' } },
          relations: [
            { relationName: 'address', toModel: 'Address', cardinality: '1:1', nullable: false },
          ],
        },
        { modelName: 'Address', owner: 'User', fields: [street] },
      ],
    });
    expect(
      (built.ok ? [] : built.failure.refusals).map((refusal) => {
        const error = refusalError(refusal);
        return { code: error.code, message: error.message, meta: error.meta };
      }),
    ).toEqual([
      {
        code: 'CONTRACT.ARGUMENT_INVALID',
        message:
          'Model "User" relation "address" is stored as "__proto__", which JavaScript reads as the prototype of an object rather than as a key. Give it another stored name.',
        meta: { modelName: 'User', relationName: 'address', reason: 'stored-name-unsupported' },
      },
    ]);
  });

  it('gives a collection named constructor no validator when the definition writes none', () => {
    const contract = contractOf({
      models: [stored('constructor', 'constructor')],
      writesCollectionValidators: false,
    });
    expect(collectionsOf(contract)['constructor']).not.toHaveProperty('validator');
  });

  it('refuses __proto__ as the name of a model, collection, value object, enum or root', () => {
    const Proto = enumType('__proto__', { codecId: 'mongo/string@1' }, member('A', 'a'));
    const built = build({
      models: [stored('__proto__', 'users'), stored('User', '__proto__')],
      valueObjects: [{ name: '__proto__', fields: [street] }],
      enums: Object.fromEntries([['__proto__', Proto]]),
      roots: Object.fromEntries([['__proto__', 'User']]),
    });
    const reason =
      'is named "__proto__", which JavaScript reads as the prototype of an object rather than as a key. Choose another name.';
    const refused = (message: string, meta: Record<string, string>) => ({
      code: 'CONTRACT.NAME_UNUSABLE_AS_KEY',
      message: `${message} ${reason}`,
      meta: { name: '__proto__', ...meta, reason: 'name-not-a-key' },
    });
    expect(
      (built.ok ? [] : built.failure.refusals).map((refusal) => {
        const error = refusalError(refusal);
        return { code: error.code, message: error.message, meta: error.meta };
      }),
    ).toEqual([
      refused('A model', { kind: 'model' }),
      refused('The collection of model "User"', { kind: 'collection', modelName: 'User' }),
      refused('A value object', { kind: 'valueObject' }),
      refused('An enum', { kind: 'enum' }),
      refused('A root of model "User"', { kind: 'root', modelName: 'User' }),
    ]);
  });

  it('tells the author which name to change', () => {
    const User = model('User', {
      collection: '__proto__',
      fields: { _id: field.scalar(type.ObjectId()) },
    });
    expect(() =>
      defineContract({ family: mongoFamilyPack, target: mongoTargetPack, models: { User } }),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.NAME_UNUSABLE_AS_KEY',
        message:
          'The collection of model "User" is named "__proto__", which JavaScript reads as the prototype of an object rather than as a key. Choose another name.',
        meta: {
          name: '__proto__',
          kind: 'collection',
          modelName: 'User',
          reason: 'name-not-a-key',
        },
      }),
    );
  });
});
