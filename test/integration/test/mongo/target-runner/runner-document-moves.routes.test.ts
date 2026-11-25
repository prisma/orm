import { introspectSchema } from '@internal/adapter-mongo/control';
import { MongoMigrationPlanner } from '@internal/target-mongo/control';
import { dataTransform, deleteDocuments, rawAggregate } from '@internal/target-mongo/migration';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import {
  pastedOperations,
  policy,
  useDocumentMovesDatabase,
} from './runner-document-moves-fixtures';
import { contract, renameModel } from './runner-stored-name-fixtures';

describe('a plan whose moves are pasted from a route, as the route prints them', {
  timeout: timeouts.spinUpMongoMemoryServer,
}, () => {
  const { db, documents, initMarker, runOperations, plannedOperations } =
    useDocumentMovesDatabase('document_moves_routes');

  it('runs a move with two copies and a second move, each copy in its own dataTransform and each delete after them, as the route writes them', async () => {
    const from = contract(
      'from',
      {
        Admin: { collection: 'users', fields: { admin: 'admin' } },
        A: { collection: 'users', fields: { a: 'a' } },
        B: { collection: 'users', fields: { b: 'b' } },
        Guest: { collection: 'members', fields: { guest: 'guest' } },
        Staff: { collection: 'staff', fields: { staff: 'staff' } },
        Clerk: { collection: 'staff', fields: { clerk: 'clerk' } },
      },
      {},
    );
    const to = contract(
      'to',
      {
        Admin: { collection: 'users', fields: { admin: 'admin' } },
        A2: { collection: 'members', fields: { a: 'x' } },
        B2: { collection: 'members', fields: { b: 'y' } },
        Guest: { collection: 'members', fields: { guest: 'guest' } },
        Staff: { collection: 'staff', fields: { staff: 'staff' } },
        Teller: { collection: 'members', fields: { clerk: 'clerk' } },
      },
      {},
    );
    await db()
      .collection('users')
      .insertMany([{ admin: 'Ada' }, { a: 'Alan' }, { b: 'Barbara' }]);
    await db().collection('members').insertOne({ guest: 'Grace' });
    await db()
      .collection('staff')
      .insertMany([{ staff: 'Sam' }, { clerk: 'Carl' }]);
    await initMarker(from);
    const refused = new MongoMigrationPlanner().plan({
      contract: to,
      schema: await introspectSchema(db()),
      policy,
      fromContract: from,
      origin: { storageHash: from.storage.storageHash },
      statements: [renameModel('A', 'A2'), renameModel('B', 'B2'), renameModel('Clerk', 'Teller')],
      frameworkComponents: [],
      snapshotsImportPath: '../../snapshots',
    });
    const route = refused.kind === 'failure' ? (refused.conflicts[0]?.why ?? '') : '';
    const filters = [
      { a: { $exists: true } },
      { b: { $exists: true } },
      { $or: [{ a: { $exists: true } }, { b: { $exists: true } }] },
      { clerk: { $exists: true } },
      { clerk: { $exists: true } },
    ];
    const operations = [
      ...pastedOperations(route, filters),
      ...(await plannedOperations(from, to)),
    ];
    const result = await runOperations(operations, from, to, { policy });
    expect({
      route: [
        route.includes('add one dataTransform for each group of models whose documents change'),
        route.includes('All 3 dataTransforms go in that one migration.ts.'),
      ],
      ok: result.ok,
      users: await documents('users'),
      members: await documents('members'),
      staff: await documents('staff'),
    }).toEqual({
      route: [true, true],
      ok: true,
      users: [{ admin: 'Ada' }],
      members: [{ x: 'Alan' }, { y: 'Barbara' }, { guest: 'Grace' }, { clerk: 'Carl' }],
      staff: [{ staff: 'Sam' }],
    });
  });

  it('keeps the documents when every model leaves the source, with the drop the plan without the statements writes', async () => {
    const from = contract(
      'from',
      {
        A: { collection: 'users', fields: { a: 'a' } },
        B: { collection: 'users', fields: { b: 'b' } },
        Guest: { collection: 'members', fields: { guest: 'guest' } },
        Visitor: { collection: 'guests', fields: { visitor: 'visitor' } },
      },
      {},
    );
    const to = contract(
      'to',
      {
        A2: { collection: 'members', fields: { a: 'a' } },
        B2: { collection: 'guests', fields: { b: 'b' } },
        Guest: { collection: 'members', fields: { guest: 'guest' } },
        Visitor: { collection: 'guests', fields: { visitor: 'visitor' } },
      },
      {},
    );
    await db()
      .collection('users')
      .insertMany([{ a: 'Ada' }, { b: 'Bob' }]);
    await db().collection('members').insertOne({ guest: 'Grace' });
    await db().collection('guests').insertOne({ visitor: 'Vic' });
    await initMarker(from);
    const moves = [
      dataTransform('move A to members', {
        run: () =>
          rawAggregate('users', [
            { $match: { a: { $exists: true } } },
            { $merge: { into: 'members' } },
          ]),
      }),
      deleteDocuments({ collection: 'users', filter: { a: { $exists: true } } }),
      dataTransform('move B to guests', {
        run: () =>
          rawAggregate('users', [
            { $match: { b: { $exists: true } } },
            { $merge: { into: 'guests' } },
          ]),
      }),
      deleteDocuments({ collection: 'users', filter: { b: { $exists: true } } }),
    ];
    const planned = await plannedOperations(from, to);
    const result = await runOperations([...moves, ...planned], from, to, { policy });
    expect({
      planned: planned.map(({ label }) => label),
      ok: result.ok,
      usersDropped: !(await db().listCollections().toArray()).some(({ name }) => name === 'users'),
      members: await documents('members'),
      guests: await documents('guests'),
    }).toEqual({
      planned: ['Drop collection users'],
      ok: true,
      usersDropped: true,
      members: [{ a: 'Ada' }, { guest: 'Grace' }],
      guests: [{ b: 'Bob' }, { visitor: 'Vic' }],
    });
  });

  it('keeps the documents of every model when one is renamed and the others move to their own collections, and the plan without the statement drops the source', async () => {
    const from = contract(
      'from',
      {
        User: { collection: 'users', fields: { user: 'user' } },
        Admin: { collection: 'users', fields: { admin: 'admin' } },
        Auditor: { collection: 'users', fields: { auditor: 'auditor' } },
      },
      {},
    );
    const to = contract(
      'to',
      {
        Member: { collection: 'members', fields: { user: 'user' } },
        Admin: { collection: 'admins', fields: { admin: 'admin' } },
        Auditor: { collection: 'auditors', fields: { auditor: 'auditor' } },
      },
      {},
    );
    await db()
      .collection('users')
      .insertMany([{ user: 'Linus' }, { admin: 'Ada' }, { auditor: 'Grace' }]);
    await initMarker(from);
    const refused = new MongoMigrationPlanner().plan({
      contract: to,
      schema: await introspectSchema(db()),
      policy,
      fromContract: from,
      origin: { storageHash: from.storage.storageHash },
      statements: [renameModel('User', 'Member')],
      frameworkComponents: [],
      snapshotsImportPath: '../../snapshots',
    });
    const route = refused.kind === 'failure' ? (refused.conflicts[0]?.why ?? '') : '';
    const filters = ['user', 'admin', 'auditor'].flatMap((field) => {
      const filter = { [field]: { $exists: true } };
      return [filter, filter];
    });
    const planned = await plannedOperations(from, to);
    const created = planned.filter(({ label }) => label.startsWith('Create collection')).length;
    const operations = [
      ...planned.slice(0, created),
      ...pastedOperations(route, filters),
      ...planned.slice(created),
    ];
    const result = await runOperations(operations, from, to, { policy });
    expect({
      planned: planned.map(({ label }) => label),
      ok: result.ok,
      usersDropped: !(await db().listCollections().toArray()).some(({ name }) => name === 'users'),
      members: await documents('members'),
      admins: await documents('admins'),
      auditors: await documents('auditors'),
    }).toEqual({
      planned: [
        'Create collection admins',
        'Create collection auditors',
        'Create collection members',
        'Drop collection users',
      ],
      ok: true,
      usersDropped: true,
      members: [{ user: 'Linus' }],
      admins: [{ admin: 'Ada' }],
      auditors: [{ auditor: 'Grace' }],
    });
  });
});
