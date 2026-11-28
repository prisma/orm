import { introspectSchema } from '@internal/adapter-mongo/control';
import type { MongoContract } from '@internal/mongo-contract';
import { MongoMigrationPlanner } from '@internal/target-mongo/control';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { useStatementsDatabase } from './runner-statements-fixtures';
import { contract, ORIGIN, renameField, user } from './runner-stored-name-fixtures';

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
