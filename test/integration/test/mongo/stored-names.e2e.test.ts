import { MongoContractSerializer } from '@internal/family-mongo/ir';
import {
  defineContract,
  field,
  model,
  rel,
  type,
  valueObject,
} from '@internal/mongo/contract-builder';
import {
  MongoAggFieldRef,
  MongoAggLiteral,
  MongoAggOperator,
  MongoExprFilter,
  MongoFieldFilter,
} from '@internal/mongo-query-ast/execution';
import { ObjectId } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { timeouts, withMongoPort } from '../_harness/mongo';

const Home = valueObject('Home', { fields: { city: field.scalar(type.String()) } });

const User = model('User', {
  collection: 'users',
  storageRelations: { addresses: { field: 'user_addresses' } },
  fields: {
    id: field.scalar(type.ObjectId()).mongo({ field: '_id' }),
    displayName: field.scalar(type.String()).mongo({ field: 'display_name' }),
    email: field.scalar(type.String()).optional(),
    visits: field.scalar(type.Int32()).mongo({ field: 'visit_count' }),
    tags: field.scalar(type.String()).many().mongo({ field: 'user_tags' }),
    home: field.valueObject(Home).optional().mongo({ field: 'home_address' }),
  },
  relations: {
    posts: rel.hasMany('Post', { from: 'id', to: 'authorId' }),
    addresses: rel.hasMany('Address'),
  },
});

const Address = model('Address', {
  owner: User,
  fields: {
    street: field.scalar(type.String()).mongo({ field: 'street_name' }),
    city: field.scalar(type.String()),
  },
});

const Post = model('Post', {
  collection: 'posts',
  fields: {
    id: field.scalar(type.ObjectId()).mongo({ field: '_id' }),
    authorId: field.scalar(type.ObjectId()).mongo({ field: 'author_id' }),
    title: field.scalar(type.String()),
  },
  relations: { author: rel.belongsTo(User, { from: 'authorId', to: User.ref('id') }) },
});

const Task = model('Task', {
  collection: 'tasks',
  fields: {
    id: field.scalar(type.ObjectId()).mongo({ field: '_id' }),
    kind: field.scalar(type.String()).mongo({ field: '_kind' }),
    title: field.scalar(type.String()).mongo({ field: 'task_title' }),
  },
  discriminator: { field: 'kind', variants: { Bug: { value: 'bug' } } },
});

const Bug = model('Bug', {
  collection: 'tasks',
  base: Task,
  fields: { severity: field.scalar(type.String()).mongo({ field: 'bug_severity' }) },
});

const contract = defineContract({
  valueObjects: { Home },
  models: { User, Address, Post, Task, Bug },
});
type Contract = typeof contract;
const contractJson = new MongoContractSerializer().serializeContract(contract);

const ada = {
  displayName: 'Ada',
  email: null,
  visits: 1,
  tags: ['a'],
  home: { city: 'London' },
  addresses: [{ street: 'Main', city: 'London' }],
};

function rowOf(id: string) {
  return {
    id,
    displayName: 'Ada',
    email: null,
    visits: 1,
    tags: ['a'],
    home: { city: 'London' },
    addresses: [{ street: 'Main', city: 'London' }],
  };
}

