import { introspectSchema } from '@internal/adapter-mongo/control';
import type { ResolvedMigrationStatement } from '@internal/framework-components/control';
import { MongoCollection, type MongoContract } from '@internal/mongo-contract';
import { MongoMigrationPlanner } from '@internal/target-mongo/control';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { NS, useStatementsDatabase } from './runner-statements-fixtures';

const renameField = (
  fromModel: string,
  from: string,
  toModel: string,
  to: string,
): ResolvedMigrationStatement => ({
  kind: 'rename',
  entity: 'field',
  from: { namespaceId: NS, model: fromModel, field: from },
  to: { namespaceId: NS, model: toModel, field: to },
});

interface Spec {
  readonly collection?: string;
  /** Each field with its stored name. */
  readonly fields: Readonly<Record<string, string>>;
  /** The fields typed by the `Status` enum, and whether each holds a list. */
  readonly status?: Readonly<Record<string, 'one' | 'many'>>;
  readonly owner?: string;
  readonly embeds?: Readonly<Record<string, { readonly field: string; readonly model: string }>>;
}

const STATUS_REF = {
  plane: 'domain',
  namespaceId: '__unbound__',
  entityKind: 'enum',
  entityName: 'Status',
};

/** A contract of the models given, with nullable string fields, and the `Status` enum when members are given. */
function contract(
  storageHash: string,
  models: Readonly<Record<string, Spec>>,
  members: Readonly<Record<string, string>> = {},
): MongoContract {
  const collections = [
    ...new Set(
      Object.values(models).flatMap(({ collection }) =>
        collection === undefined ? [] : [collection],
      ),
    ),
  ];
  return {
    target: 'mongo',
    targetFamily: 'mongo',
    profileHash: 'p1',
    capabilities: {},
    extensions: {},
    meta: {},
    roots: {},
    domain: {
      namespaces: {
        __unbound__: {
          enum: {
            Status: {
              codecId: 'mongo/string@1',
              members: Object.entries(members).map(([name, value]) => ({ name, value })),
            },
          },
          models: Object.fromEntries(
            Object.entries(models).map(([name, spec]) => [
              name,
              {
                fields: Object.fromEntries(
                  Object.keys(spec.fields).map((field) => [
                    field,
                    {
                      type: { kind: 'scalar', codecId: 'mongo/string@1' },
                      nullable: true,
                      ...(spec.status?.[field] === undefined ? {} : { valueSet: STATUS_REF }),
                      ...(spec.status?.[field] === 'many'
                        ? { many: { elementNullable: false }, nullable: false }
                        : {}),
                    },
                  ]),
                ),
                relations: Object.fromEntries(
                  Object.entries(spec.embeds ?? {}).map(([relation, embed]) => [
                    relation,
                    { to: { model: embed.model, namespace: '__unbound__' }, cardinality: '1:N' },
                  ]),
                ),
                storage: {
                  ...(spec.collection === undefined ? {} : { collection: spec.collection }),
                  fields: Object.fromEntries(
                    Object.entries(spec.fields).map(([field, stored]) => [
                      field,
                      { field: stored },
                    ]),
                  ),
                  ...(spec.embeds === undefined
                    ? {}
                    : {
                        relations: Object.fromEntries(
                          Object.entries(spec.embeds).map(([relation, embed]) => [
                            relation,
                            { field: embed.field },
                          ]),
                        ),
                      }),
                },
                ...(spec.owner === undefined ? {} : { owner: spec.owner }),
              },
            ]),
          ),
        },
      },
    },
    storage: {
      storageHash,
      namespaces: {
        __unbound__: {
          id: '__unbound__',
          kind: 'mongo-namespace',
          entries: {
            collection: Object.fromEntries(
              collections.map((name) => [name, new MongoCollection({})]),
            ),
          },
        },
      },
    },
  } as unknown as MongoContract;
}

const user = (collection: string, fields: Readonly<Record<string, string>>) =>
  ({ User: { collection, fields } }) as const;

const ORIGIN = contract('from', user('users', { email: 'email', name: 'name' }));

