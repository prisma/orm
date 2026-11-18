import { dataType } from '@internal/framework-components/codec';
import type { ExtensionPackRef } from '@internal/framework-components/components';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { documentIdRefusalReason } from '@internal/mongo-contract';
import { describe, expect, it } from 'vitest';
import { defineContract, field, model, rel, valueObject } from '../src/contract-builder';
import { enumType, member } from '../src/enum-type';
import {
  identityCodecDescriptor,
  mongoFamilyPack,
  mongoTargetPack,
  type,
} from './mongo-test-packs';

const plainGeoPoint = dataType('geo/point', { read: (json) => json });

const scaffold = { family: mongoFamilyPack, target: mongoTargetPack } as const;

const sqlTypedPack = {
  kind: 'extension',
  id: 'geo',
  familyId: 'mongo',
  targetId: 'mongo',
  version: '0.0.1',
  dataTypes: [plainGeoPoint],
  types: {
    codecTypes: { codecDescriptors: [identityCodecDescriptor('geo/point@1', plainGeoPoint)] },
  },
} as const satisfies ExtensionPackRef<'mongo', 'mongo'>;

function validatorSchemaOf(
  contract: { readonly storage: { readonly namespaces: object } },
  collection: string,
): unknown {
  return JSON.parse(JSON.stringify(contract.storage.namespaces))[UNBOUND_NAMESPACE_ID].entries
    .collection[collection].validator.jsonSchema;
}