describe('a MongoDB contract whose fields are stored under other names', () => {
  it(
    'installs a validator that names the stored names, embed relations included',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ mongoDb }) => {
        const [users] = await mongoDb
          .listCollections({ name: 'users' }, { nameOnly: false })
          .toArray();
        const schema = (
          users && 'options' in users
            ? (users.options as { validator?: { $jsonSchema?: { properties?: object } } })
            : undefined
        )?.validator?.$jsonSchema;
        expect(Object.keys(schema?.properties ?? {}).sort()).toEqual([
          '_id',
          'display_name',
          'email',
          'home_address',
          'user_addresses',
          'user_tags',
          'visit_count',
        ]);
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'creates and reads whole rows of fields, and stores the documents under the stored names',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db, mongoDb }) => {
        const created = await db.users.create(ada as never);
        const id = String(created.id);
        expect(created).toEqual(rowOf(id));
        expect(await db.users.all().toArray()).toEqual([rowOf(id)]);
        expect(await mongoDb.collection('users').findOne({})).toEqual({
          _id: new ObjectId(id),
          display_name: 'Ada',
          email: null,
          visit_count: 1,
          user_tags: ['a'],
          home_address: { city: 'London' },
          user_addresses: [{ street_name: 'Main', city: 'London' }],
        });
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'filters by field names, through raw paths into a value object and an embedded model, and inside $expr',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db, mongoDb }) => {
        const id = String((await db.users.create(ada as never)).id);
        await db.users.create({
          ...ada,
          displayName: 'Bob',
          tags: ['b'],
          home: { city: 'Paris' },
          addresses: [{ street: 'Side', city: 'Paris' }],
        } as never);
        await mongoDb
          .collection('users')
          .insertOne(
            { display_name: 'Cy', email: null, visit_count: 0, user_addresses: [] },
            { bypassDocumentValidation: true },
          );
        const names = async (users: { all(): { toArray(): Promise<unknown[]> } }) =>
          (await users.all().toArray()).map((row) => (row as { displayName: string }).displayName);
        expect([
          await names(db.users.where({ id })),
          await names(db.users.where(MongoFieldFilter.eq('home.city', 'London'))),
          await names(db.users.where(MongoFieldFilter.eq('addresses.street', 'Main'))),
          await names(
            db.users.where(
              MongoExprFilter.of(
                MongoAggOperator.of('$eq', [
                  MongoAggFieldRef.of('displayName'),
                  MongoAggLiteral.of('Ada'),
                ]),
              ),
            ),
          ),
          await names(db.users.orderBy({ displayName: -1 })),
          await names(db.users.where({ tags: 'a' })),
          await names(db.users.where({ tags: null } as never)),
        ]).toEqual([['Ada'], ['Ada'], ['Ada'], ['Ada'], ['Cy', 'Bob', 'Ada'], ['Ada'], ['Cy']]);
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'joins an include on mapped fields in both directions',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db }) => {
        const user = await db.users.create(ada as never);
        const id = String(user.id);
        const post = await db.posts.create({ authorId: user.id, title: 'Hi' });
        const postId = String(post.id);
        expect([
          await db.posts.include('author').all().toArray(),
          await db.users.include('posts').all().toArray(),
        ]).toEqual([
          [{ id: postId, authorId: id, title: 'Hi', author: rowOf(id) }],
          [{ ...rowOf(id), posts: [{ id: postId, authorId: id, title: 'Hi' }] }],
        ]);
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'updates through field operations on a dot path into an embedded model, and upserts on both paths',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db, mongoDb }) => {
        const id = String((await db.users.create(ada as never)).id);
        const updated = await db.users
          .where({ id })
          .update((u) => [
            u.visits.inc(2),
            (u as never as (path: string) => typeof u.displayName)('addresses.0.street').set(
              'Side',
            ),
          ]);
        const inserted = await db.users.where({ displayName: 'Cy' }).upsert({
          create: { ...ada, displayName: 'Cy' } as never,
          update: { visits: 5 },
        });
        const matched = await db.users.where({ displayName: 'Cy' }).upsert({
          create: { ...ada, displayName: 'Cy' } as never,
          update: { visits: 6 },
        });
        expect([updated, inserted.visits, matched.visits, inserted.id === matched.id]).toEqual([
          { ...rowOf(id), visits: 3, addresses: [{ street: 'Side', city: 'London' }] },
          5,
          6,
          true,
        ]);
        expect(await mongoDb.collection('users').findOne({ _id: new ObjectId(id) })).toMatchObject({
          visit_count: 3,
          user_addresses: [{ street_name: 'Side', city: 'London' }],
        });
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'writes a variant under the stored discriminator and variant field names, and reads it from the base',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db, mongoDb }) => {
        const bug = await db.tasks.variant('bug').create({ title: 'Crash', severity: 'high' });
        const id = String(bug.id);
        const row = { id, kind: 'bug', title: 'Crash', severity: 'high' };
        expect([
          bug,
          await db.tasks.all().toArray(),
          await mongoDb.collection('tasks').findOne({}),
        ]).toEqual([
          row,
          [row],
          { _id: new ObjectId(id), _kind: 'bug', task_title: 'Crash', bug_severity: 'high' },
        ]);
      }),
    timeouts.spinUpMongoMemoryServer,
  );
});
