import { type ContractModel, coreHash, crossRef, profileHash } from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import type { MongoContract, MongoModelStorage } from '../src/contract-types';
import { buildMongoNamespace } from '../src/ir/build-mongo-namespace';
import { MongoCollection } from '../src/ir/mongo-collection';
import { MongoStorage } from '../src/ir/mongo-storage';
import { mongoValueSetsOf } from '../src/mongo-enum';
import { modelAndBasesOf } from '../src/mongo-models';
import { validateMongoStorage } from '../src/validate-storage';
import { derive, model, objectId } from './collection-validator-helpers';

const id = {
  type: { kind: 'scalar', codecId: 'mongo/objectId@1' },
  nullable: false,
  many: false,
} as const;

function contractOf(
  models: Record<string, ContractModel<MongoModelStorage>>,
  collections: readonly string[],
): MongoContract {
  return {
    target: 'mongo',
    targetFamily: 'mongo',
    roots: {},
    storage: new MongoStorage({
      storageHash: coreHash('test'),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: buildMongoNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            collection: Object.fromEntries(
              collections.map((name) => [name, new MongoCollection()]),
            ),
          },
        }),
      },
    }),
    domain: applicationDomainOf({ models }),
    capabilities: {},
    extensions: {},
    profileHash: profileHash('test'),
    meta: {},
  };
}

function item(
  extra: Partial<ContractModel<MongoModelStorage>> = {},
): ContractModel<MongoModelStorage> {
  return {
    fields: { _id: id },
    storage: { fields: { _id: { field: '_id' } }, collection: 'items' },
    relations: {},
    ...extra,
  };
}

describe('names every object has as a property', () => {
  it('are no fields of a model a reference relation names', () => {
    const contract = contractOf(
      {
        Item: item({
          relations: {
            owner: {
              to: crossRef('Item'),
              cardinality: 'N:1',
              nullable: false,
              on: { localFields: ['constructor'], targetFields: ['toString'] },
            },
          },
        }),
      },
      ['items'],
    );
    expect(() => validateMongoStorage(contract)).toThrow(
      /localField "constructor" is not a field[\s\S]*targetField "toString" is not a field/,
    );
  });

  it('are no model a variant names as its base', () => {
    const contract = contractOf({ Item: item({ base: crossRef('constructor') }) }, ['items']);
    expect(() => validateMongoStorage(contract)).not.toThrow(TypeError);
  });

  it('are no model in the chain of bases', () => {
    expect(modelAndBasesOf({ Item: item() }, 'constructor')).toEqual([]);
  });

  it('name a collection validator and a value set as own keys', () => {
    const validators = derive({
      roots: { ['__proto__']: crossRef('User'), constructor: crossRef('Post') },
      models: { User: model({ _id: objectId() }), Post: model({ _id: objectId() }) },
    });
    const valueSets = mongoValueSetsOf(
      Object.fromEntries([['__proto__', { codecId: 'mongo/string@1', members: [] }]]),
    );
    expect({
      validators: Object.keys(validators),
      valueSets: Object.keys(valueSets),
    }).toEqual({ validators: ['__proto__', 'constructor'], valueSets: ['__proto__'] });
  });
});
