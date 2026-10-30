import { domainModelsAtDefaultNamespace } from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { type MongoContract, MongoIndex } from '@internal/mongo-contract';
import { describe, expect, it } from 'vitest';
import { defineContract, field, index, model, rel, valueObject } from '../src/contract-builder';
import { mongoFamilyPack, mongoTargetPack, type } from './mongo-test-packs';

function build<const Models extends Record<string, ReturnType<typeof model>>>(models: Models) {
  return defineContract({ family: mongoFamilyPack, target: mongoTargetPack, models });
}

function collection(contract: { readonly storage: MongoContract['storage'] }, name: string) {
  return contract.storage.namespaces[UNBOUND_NAMESPACE_ID]?.entries.collection?.[name];
}

describe('stored names in the Mongo contract builder', () => {
  it('stores a field under its own name unless .mongo({ field }) names another', () => {
    const User = model('User', {
      collection: 'users',
      fields: {
        id: field.scalar(type.ObjectId()).mongo({ field: '_id' }),
        displayName: field.scalar(type.String()).optional().mongo({ field: 'display_name' }),
        email: field.scalar(type.String()),
      },
    });
    const models = domainModelsAtDefaultNamespace(build({ User }).domain);
    expect({
      fields: Object.keys(models['User']?.fields ?? {}),
      storage: models['User']?.storage,
    }).toEqual({
      fields: ['id', 'displayName', 'email'],
      storage: {
        collection: 'users',
        fields: {
          id: { field: '_id' },
          displayName: { field: 'display_name' },
          email: { field: 'email' },
        },
      },
    });
  });

  it('keeps the stored name through .optional() and .many()', () => {
    const Tagged = model('Tagged', {
      collection: 'tagged',
      fields: {
        id: field.scalar(type.ObjectId()).mongo({ field: '_id' }),
        tags: field.scalar(type.String()).mongo({ field: 'tag_list' }).optional().many(),
      },
    });
    const models = domainModelsAtDefaultNamespace(build({ Tagged }).domain);
    expect(models['Tagged']?.storage).toEqual({
      collection: 'tagged',
      fields: { id: { field: '_id' }, tags: { field: 'tag_list' } },
    });
  });

  it('writes indexes and the variant scope with stored names', () => {
    const Task = model('Task', {
      collection: 'tasks',
      fields: {
        id: field.scalar(type.ObjectId()).mongo({ field: '_id' }),
        kind: field.scalar(type.String()).mongo({ field: 'task_kind' }),
        title: field.scalar(type.String()).mongo({ field: 'task_title' }),
      },
      indexes: [index({ title: 1 })],
      discriminator: { field: 'kind', variants: { Bug: { value: 'bug' } } },
    });
    const Bug = model('Bug', {
      collection: 'tasks',
      base: Task,
      fields: { severity: field.scalar(type.String()).mongo({ field: 'level' }) },
      indexes: [index({ severity: -1 })],
    });
    const contract = build({ Task, Bug });
    const models = domainModelsAtDefaultNamespace(contract.domain);
    expect(models['Task']?.discriminator).toEqual({ field: 'kind' });
    expect(collection(contract, 'tasks')?.indexes).toEqual([
      new MongoIndex({ keys: [{ field: 'task_title', direction: 1 }] }),
      new MongoIndex({
        keys: [{ field: 'level', direction: -1 }],
        partialFilterExpression: { task_kind: 'bug' },
      }),
    ]);
  });

  it('keeps relation fields as field names', () => {
    const User = model('User', {
      collection: 'users',
      fields: { id: field.scalar(type.ObjectId()).mongo({ field: '_id' }) },
    });
    const Post = model('Post', {
      collection: 'posts',
      fields: {
        id: field.scalar(type.ObjectId()).mongo({ field: '_id' }),
        authorId: field.scalar(type.ObjectId()).mongo({ field: 'author_id' }),
      },
      relations: { author: rel.belongsTo(User, { from: 'authorId', to: User.ref('id') }) },
    });
    const models = domainModelsAtDefaultNamespace(build({ User, Post }).domain);
    expect(models['Post']?.relations).toEqual({
      author: {
        to: { namespace: UNBOUND_NAMESPACE_ID, model: 'User' },
        cardinality: 'N:1',
        nullable: false,
        on: { localFields: ['authorId'], targetFields: ['id'] },
      },
    });
  });

  it('refuses two fields stored under one name', () => {
    const User = model('User', {
      collection: 'users',
      fields: {
        id: field.scalar(type.ObjectId()).mongo({ field: '_id' }),
        otherId: field.scalar(type.ObjectId()).mongo({ field: '_id' }),
      },
    });
    expect(() => build({ User })).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.NAME_DUPLICATE',
        message: 'Model "User" stores both "id" and "otherId" as "_id".',
      }),
    );
  });

  it('refuses a field stored as __proto__', () => {
    const User = model('User', {
      collection: 'users',
      fields: {
        id: field.scalar(type.ObjectId()).mongo({ field: '_id' }),
        label: field.scalar(type.String()).mongo({ field: '__proto__' }),
      },
    });
    expect(() => build({ User })).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.ARGUMENT_INVALID',
        message:
          'Model "User" field "label" is stored as "__proto__", which JavaScript reads as the prototype of an object rather than as a key. Give it another stored name.',
        meta: { modelName: 'User', fieldName: 'label', reason: 'stored-name-unsupported' },
      }),
    );
  });

  it('refuses a stored name on a field of a value object', () => {
    const Address = valueObject('Address', {
      fields: { street: field.scalar(type.String()).mongo({ field: 'st' }) },
    });
    const User = model('User', {
      collection: 'users',
      fields: {
        id: field.scalar(type.ObjectId()).mongo({ field: '_id' }),
        address: field.valueObject(Address),
      },
    });
    expect(() =>
      defineContract({
        family: mongoFamilyPack,
        target: mongoTargetPack,
        models: { User },
        valueObjects: { Address },
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.ARGUMENT_INVALID',
        message:
          'Value object "Address" field "street" sets .mongo({ field }), but a field of a value object is stored under its own name.',
      }),
    );
  });
});
