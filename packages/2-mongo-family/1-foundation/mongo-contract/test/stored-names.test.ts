import { asNamespaceId, type ContractModel, crossRef } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import type { MongoModelStorage } from '../src/contract-types';
import { modelAndBasesOf, mongoModelsOf } from '../src/mongo-models';
import {
  hasOwnFieldStoredAs,
  ownDocumentIdFieldOf,
  ownEmbedStoredNamesOf,
  ownFieldStoredAs,
  ownStoredNameOf,
  ownStoredNamesOf,
  storedNamesOf,
  valueObjectStoredNamesOf,
} from '../src/stored-names';
import { scalarField } from './derive-json-schema-helpers';

const user: ContractModel<MongoModelStorage> = {
  fields: { id: scalarField('mongo/objectId@1'), email: scalarField('mongo/string@1') },
  relations: {
    addresses: { to: crossRef('Address'), cardinality: '1:N' },
    tags: { to: crossRef('Tag'), cardinality: '1:N' },
  },
  storage: {
    collection: 'users',
    fields: { id: { field: '_id' }, email: { field: 'email' } },
    relations: { addresses: { field: 'user_addresses' } },
  },
};

const admin: ContractModel<MongoModelStorage> = {
  fields: { level: scalarField('mongo/int32@1') },
  relations: {},
  storage: { collection: 'users', fields: { level: { field: 'admin_level' } } },
  base: { namespace: asNamespaceId('__unbound__'), model: 'User' },
};

const models = { User: user, Admin: admin };

describe('stored names', () => {
  it("reads the stored name of each of a model's own fields from its storage", () => {
    expect(ownStoredNamesOf(user)).toEqual({ id: '_id', email: 'email' });
  });

  it('stores each field of a value object under its own name', () => {
    expect(valueObjectStoredNamesOf({ fields: { street: scalarField('mongo/string@1') } })).toEqual(
      { street: 'street' },
    );
  });

  it('refuses a model field without a storage entry', () => {
    const broken = { ...user, storage: { collection: 'users', fields: {} } };
    expect(() => ownStoredNamesOf(broken)).toThrow(
      'Field "id" has no entry in its model\'s storage.fields',
    );
  });

  it('gives the stored name of one own field, and refuses a name that is not one', () => {
    expect(ownStoredNameOf(user, 'id')).toBe('_id');
    expect(() => ownStoredNameOf(user, '_id')).toThrow('Model has no field "_id"');
  });

  it('finds the own field stored under a stored name', () => {
    expect([ownFieldStoredAs(user, '_id'), ownFieldStoredAs(user, 'id')]).toEqual([
      'id',
      undefined,
    ]);
    expect([hasOwnFieldStoredAs(user, '_id'), hasOwnFieldStoredAs(user, 'id')]).toEqual([
      true,
      false,
    ]);
  });

  it('finds the field stored as _id', () => {
    expect(ownDocumentIdFieldOf(user)).toEqual({
      name: 'id',
      field: scalarField('mongo/objectId@1'),
    });
    expect(ownDocumentIdFieldOf(admin)).toBeUndefined();
  });

  it('gives the stored name of each embed relation, its own name without a storage entry', () => {
    expect(ownEmbedStoredNamesOf(user)).toEqual({ addresses: 'user_addresses', tags: 'tags' });
  });

  it('walks a model and its base models, nearest first', () => {
    expect(modelAndBasesOf(models, 'Admin')).toEqual([admin, user]);
  });

  it('includes the fields a variant inherits from its base', () => {
    expect(storedNamesOf(models, 'Admin')).toEqual({
      id: '_id',
      email: 'email',
      level: 'admin_level',
    });
  });

  it('reads the models of a namespace as MongoDB models', () => {
    expect(mongoModelsOf({ namespaces: { __unbound__: { models } } }, '__unbound__')).toBe(models);
  });
});
