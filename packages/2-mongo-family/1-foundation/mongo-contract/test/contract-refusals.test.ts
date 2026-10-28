import { type ContractModel, crossRef } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import { mongoContractRefusalsOf } from '../src/contract-refusals';
import type { MongoModelStorage } from '../src/contract-types';
import { mongoTypeLookups } from '../src/fake-type-lookups';
import {
  arrayField,
  enumField,
  memberEnumField,
  scalarField,
  voField,
} from './derive-json-schema-helpers';

function model(
  fields: ContractModel<MongoModelStorage>['fields'],
  {
    storage,
    ...extra
  }: Partial<Omit<ContractModel<MongoModelStorage>, 'storage'>> & {
    readonly storage?: Partial<MongoModelStorage>;
  } = {},
): ContractModel<MongoModelStorage> {
  const identity = Object.fromEntries(Object.keys(fields).map((name) => [name, { field: name }]));
  return { fields, relations: {}, storage: { fields: identity, ...storage }, ...extra };
}

function refusals(input: Partial<Parameters<typeof mongoContractRefusalsOf>[0]>) {
  return mongoContractRefusalsOf({
    models: {},
    valueObjects: {},
    enums: {},
    lookups: mongoTypeLookups,
    controlPolicies: { collections: {}, defaultControlPolicy: undefined },
    ...input,
  });
}

