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

function refusalsOf(overrides: Partial<ContractDefinition>) {
  const built = build(overrides);
  return built.ok ? [] : built.failure.refusals.map(({ kind, key }) => ({ kind, key }));
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

  it('gives a collection named constructor no validator when the definition writes none', () => {
    const contract = contractOf({
      models: [stored('constructor', 'constructor')],
      writesCollectionValidators: false,
    });
    expect(collectionsOf(contract)['constructor']).not.toHaveProperty('validator');
  });

  it('refuses __proto__ as the name of a model, collection, value object, enum or root', () => {
    const Proto = enumType('__proto__', { codecId: 'mongo/string@1' }, member('A', 'a'));
    expect(
      refusalsOf({
        models: [stored('__proto__', 'users'), stored('User', '__proto__')],
        valueObjects: [{ name: '__proto__', fields: [street] }],
        enums: Object.fromEntries([['__proto__', Proto]]),
        roots: Object.fromEntries([['__proto__', 'User']]),
      }),
    ).toEqual([
      { kind: 'nameUnsupported', key: { kind: 'model', model: '__proto__' } },
      { kind: 'nameUnsupported', key: { kind: 'collectionSettings', model: 'User' } },
      { kind: 'nameUnsupported', key: { kind: 'valueObject', valueObject: '__proto__' } },
      { kind: 'nameUnsupported', key: { kind: 'enum', enumName: '__proto__' } },
      { kind: 'nameUnsupported', key: { kind: 'model', model: 'User' } },
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
        code: 'CONTRACT.ARGUMENT_INVALID',
        message:
          'The collection of model "User" is named "__proto__", which JavaScript reads as the prototype of an object rather than as a key. Choose another name.',
        meta: { kind: 'collection', name: '__proto__', reason: 'name-unsupported' },
      }),
    );
  });
});
