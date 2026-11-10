import type { ExtensionPackRef } from '@internal/framework-components/components';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { buildMongoStorage, MongoValidator } from '@internal/mongo-contract';
import { mongoDataType } from '@internal/mongo-contract/data-type';
import { describe, expect, it } from 'vitest';
import { defineContract, field, model, rel, valueObject } from '../src/contract-builder';
import { enumType, member } from '../src/enum-type';
import {
  identityCodecDescriptor,
  mongoFamilyPack,
  mongoTargetPack,
  type,
} from './mongo-test-packs';

const geoPoint = mongoDataType('geo/point', { read: (json) => json, bsonTypes: ['object'] });

const geoPack = {
  kind: 'extension',
  id: 'geo',
  familyId: 'mongo',
  targetId: 'mongo',
  version: '0.0.1',
  dataTypes: [geoPoint],
  types: {
    codecTypes: { codecDescriptors: [identityCodecDescriptor('geo/point@1', geoPoint)] },
  },
} as const satisfies ExtensionPackRef<'mongo', 'mongo'>;

function collectionsOf(contract: { readonly storage: { readonly namespaces: object } }) {
  return JSON.parse(JSON.stringify(contract.storage.namespaces))[UNBOUND_NAMESPACE_ID].entries
    .collection;
}

describe('mongo defineContract collection validators', () => {
  it('derives each collection validator from its root model', () => {
    const Address = valueObject('Address', {
      fields: { street: field.scalar(type.String()), zip: field.scalar(type.String()).optional() },
    });
    const Role = enumType('Role', { codecId: 'mongo/string@1' }, member('User', 'user'));
    const User = model('User', {
      collection: 'users',
      fields: {
        _id: field.scalar(type.ObjectId()),
        email: field.scalar(type.String()),
        role: field.namedType(Role),
        address: field.valueObject(Address).optional(),
      },
      relations: { notes: rel.hasMany('Note') },
    });
    const Note = model('Note', { owner: User, fields: { text: field.scalar(type.String()) } });

    const contract = defineContract({
      family: mongoFamilyPack,
      target: mongoTargetPack,
      enums: { Role },
      models: { User, Note },
      valueObjects: { Address },
    });

    expect(collectionsOf(contract)).toEqual({
      users: {
        kind: 'mongo-collection',
        validator: {
          kind: 'mongo-validator',
          validationLevel: 'strict',
          validationAction: 'error',
          jsonSchema: {
            bsonType: 'object',
            additionalProperties: false,
            required: ['_id', 'email', 'role'],
            properties: {
              _id: { bsonType: 'objectId' },
              email: { bsonType: 'string' },
              role: { bsonType: 'string', enum: ['user'] },
              address: {
                oneOf: [
                  { bsonType: 'null' },
                  {
                    bsonType: 'object',
                    additionalProperties: false,
                    required: ['street'],
                    properties: {
                      street: { bsonType: 'string' },
                      zip: { bsonType: ['null', 'string'] },
                    },
                  },
                ],
              },
              notes: {
                bsonType: 'array',
                items: {
                  bsonType: 'object',
                  additionalProperties: false,
                  required: ['text'],
                  properties: { text: { bsonType: 'string' } },
                },
              },
            },
          },
        },
      },
    });
  });

  it('describes each variant of a root model in one validator', () => {
    const Task = model('Task', {
      collection: 'tasks',
      fields: { _id: field.scalar(type.ObjectId()), type: field.scalar(type.String()) },
      discriminator: { field: 'type', variants: { Bug: { value: 'bug' } } },
    });
    const Bug = model('Bug', {
      collection: 'tasks',
      base: Task,
      fields: { severity: field.scalar(type.Int32()) },
    });

    const contract = defineContract({
      family: mongoFamilyPack,
      target: mongoTargetPack,
      models: { Task, Bug },
    });

    expect(collectionsOf(contract).tasks.validator.jsonSchema).toEqual({
      bsonType: 'object',
      required: ['_id', 'type'],
      properties: { _id: { bsonType: 'objectId' }, type: { bsonType: 'string' } },
      oneOf: [
        {
          additionalProperties: false,
          required: ['severity', 'type'],
          properties: {
            _id: { bsonType: 'objectId' },
            type: { enum: ['bug'] },
            severity: { bsonType: 'int' },
          },
        },
      ],
    });
  });

  it('accepts a document of any model stored in a collection', () => {
    const User = model('User', {
      collection: 'users',
      fields: { _id: field.scalar(type.ObjectId()), email: field.scalar(type.String()) },
    });
    const Admin = model('Admin', {
      collection: 'users',
      fields: { _id: field.scalar(type.ObjectId()), level: field.scalar(type.Int32()) },
    });

    const contract = defineContract({
      family: mongoFamilyPack,
      target: mongoTargetPack,
      models: { User, Admin },
    });

    expect(collectionsOf(contract).users.validator.jsonSchema).toEqual({
      bsonType: 'object',
      anyOf: [
        {
          bsonType: 'object',
          additionalProperties: false,
          required: ['_id', 'level'],
          properties: { _id: { bsonType: 'objectId' }, level: { bsonType: 'int' } },
        },
        {
          bsonType: 'object',
          additionalProperties: false,
          required: ['_id', 'email'],
          properties: { _id: { bsonType: 'objectId' }, email: { bsonType: 'string' } },
        },
      ],
    });
  });

  it('reads the BSON type of a codec from the extension packs the contract lists', () => {
    const Place = model('Place', {
      collection: 'places',
      fields: {
        _id: field.scalar(type.ObjectId()),
        location: field.scalar({ kind: 'scalar', codecId: 'geo/point@1' }),
      },
    });

    const contract = defineContract({
      family: mongoFamilyPack,
      target: mongoTargetPack,
      extensions: { geo: geoPack },
      models: { Place },
    });

    expect(collectionsOf(contract).places.validator.jsonSchema.properties).toEqual({
      _id: { bsonType: 'objectId' },
      location: { bsonType: 'object' },
    });
  });

  it('hashes storage as every Mongo contract source does', () => {
    const User = model('User', {
      collection: 'users',
      fields: { _id: field.scalar(type.ObjectId()), email: field.scalar(type.String()) },
    });

    const contract = defineContract({
      family: mongoFamilyPack,
      target: mongoTargetPack,
      models: { User },
    });

    const validator = new MongoValidator({
      jsonSchema: {
        bsonType: 'object',
        additionalProperties: false,
        required: ['_id', 'email'],
        properties: { _id: { bsonType: 'objectId' }, email: { bsonType: 'string' } },
      },
      validationLevel: 'strict',
      validationAction: 'error',
    });
    expect(contract.storage.storageHash).toBe(
      buildMongoStorage({
        namespaceId: UNBOUND_NAMESPACE_ID,
        collections: { users: { validator } },
        valueSets: {},
      }).storageHash,
    );
  });
});
