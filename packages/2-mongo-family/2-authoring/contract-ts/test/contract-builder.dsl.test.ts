import {
  crossRef,
  domainModelsAtDefaultNamespace,
  domainValueObjectsAtDefaultNamespace,
} from '@internal/contract/types';
import type { FamilyPackRef, TargetPackRef } from '@internal/framework-components/components';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { defineContract, field, index, model, rel, valueObject } from '../src/contract-builder';

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
} as const satisfies TargetPackRef<'mongo', 'mongo'>;

describe('mongo contract builder', () => {
  it('builds a canonical contract for referenced models', () => {
    const User = model('User', {
      collection: 'users',
      fields: {
        _id: field.objectId(),
        email: field.string(),
      },
    });

    const Post = model('Post', {
      collection: 'posts',
      fields: {
        _id: field.objectId(),
        authorId: field.objectId(),
        title: field.string(),
      },
      relations: {
        author: rel.belongsTo(User, {
          from: 'authorId',
          to: User.ref('_id'),
        }),
      },
    });

    const contract = defineContract({
      family: mongoFamilyPack,
      target: mongoTargetPack,
      models: { User, Post },
    });

    expect(contract).toMatchObject({
      targetFamily: 'mongo',
      target: 'mongo',
    });
    expect(contract.roots).toEqual({
      users: crossRef('User'),
      posts: crossRef('Post'),
    });
    expect(contract.storage.namespaces[UNBOUND_NAMESPACE_ID]!.entries['collection']).toEqual({
      users: { kind: 'mongo-collection' },
      posts: { kind: 'mongo-collection' },
    });
    expect(domainModelsAtDefaultNamespace(contract.domain)['Post']).toEqual({
      storage: {
        collection: 'posts',
      },
      fields: {
        _id: { type: { kind: 'scalar', codecId: 'mongo/objectId@1' }, nullable: false },
        authorId: { type: { kind: 'scalar', codecId: 'mongo/objectId@1' }, nullable: false },
        title: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false },
      },
      relations: {
        author: {
          to: crossRef('User'),
          cardinality: 'N:1',
          nullable: false,
          on: {
            localFields: ['authorId'],
            targetFields: ['_id'],
          },
        },
      },
    });
    expect(contract.profileHash).toMatch(/^[a-f0-9]{64}$/);
    expect(contract.storage.storageHash).toMatch(/^[a-f0-9]{64}$/);
  });

  describe('to-one relation nullability', () => {
    const User = model('User', {
      collection: 'users',
      fields: { _id: field.objectId() },
    });

    type ObjectIdField = ReturnType<typeof field.objectId>;
    function postWith(
      authorId: ObjectIdField | ReturnType<ObjectIdField['optional']>,
      options: object,
    ) {
      const Post = model('Post', {
        collection: 'posts',
        fields: { _id: field.objectId(), authorId },
        relations: {
          author: rel.belongsTo(User, { from: 'authorId', to: User.ref('_id'), ...options }),
        },
      });
      return defineContract({
        family: mongoFamilyPack,
        target: mongoTargetPack,
        models: { User, Post },
      });
    }

    function authorRelation(contract: ReturnType<typeof postWith>) {
      return domainModelsAtDefaultNamespace(contract.domain)['Post']?.relations['author'];
    }

    it('belongsTo derives nullable from the local fields when no flag is given', () => {
      expect(authorRelation(postWith(field.objectId(), {}))).toMatchObject({ nullable: false });
      expect(authorRelation(postWith(field.objectId().optional(), {}))).toMatchObject({
        nullable: true,
      });
    });

    it('belongsTo records an explicit optional flag that agrees with the local fields', () => {
      expect(
        authorRelation(postWith(field.objectId().optional(), { optional: true })),
      ).toMatchObject({ nullable: true });
      expect(authorRelation(postWith(field.objectId(), { optional: false }))).toMatchObject({
        nullable: false,
      });
    });

    it('rejects an optional flag that contradicts the local fields', () => {
      expect(() => postWith(field.objectId(), { optional: true })).toThrow(
        expect.objectContaining({
          code: 'CONTRACT.RELATION_INVALID',
          message: expect.stringContaining('Relation "Post.author" is optional'),
        }),
      );
      expect(() => postWith(field.objectId().optional(), { optional: false })).toThrow(
        expect.objectContaining({
          code: 'CONTRACT.RELATION_INVALID',
          message: expect.stringContaining('Relation "Post.author" is required'),
        }),
      );
    });

    it('rejects a local field the model does not declare', () => {
      expect(() => postWith(field.objectId(), { from: 'missingId' })).toThrow(
        expect.objectContaining({
          code: 'CONTRACT.RELATION_INVALID',
          message:
            'Relation "Post.author" joins on local field "missingId", which model "Post" does not declare',
          meta: {
            modelName: 'Post',
            relationName: 'author',
            fieldName: 'missingId',
            reason: 'local-field-unknown',
          },
        }),
      );
    });

    it('hasOne reference is always nullable; embeds and hasMany carry no flag', () => {
      const Profile = model('Profile', {
        collection: 'profiles',
        fields: { _id: field.objectId(), userId: field.objectId() },
      });
      const Owner = model('Owner', {
        collection: 'owners',
        fields: { _id: field.objectId() },
        relations: {
          profile: rel.hasOne(Profile, { from: '_id', to: Profile.ref('userId') }),
          profiles: rel.hasMany(Profile, { from: '_id', to: Profile.ref('userId') }),
          home: rel.hasOne('Address'),
          addresses: rel.hasMany('Address'),
        },
      });
      const Address = model('Address', { owner: Owner, fields: { street: field.string() } });
      const contract = defineContract({
        family: mongoFamilyPack,
        target: mongoTargetPack,
        models: { Owner, Profile, Address },
      });
      expect(domainModelsAtDefaultNamespace(contract.domain)['Owner']?.relations).toMatchObject({
        profile: { cardinality: '1:1', nullable: true },
        profiles: expect.not.objectContaining({ nullable: expect.anything() }),
        home: expect.not.objectContaining({ nullable: expect.anything() }),
        addresses: expect.not.objectContaining({ nullable: expect.anything() }),
      });
    });

    it('hasOne does not accept an optional flag', () => {
      const Profile = model('Profile', {
        collection: 'profiles',
        fields: { _id: field.objectId(), userId: field.objectId() },
      });
      const relation = rel.hasOne(Profile, {
        from: '_id',
        to: Profile.ref('userId'),
        // @ts-expect-error the side of a one-to-one relation without the foreign key is always nullable
        optional: false,
      });
      expect(relation.__nullable).toBe(true);
    });
  });

  it('supports owned models, polymorphism, and value objects', () => {
    const Address = valueObject('Address', {
      fields: {
        street: field.string(),
        zip: field.string().optional(),
      },
    });

    const Task = model('Task', {
      collection: 'tasks',
      storageRelations: {
        comments: { field: 'comments' },
      },
      fields: {
        _id: field.objectId(),
        type: field.string(),
        title: field.string(),
        metadata: field.valueObject(Address).optional(),
      },
      relations: {
        comments: rel.hasMany('Comment'),
      },
      discriminator: {
        field: 'type',
        variants: {
          Bug: { value: 'bug' },
        },
      },
    });

    const Bug = model('Bug', {
      collection: 'tasks',
      base: Task,
      fields: {
        severity: field.string(),
      },
    });

    const Comment = model('Comment', {
      owner: Task,
      fields: {
        _id: field.objectId(),
        text: field.string(),
      },
    });

    const contract = defineContract({
      family: mongoFamilyPack,
      target: mongoTargetPack,
      models: { Task, Bug, Comment },
      valueObjects: { Address },
    });

    expect(contract.roots).toEqual({
      tasks: crossRef('Task'),
    });
    expect(contract.storage.namespaces[UNBOUND_NAMESPACE_ID]!.entries['collection']).toEqual({
      tasks: { kind: 'mongo-collection' },
    });
    expect(domainValueObjectsAtDefaultNamespace(contract.domain)).toEqual({
      Address: {
        fields: {
          street: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false },
          zip: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: true },
        },
      },
    });
    const models = domainModelsAtDefaultNamespace(contract.domain);
    expect(models['Task']!.storage).toEqual({
      collection: 'tasks',
      relations: {
        comments: { field: 'comments' },
      },
    });
    expect(models['Task']!.discriminator).toEqual({ field: 'type' });
    expect(models['Task']!.variants).toEqual({
      Bug: { value: 'bug' },
    });
    expect(models['Bug']!.base).toEqual(crossRef('Task'));
    expect(models['Comment']!.owner).toBe('Task');
  });

  it('lowers Mongo indexes into namespaced storage collections', () => {
    const User = model('User', {
      collection: 'users',
      fields: {
        _id: field.objectId(),
        email: field.string(),
        createdAt: field.date(),
        location: field.string(),
      },
      indexes: [
        index({ email: 1 }, { unique: true }),
        index({ createdAt: 1 }, { expireAfterSeconds: 3600 }),
        index({ location: '2dsphere' }),
      ],
    });

    const contract = defineContract({
      family: mongoFamilyPack,
      target: mongoTargetPack,
      models: { User },
    });

    expect(contract.storage.namespaces[UNBOUND_NAMESPACE_ID]!.entries['collection']).toEqual({
      users: {
        kind: 'mongo-collection',
        indexes: [
          { kind: 'mongo-index', keys: [{ field: 'email', direction: 1 }], unique: true },
          {
            kind: 'mongo-index',
            keys: [{ field: 'createdAt', direction: 1 }],
            expireAfterSeconds: 3600,
          },
          { kind: 'mongo-index', keys: [{ field: 'location', direction: '2dsphere' }] },
        ],
      },
    });
  });

  it('supports the double scalar helper', () => {
    const Metric = model('Metric', {
      collection: 'metrics',
      fields: {
        _id: field.objectId(),
        value: field.double(),
      },
    });

    const contract = defineContract({
      family: mongoFamilyPack,
      target: mongoTargetPack,
      models: { Metric },
    });

    expect(domainModelsAtDefaultNamespace(contract.domain)['Metric']?.fields['value']).toEqual({
      type: { kind: 'scalar', codecId: 'mongo/double@1' },
      nullable: false,
    });
  });

  it('merges indexes from multiple models sharing the same collection', () => {
    const TaskBase = model('TaskBase', {
      collection: 'tasks',
      fields: {
        _id: field.objectId(),
        type: field.string(),
        title: field.string(),
      },
      indexes: [index({ title: 1 }, { unique: true })],
      discriminator: {
        field: 'type',
        variants: {
          TaskDerived: { value: 'derived' },
        },
      },
    });

    const TaskDerived = model('TaskDerived', {
      collection: 'tasks',
      base: TaskBase,
      fields: {
        expiresAt: field.date(),
      },
      indexes: [index({ expiresAt: 1 }, { expireAfterSeconds: 3600 })],
    });

    const contract = defineContract({
      family: mongoFamilyPack,
      target: mongoTargetPack,
      models: { TaskBase, TaskDerived },
    });

    expect(contract.storage.namespaces[UNBOUND_NAMESPACE_ID]!.entries['collection']).toEqual({
      tasks: {
        kind: 'mongo-collection',
        indexes: [
          { kind: 'mongo-index', keys: [{ field: 'title', direction: 1 }], unique: true },
          {
            kind: 'mongo-index',
            keys: [{ field: 'expiresAt', direction: 1 }],
            expireAfterSeconds: 3600,
            partialFilterExpression: { type: 'derived' },
          },
        ],
      },
    });
  });

  it('rejects duplicate indexes across models sharing the same collection', () => {
    const TaskBase = model('TaskBase', {
      collection: 'tasks',
      fields: {
        _id: field.objectId(),
        type: field.string(),
        title: field.string(),
      },
      indexes: [index({ title: 1 }, { unique: true })],
    });

    const TaskAlt = model('TaskAlt', {
      collection: 'tasks',
      fields: {
        _id: field.objectId(),
        title: field.string(),
      },
      indexes: [index({ title: 1 }, { unique: true })],
    });

    expect(() =>
      defineContract({
        family: mongoFamilyPack,
        target: mongoTargetPack,
        models: { TaskBase, TaskAlt },
      }),
    ).toThrow(
      'Collection "tasks" defines duplicate index {"fields":{"title":1},"options":{"unique":true}}. First declared on model "TaskBase" and duplicated on model "TaskAlt".',
    );
    expect(() =>
      defineContract({
        family: mongoFamilyPack,
        target: mongoTargetPack,
        models: { TaskBase, TaskAlt },
      }),
    ).toThrow(expect.objectContaining({ code: 'CONTRACT.NAME_DUPLICATE' }));
  });

  it('rejects indexes on models without collections', () => {
    const Comment = model('Comment', {
      fields: {
        _id: field.objectId(),
        text: field.string(),
      },
      indexes: [index({ text: 'text' })],
    });

    expect(() =>
      defineContract({
        family: mongoFamilyPack,
        target: mongoTargetPack,
        models: { Comment },
      }),
    ).toThrow('Model "Comment" defines indexes but has no collection to attach them to.');
    expect(() =>
      defineContract({
        family: mongoFamilyPack,
        target: mongoTargetPack,
        models: { Comment },
      }),
    ).toThrow(expect.objectContaining({ code: 'CONTRACT.COLLECTION_INVALID' }));
  });

  it('rejects index field references that are not declared on the model', () => {
    const User = model('User', {
      collection: 'users',
      fields: {
        _id: field.objectId(),
        email: field.string(),
      },
      indexes: [index({ nonexistent: 1 })],
    });

    expect(() =>
      defineContract({
        family: mongoFamilyPack,
        target: mongoTargetPack,
        models: { User },
      }),
    ).toThrow(/User/);
    expect(() =>
      defineContract({
        family: mongoFamilyPack,
        target: mongoTargetPack,
        models: { User },
      }),
    ).toThrow(/nonexistent/);
    expect(() =>
      defineContract({
        family: mongoFamilyPack,
        target: mongoTargetPack,
        models: { User },
      }),
    ).toThrow(expect.objectContaining({ code: 'CONTRACT.FIELD_UNKNOWN' }));
  });

  it('rejects relation targets referencing a field of another model', () => {
    const User = model('User', {
      collection: 'users',
      fields: {
        _id: field.objectId(),
      },
    });
    const Post = model('Post', {
      collection: 'posts',
      fields: {
        _id: field.objectId(),
      },
    });

    const makeRelation = () =>
      rel.belongsTo(User, {
        from: 'authorId',
        to: Post.ref('_id') as never,
      });

    expect(makeRelation).toThrow('Relation target "User" cannot reference field "Post._id".');
    expect(makeRelation).toThrow(expect.objectContaining({ code: 'CONTRACT.RELATION_INVALID' }));
  });

  it('rejects pack-contributed entity types that collide with reserved helper keys', () => {
    const familyPackWithModelEntityType = {
      ...mongoFamilyPack,
      authoring: { entityTypes: { model: {} } },
    } as unknown as typeof mongoFamilyPack;

    const run = () =>
      defineContract(
        {
          family: familyPackWithModelEntityType,
          target: mongoTargetPack,
        },
        () => ({ models: {} }),
      );

    expect(run).toThrow(/collide with the reserved built-in helper key/);
    expect(run).toThrow(expect.objectContaining({ code: 'CONTRACT.PACK_CONTRIBUTION_INVALID' }));
  });

  it('throws once and names the missing field when a multi-key index mixes valid and invalid fields', () => {
    const User = model('User', {
      collection: 'users',
      fields: {
        _id: field.objectId(),
        email: field.string(),
      },
      indexes: [index({ email: 1, nonexistent: 1 })],
    });

    let thrown: unknown;
    try {
      defineContract({
        family: mongoFamilyPack,
        target: mongoTargetPack,
        models: { User },
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toMatch(/nonexistent/);
    expect(message).toMatch(/User/);
  });

  it('lowers collection options into namespaced storage collections', () => {
    const User = model('User', {
      collection: 'users',
      fields: {
        _id: field.objectId(),
        email: field.string(),
      },
      collectionOptions: {
        collation: { locale: 'en', strength: 2 },
        changeStreamPreAndPostImages: { enabled: true },
      },
    });

    const contract = defineContract({
      family: mongoFamilyPack,
      target: mongoTargetPack,
      models: { User },
    });

    expect(contract.storage.namespaces[UNBOUND_NAMESPACE_ID]!.entries['collection']).toEqual({
      users: {
        kind: 'mongo-collection',
        options: {
          kind: 'mongo-collection-options',
          collation: { kind: 'mongo-collation-options', locale: 'en', strength: 2 },
          changeStreamPreAndPostImages: {
            kind: 'mongo-change-stream-pre-and-post-images-options',
            enabled: true,
          },
        },
      },
    });
  });

  it('rejects collection options on models without collections', () => {
    const Comment = model('Comment', {
      fields: {
        _id: field.objectId(),
        text: field.string(),
      },
      collectionOptions: {
        collation: { locale: 'en' },
      },
    });

    expect(() =>
      defineContract({
        family: mongoFamilyPack,
        target: mongoTargetPack,
        models: { Comment },
      }),
    ).toThrow('Model "Comment" defines collectionOptions but has no collection to attach them to.');
  });

  it('rejects collection options declared by multiple models for the same collection', () => {
    const Task = model('Task', {
      collection: 'tasks',
      fields: {
        _id: field.objectId(),
        title: field.string(),
      },
      collectionOptions: {
        collation: { locale: 'en' },
      },
    });
    const Bug = model('Bug', {
      collection: 'tasks',
      fields: {
        _id: field.objectId(),
        severity: field.string(),
      },
      collectionOptions: {
        changeStreamPreAndPostImages: { enabled: true },
      },
    });

    expect(() =>
      defineContract({
        family: mongoFamilyPack,
        target: mongoTargetPack,
        models: { Task, Bug },
      }),
    ).toThrow(
      'Collection "tasks" has collectionOptions declared by multiple models. Author collectionOptions on a single model per collection.',
    );
  });

  it('keeps the callback authoring form equivalent to the object literal form', () => {
    const Address = valueObject('Address', {
      fields: {
        street: field.string(),
      },
    });

    const User = model('User', {
      collection: 'users',
      fields: {
        _id: field.objectId(),
        address: field.valueObject(Address).optional(),
      },
    });

    const Post = model('Post', {
      collection: 'posts',
      fields: {
        _id: field.objectId(),
        authorId: field.objectId(),
      },
      relations: {
        author: rel.belongsTo(User, {
          from: 'authorId',
          to: User.ref('_id'),
        }),
      },
    });

    const literalContract = defineContract({
      family: mongoFamilyPack,
      target: mongoTargetPack,
      valueObjects: { Address },
      models: { User, Post },
    });

    const callbackContract = defineContract(
      {
        family: mongoFamilyPack,
        target: mongoTargetPack,
      },
      ({ field, model, rel, valueObject }) => {
        const Address = valueObject('Address', {
          fields: {
            street: field.string(),
          },
        });

        const User = model('User', {
          collection: 'users',
          fields: {
            _id: field.objectId(),
            address: field.valueObject(Address).optional(),
          },
        });

        const Post = model('Post', {
          collection: 'posts',
          fields: {
            _id: field.objectId(),
            authorId: field.objectId(),
          },
          relations: {
            author: rel.belongsTo(User, {
              from: 'authorId',
              to: User.ref('_id'),
            }),
          },
        });

        return {
          valueObjects: { Address },
          models: { User, Post },
        };
      },
    );

    expect(callbackContract).toEqual(literalContract);
  });
});
