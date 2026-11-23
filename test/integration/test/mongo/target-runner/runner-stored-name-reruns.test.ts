import { introspectSchema } from '@internal/adapter-mongo/control';
import type { AnyMongoMigrationOperation } from '@internal/mongo-query-ast/control';
import { RawUpdateManyCommand } from '@internal/mongo-query-ast/execution';
import { MongoMigrationPlanner } from '@internal/target-mongo/control';
import { dataTransform } from '@internal/target-mongo/migration';
import { timeouts } from '@repo/test-utils';
import type { Db } from 'mongodb';
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

/** Quotes the keys of a mongosh object literal, so the printed text reads as JSON. */
function asJson(text: string): unknown {
  return JSON.parse(text.replace(/([{,]\s*)(\$?[A-Za-z_][\w]*)\s*:/g, '$1"$2":'));
}

/** The `db.getCollection(<name>).updateMany(<filter>, <pipeline>)` calls of a refusal's text, as printed. */
function printedUpdates(text: string) {
  return [...text.matchAll(/db\.getCollection\(("[^"]+")\)\.updateMany\((.*?\])\)(?=;|$)/g)].map(
    ([, name, args]) => {
      const [filter, pipeline] = asJson(`[${args}]`) as [
        Record<string, unknown>,
        Record<string, unknown>[],
      ];
      return { collection: String(JSON.parse(name ?? '""')), filter, pipeline };
    },
  );
}

/**
 * Runs, against `db`, each `db.getCollection(<name>).updateMany(<filter>, <pipeline>)` of a
 * refusal's text, exactly as printed.
 */
async function runPrintedUpdates(db: Db, text: string): Promise<number> {
  const printed = printedUpdates(text);
  for (const { collection, filter, pipeline } of printed) {
    await db.collection(collection).updateMany(filter, pipeline);
  }
  return printed.length;
}

describe('a db update that stopped part way, run again', {
  timeout: timeouts.spinUpMongoMemoryServer,
}, () => {
  const { db, planAndRun, documents } = useStatementsDatabase('stored_name_reruns');

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

describe('the updates a boolean enum swap refusal prints', {
  timeout: timeouts.spinUpMongoMemoryServer,
}, () => {
  const { db, documents, initMarker, runOperations } = useStatementsDatabase(
    'stored_name_boolean_swap',
  );

  const flags = (seed: string, members: Readonly<Record<string, boolean>>) =>
    contract(
      seed,
      {
        User: {
          collection: 'users',
          fields: { flag: 'flag', flags: 'flags' },
          status: { flag: 'one', flags: 'many' },
        },
      },
      members,
      'mongo/bool@1',
    );

  const SEEDED = [
    { flag: true, flags: [true, false, 'x'] },
    { flag: false, flags: [] },
    { flag: null },
    { flag: 'yes' },
    {},
  ];
  const SWAPPED = [
    { flag: false, flags: [false, true, 'x'] },
    { flag: true, flags: [] },
    { flag: null },
    { flag: 'yes' },
    {},
  ];

  async function refusalText() {
    const result = new MongoMigrationPlanner().plan({
      contract: flags('to', { YES: false, NO: true }),
      schema: await introspectSchema(db()),
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
      fromContract: flags('from', { YES: true, NO: false }),
      origin: null,
      statements: [],
      frameworkComponents: [],
      snapshotsImportPath: '../../snapshots',
    });
    if (result.kind !== 'failure') throw new Error('Expected the swap to be refused');
    return String(result.conflicts[0]?.why);
  }

  it('swap only boolean values when run in mongosh as printed, for db update, and leave null, missing and other values alone', async () => {
    await db()
      .collection('users')
      .insertMany(SEEDED.map((document) => ({ ...document })));
    const ran = await runPrintedUpdates(db(), await refusalText());
    expect({ ran, documents: await documents('users') }).toEqual({ ran: 2, documents: SWAPPED });
  });

  it('swap only boolean values when run as the dataTransform of a migration, for migration plan, and leave null, missing and other values alone', async () => {
    await db()
      .collection('users')
      .insertMany(SEEDED.map((document) => ({ ...document })));
    const plain = flags('plain', { YES: true, NO: false });
    await initMarker(plain);
    const operations: readonly AnyMongoMigrationOperation[] = printedUpdates(
      await refusalText(),
    ).map(({ collection, filter, pipeline }, index) =>
      dataTransform(`swap-${index}`, {
        run: () => ({
          collection,
          command: new RawUpdateManyCommand(collection, filter, pipeline),
          meta: { target: 'mongo', storageHash: 'plain', lane: 'mongo-raw' },
        }),
      }),
    );
    const result = await runOperations(operations, plain, plain, {
      allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'],
    });
    expect({
      ok: result.ok,
      operations: operations.length,
      documents: await documents('users'),
    }).toEqual({ ok: true, operations: 2, documents: SWAPPED });
  });
});