describe('mongo defineContract refuses what a collection validator cannot describe', () => {
  describe('a codec with no MongoDB data type', () => {
    it('refuses a model field whose codec no pack provides', () => {
      const Place = model('Place', {
        collection: 'places',
        fields: {
          _id: field.scalar(type.ObjectId()),
          location: field.scalar({ kind: 'scalar', codecId: 'geo/point@1' }),
        },
      });
      expect(() => defineContract({ ...scaffold, models: { Place } })).toThrow(
        expect.objectContaining({
          code: 'CONTRACT.CODEC_DESCRIPTOR_MISSING',
          message:
            'Model "Place" field "location" uses codec "geo/point@1", which no pack in the contract provides, so its BSON type is unknown and the contract cannot describe the field.',
          meta: { modelName: 'Place', fieldName: 'location', codecId: 'geo/point@1' },
        }),
      );
    });

    it('refuses a field whose codec represents a data type that is not a MongoDB data type', () => {
      const Place = model('Place', {
        collection: 'places',
        fields: {
          _id: field.scalar(type.ObjectId()),
          location: field.scalar({ kind: 'scalar', codecId: 'geo/point@1' }),
        },
      });
      expect(() =>
        defineContract({ ...scaffold, extensions: { geo: sqlTypedPack }, models: { Place } }),
      ).toThrow(
        expect.objectContaining({
          code: 'CONTRACT.PACK_CONTRIBUTION_INVALID',
          message:
            'Model "Place" field "location" uses codec "geo/point@1", whose data type "geo/point" is not a MongoDB data type of any pack in the contract, so its BSON type is unknown and the contract cannot describe the field.',
          meta: {
            modelName: 'Place',
            fieldName: 'location',
            codecId: 'geo/point@1',
            dataType: 'geo/point',
            reason: 'data-type-not-mongo',
          },
        }),
      );
    });

    it('refuses a value object field whose codec no pack provides', () => {
      const Address = valueObject('Address', {
        fields: { zip: field.scalar({ kind: 'scalar', codecId: 'geo/zip@1' }) },
      });
      const User = model('User', {
        collection: 'users',
        fields: { _id: field.scalar(type.ObjectId()), address: field.valueObject(Address) },
      });
      expect(() =>
        defineContract({ ...scaffold, models: { User }, valueObjects: { Address } }),
      ).toThrow(
        expect.objectContaining({
          code: 'CONTRACT.CODEC_DESCRIPTOR_MISSING',
          message:
            'Value object "Address" field "zip" uses codec "geo/zip@1", which no pack in the contract provides, so its BSON type is unknown and the contract cannot describe the field.',
        }),
      );
    });

    it('names the codec of an _id that no pack provides, not the missing _id', () => {
      const User = model('User', {
        collection: 'users',
        fields: { _id: field.scalar({ kind: 'scalar', codecId: 'custom/uuid@1' }) },
      });
      expect(() => defineContract({ ...scaffold, models: { User } })).toThrow(
        expect.objectContaining({
          code: 'CONTRACT.CODEC_DESCRIPTOR_MISSING',
          message:
            'Model "User" field "_id" uses codec "custom/uuid@1", which no pack in the contract provides, so its BSON type is unknown and the contract cannot describe the field.',
        }),
      );
    });
  });

  describe('the document id', () => {
    it('accepts a root model without an _id field', () => {
      const User = model('User', {
        collection: 'users',
        fields: { email: field.scalar(type.String()) },
      });
      expect(() => defineContract({ ...scaffold, models: { User } })).not.toThrow();
    });

    it.each([
      ['a string', field.scalar(type.String()), { bsonType: 'string' }],
      ['an int', field.scalar(type.Int32()), { bsonType: 'int' }],
      ['a date', field.scalar(type.DateTime()), { bsonType: 'date' }],
      ['bytes', field.scalar(type.Binary()), { bsonType: 'binData' }],
    ])(
      'accepts a root model whose _id holds %s, and validates it as such',
      (_case, idField, idSchema) => {
        const User = model('User', { collection: 'users', fields: { _id: idField } });
        const built = defineContract({ ...scaffold, models: { User } });
        expect(validatorSchemaOf(built, 'users')).toEqual({
          bsonType: 'object',
          properties: { _id: idSchema },
          required: ['_id'],
          additionalProperties: false,
        });
      },
    );

    it.each([
      ['a list', field.scalar(type.ObjectId()).many(), 'mongo/objectId@1', ['array']],
      ['nullable', field.scalar(type.String()).optional(), 'mongo/string@1', ['null']],
      ['json', field.scalar(type.Json()), 'mongo/json@1', ['array', 'null']],
      ['a vector', field.scalar(type.Vector()), 'mongo/vector@1', ['array']],
      [
        'any BSON value',
        field.scalar(type.Bson()),
        'mongo/bson@1',
        ['array', 'regex', 'undefined', 'null'],
      ],
    ])(
      'refuses a root model whose _id is %s, with the reason reading the contract back gives',
      (_case, idField, codecId, forbidden) => {
        const held = codecId === 'mongo/bson@1' ? [] : forbidden;
        const User = model('User', { collection: 'users', fields: { _id: idField } });
        expect(() => defineContract({ ...scaffold, models: { User } })).toThrow(
          expect.objectContaining({
            code: 'CONTRACT.COLLECTION_INVALID',
            message: `Model "User" field "_id" ${documentIdRefusalReason(codecId, held)}`,
            meta: {
              modelName: 'User',
              fieldName: '_id',
              collection: 'users',
              codecId,
              bsonTypes: forbidden,
              reason: 'document-id-bson-type',
            },
          }),
        );
      },
    );

    it('accepts an embedded model and a variant without an _id', () => {
      const Task = model('Task', {
        collection: 'tasks',
        fields: { _id: field.scalar(type.ObjectId()), type: field.scalar(type.String()) },
        relations: { notes: rel.hasMany('Note') },
        discriminator: { field: 'type', variants: { Bug: { value: 'bug' } } },
      });
      const Bug = model('Bug', {
        collection: 'tasks',
        base: Task,
        fields: { level: field.scalar(type.Int32()) },
      });
      const Note = model('Note', { owner: Task, fields: { text: field.scalar(type.String()) } });
      expect(() => defineContract({ ...scaffold, models: { Task, Bug, Note } })).not.toThrow();
    });
  });

  describe('enums', () => {
    it('refuses an enum whose codec stores a BSON type a validator cannot list', () => {
      const Big = enumType('Big', { codecId: 'mongo/int64@1' }, member('One', 1));
      const Job = model('Job', { collection: 'jobs', fields: { size: field.namedType(Big) } });
      expect(() => defineContract({ ...scaffold, enums: { Big }, models: { Job } })).toThrow(
        expect.objectContaining({
          code: 'CONTRACT.ENUM_INVALID',
          message:
            'enumType("Big") codec "mongo/int64@1" stores BSON type long, which a collection validator cannot list as an enum value. Use a codec whose BSON type is string, int, double, bool, object or array.',
          meta: { enumName: 'Big', codecId: 'mongo/int64@1', reason: 'not-listable-by-validator' },
        }),
      );
    });

    it.each([
      ['used only in an external collection', 'external'],
      ['used only in an observed collection', 'observed'],
    ] as const)('accepts an enum a validator cannot list, %s', (_case, controlPolicy) => {
      const Big = enumType('Big', { codecId: 'mongo/int64@1' }, member('One', 1));
      const Job = model('Job', {
        collection: 'jobs',
        controlPolicy,
        fields: { size: field.namedType(Big) },
      });
      expect(() => defineContract({ ...scaffold, enums: { Big }, models: { Job } })).not.toThrow();
    });

    it('accepts an enum a validator cannot list that no model uses', () => {
      const Big = enumType('Big', { codecId: 'mongo/int64@1' }, member('One', 1));
      expect(() => defineContract({ ...scaffold, enums: { Big }, models: {} })).not.toThrow();
    });

    it('refuses an enum member a validator cannot list', () => {
      const Ratio = enumType(
        'Ratio',
        { codecId: 'mongo/double@1' },
        member('Half', 0.5),
        member('All', '1'),
      );
      const Job = model('Job', { collection: 'jobs', fields: { ratio: field.namedType(Ratio) } });
      expect(() => defineContract({ ...scaffold, enums: { Ratio }, models: { Job } })).toThrow(
        expect.objectContaining({
          code: 'CONTRACT.ENUM_INVALID',
          message:
            'enumType("Ratio") member "All" is stored as "1", which a collection validator cannot list as a double. A member of a double enum must be a finite number.',
          meta: {
            enumName: 'Ratio',
            member: 'All',
            codecId: 'mongo/double@1',
            reason: 'member-not-listable-by-validator',
          },
        }),
      );
    });
  });

  it('refuses an embed relation to a model with variants', () => {
    const Owner = model('Owner', {
      collection: 'owners',
      fields: { _id: field.scalar(type.ObjectId()) },
      relations: { task: rel.hasOne('Task') },
    });
    const Task = model('Task', {
      owner: Owner,
      fields: { type: field.scalar(type.String()) },
      discriminator: { field: 'type', variants: { Bug: { value: 'bug' } } },
    });
    const Bug = model('Bug', { base: Task, fields: { severity: field.scalar(type.Int32()) } });
    expect(() => defineContract({ ...scaffold, models: { Owner, Task, Bug } })).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.RELATION_INVALID',
        message:
          'Relation "Owner.task" embeds model "Task", which has variants. The ORM reads and writes only the base fields of an embedded model, so an embedded model cannot have variants.',
        meta: { modelName: 'Owner', relationName: 'task', reason: 'embedded-model-has-variants' },
      }),
    );
  });
});
