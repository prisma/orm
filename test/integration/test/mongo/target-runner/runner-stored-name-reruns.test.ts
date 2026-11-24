import { introspectSchema } from '@internal/adapter-mongo/control';
import type { AnyMongoMigrationOperation } from '@internal/mongo-query-ast/control';
import { MongoMigrationPlanner } from '@internal/target-mongo/control';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { useStatementsDatabase } from './runner-statements-fixtures';
import { contract, ORIGIN, user } from './runner-stored-name-fixtures';

/** The labels of the operations a plan of `planAndRun` made. */
function labels(planned: {
  readonly kind: string;
  readonly plan?: { readonly operations: readonly unknown[] };
}) {
  return (planned.plan?.operations ?? []).map((operation) =>
    Reflect.get(Object(operation), 'label'),
  );
}

describe('a db update that stopped part way, run again', {
  timeout: timeouts.spinUpMongoMemoryServer,
}, () => {
  const { db, planAndRun, documents, initMarker, runOperations } =
    useStatementsDatabase('stored_name_reruns');

  it('finishes a collection and field rename that a document holding both keys stopped after renameCollection', async () => {
    await db().collection('users').insertOne({ email: 'old@example.com', email_address: 'stale' });
    const to = contract('to', user('app_users', { email: 'email_address', name: 'name' }));
    const first = await planAndRun(ORIGIN, to);
    expect({
      labels: labels(first.planned),
      ok: first.result.ok,
      collections: (await db().listCollections().toArray())
        .map(({ name }) => name)
        .filter((name) => !name.startsWith('_prisma'))
        .sort(),
    }).toEqual({
      labels: [
        'Rename collection users to app_users',
        'Rename field email to email_address in collection app_users',
      ],
      ok: false,
      collections: ['app_users'],
    });
    await db()
      .collection('app_users')
      .updateMany({}, { $unset: { email_address: '' } });
    const second = await planAndRun(ORIGIN, to, [], [], { initMarker: false });
    expect({
      labels: labels(second.planned),
      ok: second.result.ok,
      documents: await documents('app_users'),
    }).toEqual({
      labels: ['Rename field email to email_address in collection app_users'],
      ok: true,
      documents: [{ email_address: 'old@example.com' }],
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
    const { planned, result } = await planAndRun(
      statuses('from', { ACTIVE: 'active', ARCHIVED: 'archived' }),
      statuses('to', { ACTIVE: 'active', ARCHIVED: 'retired' }),
    );
    expect({ labels: labels(planned), ok: result.ok, documents: await documents('users') }).toEqual(
      {
        labels: [
          'Replace value "archived" with "retired" in field status of collection users',
          'Replace value "archived" with "retired" in field tags of collection users',
        ],
        ok: true,
        documents: [
          { status: 'retired', tags: ['retired', 'active'] },
          { status: 'active', tags: [] },
        ],
      },
    );
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
    const { planned, result } = await planAndRun(orders('from', 'sku'), orders('to', 'code'));
    expect({
      labels: labels(planned),
      ok: result.ok,
      orders: await documents('orders'),
      quotes: await documents('quotes'),
    }).toEqual({
      labels: [
        'Rename key "sku" to "code" at path "$[*]" in field lines of collection orders',
        'Rename key "sku" to "code" at path "$[*]" in field lines of collection quotes',
      ],
      ok: true,
      orders: [{ lines: [{ code: 'A' }] }],
      quotes: [{ lines: [{ code: 'B' }] }],
    });
  });

  it('runs the same operations again to the end when a new field takes the stored name a field rename frees, after a later rename stopped', async () => {
    const from = contract('from', {
      User: { collection: 'users', fields: { email: 'email' } },
      Account: { collection: 'accounts', fields: { name: 'name' } },
    });
    const to = contract('to', {
      User: { collection: 'users', fields: { email: 'email_address', legacy: 'email' } },
      Account: { collection: 'accounts', fields: { name: 'title' } },
    });
    await db().collection('users').insertOne({ email: 'a@example.com' });
    await db().collection('accounts').insertOne({ name: 'Acme', title: 'stale' });
    await initMarker(from);
    const planned = new MongoMigrationPlanner().plan({
      contract: to,
      schema: await introspectSchema(db()),
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
      fromContract: from,
      origin: { storageHash: 'from' },
      statements: [],
      frameworkComponents: [],
      snapshotsImportPath: '../../snapshots',
    });
    if (planned.kind !== 'success') throw new Error(JSON.stringify(planned.conflicts));
    const operations = planned.plan.operations as readonly AnyMongoMigrationOperation[];
    const first = await runOperations(operations, from, to);
    await db()
      .collection('accounts')
      .updateMany({}, { $unset: { title: '' } });
    const second = await runOperations(operations, from, to);
    expect({
      labels: operations.map(({ label }) => label),
      first: first.ok,
      second: second.ok,
      users: await documents('users'),
      accounts: await documents('accounts'),
    }).toEqual({
      labels: [
        'Rename field email to email_address in collection users',
        'Rename field name to title in collection accounts',
      ],
      first: false,
      second: true,
      users: [{ email_address: 'a@example.com' }],
      accounts: [{ title: 'Acme' }],
    });
  });

  it('renames a collection, a field, a key and a stored value in one plan, in that order', async () => {
    const shop = (
      seed: string,
      collection: string,
      email: string,
      text: string,
      archived: string,
    ) =>
      contract(
        seed,
        {
          User: {
            collection,
            fields: { email, status: 'status' },
            status: { status: 'one' },
            embeds: { notes: { field: 'notes', model: 'Note' } },
          },
          Note: { owner: 'User', fields: { text } },
        },
        { ACTIVE: 'active', ARCHIVED: archived },
      );
    await db()
      .collection('users')
      .insertOne({ email: 'a@example.com', status: 'archived', notes: [{ text: 'hi' }] });
    const { planned, result } = await planAndRun(
      shop('from', 'users', 'email', 'text', 'archived'),
      shop('to', 'app_users', 'email_address', 'body', 'retired'),
    );
    expect({
      labels: labels(planned),
      ok: result.ok,
      documents: await documents('app_users'),
    }).toEqual({
      labels: [
        'Rename collection users to app_users',
        'Rename field email to email_address in collection app_users',
        'Rename key "text" to "body" at path "$[*]" in field notes of collection app_users',
        'Replace value "archived" with "retired" in field status of collection app_users',
      ],
      ok: true,
      documents: [{ email_address: 'a@example.com', status: 'retired', notes: [{ body: 'hi' }] }],
    });
  });
});