describe('db update against a database that does not match the origin contract', {
  timeout: timeouts.spinUpMongoMemoryServer,
}, () => {
  const { db, planAndRun, documents } = useStatementsDatabase('stored_name_renames');

  async function labelsOf(
    from: MongoContract,
    to: MongoContract,
    statements: Parameters<MongoMigrationPlanner['plan']>[0]['statements'] = [],
  ) {
    const result = new MongoMigrationPlanner().plan({
      contract: to,
      schema: await introspectSchema(db()),
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
      fromContract: from,
      origin: { storageHash: from.storage.storageHash },
      statements,
      frameworkComponents: [],
      snapshotsImportPath: '../../snapshots',
    });
    return result.kind === 'success'
      ? result.plan.operations.map((operation) => Reflect.get(operation, 'label'))
      : result.conflicts.map(({ kind, summary, why, refusedStatement }) => ({
          kind,
          summary,
          why,
          refusedStatement,
        }));
  }

  async function collections() {
    return (await db().listCollections().toArray())
      .map(({ name }) => name)
      .filter((name) => !name.startsWith('_prisma'))
      .sort();
  }

  it('renames the collection when the database has the old name only', async () => {
    await db().collection('users').insertOne({ email: 'a@example.com', name: 'Ada' });
    const to = contract('to', user('app_users', { email: 'email', name: 'name' }));
    const { planned } = await planAndRun(ORIGIN, to);
    expect({
      labels:
        planned.kind === 'success'
          ? planned.plan.operations.map((op) => Reflect.get(op, 'label'))
          : [],
      collections: await collections(),
      documents: await documents('app_users'),
    }).toEqual({
      labels: ['Rename collection users to app_users'],
      collections: ['app_users'],
      documents: [{ email: 'a@example.com', name: 'Ada' }],
    });
  });

  it('plans no collection rename when the database already has the new name, and renames a field whose @map changes there', async () => {
    await db().collection('app_users').insertOne({ email: 'a@example.com', name: 'Ada' });
    const to = contract('to', user('app_users', { email: 'email_address', name: 'name' }));
    const { planned } = await planAndRun(ORIGIN, to);
    expect({
      labels:
        planned.kind === 'success'
          ? planned.plan.operations.map((op) => Reflect.get(op, 'label'))
          : [],
      collections: await collections(),
      documents: await documents('app_users'),
    }).toEqual({
      labels: ['Rename field email to email_address in collection app_users'],
      collections: ['app_users'],
      documents: [{ email_address: 'a@example.com', name: 'Ada' }],
    });
  });

  it('removes a field the destination drops from the collection already under its new name', async () => {
    await db().collection('app_users').insertOne({ email: 'a@example.com', name: 'Ada' });
    const to = contract('to', user('app_users', { email: 'email' }));
    const { planned } = await planAndRun(ORIGIN, to);
    expect({
      dataLoss: planned.kind === 'success' ? planned.dataLoss.map(({ subject }) => subject) : [],
      documents: await documents('app_users'),
    }).toEqual({
      dataLoss: [{ kind: 'field', namespaceId: '__unbound__', model: 'User', field: 'name' }],
      documents: [{ email: 'a@example.com' }],
    });
  });

  it('renames a field a statement names in the collection already under its new name', async () => {
    await db().collection('app_users').insertOne({ email: 'a@example.com', name: 'Ada' });
    const to = contract('to', user('app_users', { email: 'email', fullName: 'fullName' }));
    const { planned } = await planAndRun(ORIGIN, to, [
      renameField('User', 'name', 'User', 'fullName'),
    ]);
    expect({
      applied:
        planned.kind === 'success'
          ? planned.appliedStatements.map((each) => each.operationIndexes)
          : [],
      documents: await documents('app_users'),
    }).toEqual({
      applied: [[0]],
      documents: [{ email: 'a@example.com', fullName: 'Ada' }],
    });
  });

  it('creates the new collection when the database has neither', async () => {
    const to = contract('to', user('app_users', { email: 'email', name: 'name' }));
    expect(await labelsOf(ORIGIN, to)).toEqual(['Create collection app_users']);
  });

  const BOTH = (from: string, to: string) => ({
    kind: 'unsupportedOperation',
    summary: `Cannot rename collection "${from}" to "${to}": the database has both collections`,
    why: `The collection of model "User" changes from "${from}" to "${to}", and the database has both collection "${from}" and collection "${to}". One of two things happened, and each has its own fix. If the rename was half done by hand, or the application wrote to collection "${to}" before db update ran, collection "${from}" holds the documents of model "User": move into collection "${from}" the documents of collection "${to}" that it does not already hold, and where both collections hold a document with the same _id, keep the version you want in collection "${from}"; then drop collection "${to}", and run again. If collection "${from}" was renamed to "${to}" by hand and the name "${from}" then used for another collection, collection "${to}" holds the documents of model "User": drop collection "${from}", and run again; to keep the documents of that other collection, first move them into a collection the contract has, since db update drops every collection the contract does not have.`,
    refusedStatement: undefined,
  });

  it('refuses when the database has both collections, and the first fix renames the old one', async () => {
    await db()
      .collection('users')
      .insertOne({ _id: 1 as never, email: 'a@example.com' });
    await db()
      .collection('app_users')
      .insertOne({ _id: 2 as never, email: 'b@example.com' });
    const to = contract('to', user('app_users', { email: 'email', name: 'name' }));
    expect(await labelsOf(ORIGIN, to)).toEqual([BOTH('users', 'app_users')]);
    const written = await db().collection('app_users').find().toArray();
    await db().collection('users').insertMany(written);
    await db().dropCollection('app_users');
    await planAndRun(ORIGIN, to);
    expect({ collections: await collections(), documents: await documents('app_users') }).toEqual({
      collections: ['app_users'],
      documents: [{ email: 'a@example.com' }, { email: 'b@example.com' }],
    });
  });

  it('refuses when the database has both collections, and the second fix drops the old one', async () => {
    await db().collection('users').insertOne({ email: 'other@example.com' });
    await db().collection('app_users').insertOne({ email: 'a@example.com', name: 'Ada' });
    const to = contract('to', user('app_users', { email: 'email', name: 'name' }));
    expect(await labelsOf(ORIGIN, to)).toEqual([BOTH('users', 'app_users')]);
    await db().dropCollection('users');
    const { planned } = await planAndRun(ORIGIN, to);
    expect({
      labels:
        planned.kind === 'success'
          ? planned.plan.operations.map((op) => Reflect.get(op, 'label'))
          : [],
      collections: await collections(),
      documents: await documents('app_users'),
    }).toEqual({
      labels: [],
      collections: ['app_users'],
      documents: [{ email: 'a@example.com', name: 'Ada' }],
    });
  });
});