describe('mongoContractRefusalsOf', () => {
  it('accepts a root model without an _id', () => {
    expect(
      refusals({
        models: {
          Note: model(
            { text: scalarField('mongo/string@1') },
            { storage: { collection: 'notes' } },
          ),
        },
      }),
    ).toEqual([]);
  });

  it('refuses each root model whose _id can hold a BSON type an _id cannot have, in every collection', () => {
    expect(
      refusals({
        models: {
          User: model(
            { _id: scalarField('mongo/string@1', true) },
            { storage: { collection: 'users' } },
          ),
          Admin: model(
            { _id: scalarField('mongo/string@1') },
            { storage: { collection: 'users' } },
          ),
          Event: model({ _id: arrayField('mongo/date@1') }, { storage: { collection: 'events' } }),
          Blob: model({ _id: scalarField('mongo/json@1') }, { storage: { collection: 'blobs' } }),
          Tick: model({ _id: scalarField('mongo/date@1') }, { storage: { collection: 'ticks' } }),
        },
      }),
    ).toEqual([
      expect.objectContaining({
        kind: 'documentId',
        modelName: 'User',
        fieldName: '_id',
        collection: 'users',
        forbidden: ['null'],
      }),
      expect.objectContaining({ modelName: 'Event', collection: 'events', forbidden: ['array'] }),
      expect.objectContaining({
        modelName: 'Blob',
        codecId: 'mongo/json@1',
        forbidden: ['array', 'null'],
      }),
    ]);
  });

  it('names the field stored as _id by its own name', () => {
    expect(
      refusals({
        models: {
          User: model(
            { id: scalarField('mongo/string@1', true) },
            { storage: { collection: 'users', fields: { id: { field: '_id' } } } },
          ),
        },
      }),
    ).toEqual([
      expect.objectContaining({
        kind: 'documentId',
        modelName: 'User',
        fieldName: 'id',
        collection: 'users',
      }),
    ]);
  });

  it('leaves an _id with an unknown codec to the field rule', () => {
    expect(
      refusals({
        models: {
          User: model({ _id: scalarField('geo/id@1') }, { storage: { collection: 'users' } }),
        },
      }),
    ).toEqual([
      {
        kind: 'fieldBsonType',
        owner: { kind: 'model', name: 'User' },
        fieldName: '_id',
        codecId: 'geo/id@1',
        refusal: {
          kind: 'unknownCodec',
          reason:
            'uses codec "geo/id@1", which no pack in the contract provides, so its BSON type is unknown and the contract cannot describe the field.',
        },
      },
    ]);
  });

  it('refuses a value object field whose codec has no MongoDB data type', () => {
    expect(
      refusals({ valueObjects: { Address: { fields: { zip: scalarField('geo/zip@1') } } } }),
    ).toEqual([
      expect.objectContaining({
        kind: 'fieldBsonType',
        owner: { kind: 'valueObject', name: 'Address' },
        fieldName: 'zip',
      }),
    ]);
  });

  const unlistableEnums = {
    Big: { codecId: 'mongo/int64@1', members: [{ name: 'One', value: 1 }] },
    Ratio: { codecId: 'mongo/double@1', members: [{ name: 'All', value: '1' }] },
  };

  it('accepts an enum a validator cannot list when no validated collection stores it', () => {
    expect(
      refusals({
        enums: unlistableEnums,
        models: {
          Job: model(
            {
              size: enumField('mongo/int64@1', 'Big'),
              ratio: enumField('mongo/double@1', 'Ratio'),
            },
            { storage: { collection: 'jobs' } },
          ),
        },
        controlPolicies: { collections: { jobs: 'external' }, defaultControlPolicy: undefined },
      }),
    ).toEqual([]);
  });

  it('refuses an enum a validator cannot list, used by a value object member through its storage value set', () => {
    expect(
      refusals({
        enums: unlistableEnums,
        valueObjects: {
          Sizing: {
            fields: {
              size: memberEnumField('mongo/int64@1', 'Big'),
              ratio: memberEnumField('mongo/double@1', 'Ratio'),
            },
          },
        },
        models: {
          Job: model({ sizing: voField('Sizing') }, { storage: { collection: 'jobs' } }),
        },
      }),
    ).toEqual([
      expect.objectContaining({ kind: 'enumNotListable', enumName: 'Big' }),
      expect.objectContaining({ kind: 'enumMemberNotListable', enumName: 'Ratio' }),
    ]);
  });

  it('refuses an enum a validator cannot list, and a member it cannot list', () => {
    expect(
      refusals({
        models: {
          Job: model(
            {
              size: enumField('mongo/int64@1', 'Big'),
              ratio: enumField('mongo/double@1', 'Ratio'),
            },
            { storage: { collection: 'jobs' } },
          ),
        },
        enums: {
          Big: { codecId: 'mongo/int64@1', members: [{ name: 'One', value: 1 }] },
          Ratio: { codecId: 'mongo/double@1', members: [{ name: 'All', value: '1' }] },
        },
      }),
    ).toEqual([
      {
        kind: 'enumNotListable',
        enumName: 'Big',
        codecId: 'mongo/int64@1',
        reason:
          'stores BSON type long, which a collection validator cannot list as an enum value. Use a codec whose BSON type is string, int, double, bool, object or array.',
      },
      {
        kind: 'enumMemberNotListable',
        enumName: 'Ratio',
        member: 'All',
        codecId: 'mongo/double@1',
        reason:
          'is stored as "1", which a collection validator cannot list as a double. A member of a double enum must be a finite number.',
      },
    ]);
  });

  it('refuses an embed relation to a model with variants', () => {
    expect(
      refusals({
        models: {
          Owner: model(
            { _id: scalarField('mongo/objectId@1') },
            {
              storage: { collection: 'owners' },
              relations: { task: { to: crossRef('Task'), cardinality: '1:1' } },
            },
          ),
          Task: model(
            { type: scalarField('mongo/string@1') },
            {
              owner: 'Owner',
              discriminator: { field: 'type' },
              variants: { bug: crossRef('Bug') },
            },
          ),
          Bug: model({}, { base: crossRef('Task') }),
        },
      }),
    ).toEqual([
      {
        kind: 'embeddedModelHasVariants',
        modelName: 'Owner',
        relationName: 'task',
        embeddedModel: 'Task',
        reason:
          'embeds model "Task", which has variants. The ORM reads and writes only the base fields of an embedded model, so an embedded model cannot have variants.',
      },
    ]);
  });
});