describe('a db update that stopped part way, run again', {
  timeout: timeouts.spinUpMongoMemoryServer,
}, () => {
  const { db, planAndRun, documents } = useStatementsDatabase('stored_name_reruns');

  it('finishes a collection and field rename that stopped after renameCollection', async () => {
    await db().collection('users').insertOne({ email: 'a@example.com', name: 'Ada' });
    await db().collection('users').rename('app_users');
    const to = contract('to', user('app_users', { email: 'email_address', name: 'name' }));
    const { planned, result } = await planAndRun(ORIGIN, to);
    expect({
      labels:
        planned.kind === 'success'
          ? planned.plan.operations.map((op) => Reflect.get(op, 'label'))
          : [],
      ok: result.ok,
      documents: await documents('app_users'),
    }).toEqual({
      labels: ['Rename field email to email_address in collection app_users'],
      ok: true,
      documents: [{ email_address: 'a@example.com', name: 'Ada' }],
    });
  });

  it('finishes value replacements that stopped after the first', async () => {
    const statuses = (seed: string, members: Readonly<Record<string, string>>) =>
      contract(
        seed,
        {
          User: {
            collection: 'users',
            fields: { status: 'status', tags: 'tags' },
            status: { status: 'one', tags: 'many' },
          },
        },
        members,
      );
    await db()
      .collection('users')
      .insertMany([
        { status: 'archived', tags: ['archived', 'active'] },
        { status: 'active', tags: [] },
      ]);
    await db()
      .collection('users')
      .updateMany({ status: 'archived' }, { $set: { status: 'retired' } });
    const { result } = await planAndRun(
      statuses('from', { ACTIVE: 'active', ARCHIVED: 'archived' }),
      statuses('to', { ACTIVE: 'active', ARCHIVED: 'retired' }),
    );
    expect({ ok: result.ok, documents: await documents('users') }).toEqual({
      ok: true,
      documents: [
        { status: 'retired', tags: ['retired', 'active'] },
        { status: 'active', tags: [] },
      ],
    });
  });

  it('finishes key renames that stopped after the first collection', async () => {
    const orders = (seed: string, sku: string) =>
      contract(seed, {
        Order: {
          collection: 'orders',
          fields: {},
          embeds: { lines: { field: 'lines', model: 'Line' } },
        },
        Quote: {
          collection: 'quotes',
          fields: {},
          embeds: { lines: { field: 'lines', model: 'Line' } },
        },
        Line: { owner: 'Order', fields: { sku } },
      });
    await db()
      .collection('orders')
      .insertOne({ lines: [{ code: 'A' }] });
    await db()
      .collection('quotes')
      .insertOne({ lines: [{ sku: 'B' }] });
    const { result } = await planAndRun(orders('from', 'sku'), orders('to', 'code'));
    expect({
      ok: result.ok,
      orders: await documents('orders'),
      quotes: await documents('quotes'),
    }).toEqual({
      ok: true,
      orders: [{ lines: [{ code: 'A' }] }],
      quotes: [{ lines: [{ code: 'B' }] }],
    });
  });

  it('stops a field rename on a document that holds both the old and the new key, and changes nothing', async () => {
    await db()
      .collection('users')
      .insertOne({ email: 'old@example.com', email_address: 'new@example.com' });
    const to = contract('to', user('users', { email: 'email_address', name: 'name' }));
    const { result } = await planAndRun(ORIGIN, to);
    expect({ ok: result.ok, documents: await documents('users') }).toEqual({
      ok: false,
      documents: [{ email: 'old@example.com', email_address: 'new@example.com' }],
    });
  });

  it('swaps boolean values with the update a boolean enum swap refusal prints, and leaves null, missing and other values alone', async () => {
    await db()
      .collection('users')
      .insertMany([
        { flag: true, flags: [true, false] },
        { flag: false, flags: [] },
        { flag: null },
        {},
      ]);
    await db()
      .collection('users')
      .updateMany({ flag: { $type: 'bool' } }, [{ $set: { flag: { $not: ['$flag'] } } }]);
    await db()
      .collection('users')
      .updateMany({ flags: { $type: 'array' } }, [
        {
          $set: {
            flags: {
              $map: {
                input: '$flags',
                in: {
                  $cond: [{ $eq: [{ $type: '$$this' }, 'bool'] }, { $not: ['$$this'] }, '$$this'],
                },
              },
            },
          },
        },
      ]);
    expect(await documents('users')).toEqual([
      { flag: false, flags: [false, true] },
      { flag: true, flags: [] },
      { flag: null },
      {},
    ]);
  });
});
