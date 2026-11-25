import { introspectSchema } from '@internal/adapter-mongo/control';
import type { MigrationOperationPolicy } from '@internal/framework-components/control';
import type { MongoContract } from '@internal/mongo-contract';
import type { AnyMongoMigrationOperation } from '@internal/mongo-query-ast/control';
import { MongoMigrationPlanner } from '@internal/target-mongo/control';
import { dataTransform, deleteDocuments, rawAggregate } from '@internal/target-mongo/migration';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { closedSchema, useStatementsDatabase } from './runner-statements-fixtures';
import { contract, renameModel } from './runner-stored-name-fixtures';

const policy: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'],
};
const USERS = { $match: { user: { $exists: true } } };
const GUEST_ONLY = closedSchema(['guest']);
const GUEST_OR_MEMBER = { bsonType: 'object', anyOf: [GUEST_ONLY, closedSchema(['user'])] };

/** The move of `User`'s documents out of `users`, as the refusal of `--rename User:Member` gives it. */
const move = [
  dataTransform('move User to members', {
    run: () =>
      rawAggregate('users', [USERS, { $merge: { into: 'members' } }], {
        bypassDocumentValidation: true,
      }),
  }),
  deleteDocuments({ collection: 'users', filter: { user: { $exists: true } } }),
];

/**
 * The operations a route prints, in order, as a user pastes them: each `rawAggregate` call as the
 * run of its own `dataTransform`, and each `deleteDocuments` call. The filter placeholder of the
 * n-th call becomes `filters[n]`.
 */
function pastedOperations(
  route: string,
  filters: readonly Record<string, unknown>[],
): readonly AnyMongoMigrationOperation[] {
  const calls = [
    ...route.matchAll(/\n {2}(rawAggregate\([\s\S]*?\n {2}\]\)|deleteDocuments\(.*\))/g),
  ].map((match) => match[1] ?? '');
  if (calls.length !== filters.length) {
    throw new Error(`Expected ${filters.length} calls in the route, found ${calls.length}`);
  }
  return calls.map((call, index) => {
    const pasted: {
      copy?: ReturnType<typeof rawAggregate>;
      delete?: ReturnType<typeof deleteDocuments>;
    } = {};
    new Function(
      'rawAggregate',
      'deleteDocuments',
      'filter',
      call.replace(/<a filter[^>]*>|<the same filter>/, 'filter'),
    )(
      (...args: Parameters<typeof rawAggregate>) => {
        pasted.copy = rawAggregate(...args);
      },
      (...args: Parameters<typeof deleteDocuments>) => {
        pasted.delete = deleteDocuments(...args);
      },
      filters[index],
    );
    const { copy } = pasted;
    if (copy !== undefined) return dataTransform(`pasted copy ${index}`, { run: () => copy });
    if (pasted.delete === undefined) throw new Error(`Cannot evaluate ${call}`);
    return pasted.delete;
  });
}

describe('a plan that moves documents into a collection whose validator it then replaces', {
  timeout: timeouts.spinUpMongoMemoryServer,
}, () => {
  const { db, documents, initMarker, runOperations } = useStatementsDatabase('document_moves');

  async function plannedOperations(from: MongoContract, to: MongoContract) {
    const planned = new MongoMigrationPlanner().plan({
      contract: to,
      schema: await introspectSchema(db()),
      policy,
      fromContract: from,
      origin: { storageHash: from.storage.storageHash },
      statements: [],
      frameworkComponents: [],
      snapshotsImportPath: '../../snapshots',
    });
    if (planned.kind !== 'success') throw new Error(JSON.stringify(planned.conflicts, null, 2));
    return planned.plan.operations as readonly AnyMongoMigrationOperation[];
  }

  /** Runs `operations`, stopping when the one labelled `stopAt` starts, and reports whether it stopped. */
  async function runStoppingAt(
    operations: readonly AnyMongoMigrationOperation[],
    from: MongoContract,
    to: MongoContract,
    stopAt: string,
  ) {
    const stop = new Error(`stopped at ${stopAt}`);
    return runOperations(operations, from, to, {
      policy,
      callbacks: {
        onOperationStart: (operation) => {
          if (operation.label === stopAt) throw stop;
        },
      },
    }).then(
      () => 'ran',
      (error: unknown) => (error === stop ? 'stopped' : error),
    );
  }

  async function bothCollections() {
    return { users: await documents('users'), members: await documents('members') };
  }

  describe('a target that exists', () => {
    const from = contract(
      'from',
      {
        Admin: { collection: 'users', fields: { admin: 'admin' } },
        User: { collection: 'users', fields: { user: 'user' } },
        Guest: { collection: 'members', fields: { guest: 'guest' } },
      },
      {},
      'mongo/string@1',
      { members: GUEST_ONLY },
    );
    const to = contract(
      'to',
      {
        Admin: { collection: 'users', fields: { admin: 'role' } },
        Member: { collection: 'members', fields: { user: 'user' } },
        Guest: { collection: 'members', fields: { guest: 'guest' } },
      },
      {},
      'mongo/string@1',
      { members: GUEST_OR_MEMBER },
    );
    const MOVED = {
      users: [{ role: 'Ada' }],
      members: [{ user: 'Linus' }, { guest: 'Grace' }],
    };

    async function seed() {
      await db()
        .collection('users')
        .insertMany([{ admin: 'Ada' }, { user: 'Linus' }]);
      await db().createCollection('members', {
        validator: { $jsonSchema: GUEST_ONLY },
        validationLevel: 'strict',
        validationAction: 'error',
      });
      await db().collection('members').insertOne({ guest: 'Grace' });
      await initMarker(from);
      return [...move, ...(await plannedOperations(from, to))];
    }

    it('runs with the move at the start, before the rename of the field that stays', async () => {
      const operations = await seed();
      const result = await runOperations(operations, from, to, { policy });
      expect({
        labels: operations.map(({ label }) => label),
        ok: result.ok,
        ...(await bothCollections()),
      }).toEqual({
        labels: [
          'Data transform: move User to members',
          'Delete the documents of collection users matching {"user":{"$exists":true}}',
          'Rename field admin to role in collection users',
          'Update validator on members (added: user)',
        ],
        ok: true,
        ...MOVED,
      });
    });

    it.each([
      'Delete the documents of collection users matching {"user":{"$exists":true}}',
      'Update validator on members (added: user)',
    ])('finishes when run again after it stopped at "%s"', async (stopAt) => {
      const operations = await seed();
      const stopped = await runStoppingAt(operations, from, to, stopAt);
      const afterStop = await bothCollections();
      const again = await runOperations(operations, from, to, { policy });
      expect({ stopped, afterStop, ok: again.ok, ...(await bothCollections()) }).toEqual({
        stopped: 'stopped',
        afterStop: stopAt.startsWith('Delete')
          ? { users: [{ admin: 'Ada' }, { user: 'Linus' }], members: MOVED.members }
          : { users: [{ role: 'Ada' }], members: MOVED.members },
        ok: true,
        ...MOVED,
      });
    });
  });

  it('runs with the move right after the rename of another collection to the target', async () => {
    const from = contract(
      'from',
      {
        Admin: { collection: 'users', fields: { admin: 'admin' } },
        User: { collection: 'users', fields: { user: 'user' } },
        Guest: { collection: 'guests', fields: { guest: 'guest' } },
      },
      {},
      'mongo/string@1',
      { guests: GUEST_ONLY },
    );
    const to = contract(
      'to',
      {
        Admin: { collection: 'users', fields: { admin: 'admin' } },
        Member: { collection: 'members', fields: { user: 'user' } },
        Guest: { collection: 'members', fields: { guest: 'guest' } },
      },
      {},
      'mongo/string@1',
      { members: GUEST_OR_MEMBER },
    );
    await db()
      .collection('users')
      .insertMany([{ admin: 'Ada' }, { user: 'Linus' }]);
    await db().createCollection('guests', {
      validator: { $jsonSchema: GUEST_ONLY },
      validationLevel: 'strict',
      validationAction: 'error',
    });
    await db().collection('guests').insertOne({ guest: 'Grace' });
    await initMarker(from);
    const [rename, ...rest] = await plannedOperations(from, to);
    if (rename === undefined) throw new Error('Expected a plan');
    const operations = [rename, ...move, ...rest];
    const result = await runOperations(operations, from, to, { policy });
    expect({
      labels: operations.map(({ label }) => label),
      ok: result.ok,
      ...(await bothCollections()),
    }).toEqual({
      labels: [
        'Rename collection guests to members',
        'Data transform: move User to members',
        'Delete the documents of collection users matching {"user":{"$exists":true}}',
        'Update validator on members (added: user)',
      ],
      ok: true,
      users: [{ admin: 'Ada' }],
      members: [{ user: 'Linus' }, { guest: 'Grace' }],
    });
  });

  it("writes the moving model's new stored names in the copy into a target with a closed validator", async () => {
    const from = contract(
      'from',
      {
        Admin: { collection: 'users', fields: { admin: 'admin' } },
        User: { collection: 'users', fields: { user: 'user', name: 'name' } },
        Guest: { collection: 'members', fields: { guest: 'guest' } },
      },
      {},
      'mongo/string@1',
      { members: GUEST_ONLY },
    );
    const to = contract(
      'to',
      {
        Admin: { collection: 'users', fields: { admin: 'admin' } },
        Member: { collection: 'members', fields: { user: 'user', name: 'fullName' } },
        Guest: { collection: 'members', fields: { guest: 'guest' } },
      },
      {},
      'mongo/string@1',
      { members: { bsonType: 'object', anyOf: [GUEST_ONLY, closedSchema(['user', 'fullName'])] } },
    );
    await db()
      .collection('users')
      .insertMany([{ admin: 'Ada' }, { user: 'linus', name: 'Linus' }]);
    await db().createCollection('members', {
      validator: { $jsonSchema: GUEST_ONLY },
      validationLevel: 'strict',
      validationAction: 'error',
    });
    await db().collection('members').insertOne({ guest: 'Grace' });
    await initMarker(from);
    const copy = dataTransform('move User to members', {
      run: () =>
        rawAggregate(
          'users',
          [
            USERS,
            { $set: { fullName: '$name' } },
            { $unset: ['name'] },
            { $merge: { into: 'members' } },
          ],
          { bypassDocumentValidation: true },
        ),
    });
    const operations = [
      copy,
      deleteDocuments({ collection: 'users', filter: { user: { $exists: true } } }),
      ...(await plannedOperations(from, to)),
    ];
    const result = await runOperations(operations, from, to, { policy });
    expect({
      labels: operations.map(({ label }) => label),
      ok: result.ok,
      ...(await bothCollections()),
    }).toEqual({
      labels: [
        'Data transform: move User to members',
        'Delete the documents of collection users matching {"user":{"$exists":true}}',
        'Update validator on members (added: user, fullName)',
      ],
      ok: true,
      users: [{ admin: 'Ada' }],
      members: [{ user: 'linus', fullName: 'Linus' }, { guest: 'Grace' }],
    });
  });

  it('drops in the copy the field the moving model no longer stores, so the closed validator of the target accepts the moved documents', async () => {
    const from = contract(
      'from',
      {
        Admin: { collection: 'users', fields: { admin: 'admin' } },
        User: { collection: 'users', fields: { user: 'user', extra: 'extra' } },
        Guest: { collection: 'members', fields: { guest: 'guest' } },
      },
      {},
      'mongo/string@1',
      { members: GUEST_ONLY },
    );
    const to = contract(
      'to',
      {
        Admin: { collection: 'users', fields: { admin: 'admin' } },
        Member: { collection: 'members', fields: { user: 'user' } },
        Guest: { collection: 'members', fields: { guest: 'guest' } },
      },
      {},
      'mongo/string@1',
      { members: GUEST_OR_MEMBER },
    );
    await db()
      .collection('users')
      .insertMany([{ admin: 'Ada' }, { user: 'Linus', extra: 'x' }]);
    await db().createCollection('members', {
      validator: { $jsonSchema: GUEST_ONLY },
      validationLevel: 'strict',
      validationAction: 'error',
    });
    await db().collection('members').insertOne({ guest: 'Grace' });
    await initMarker(from);
    const copy = dataTransform('move User to members', {
      run: () =>
        rawAggregate('users', [USERS, { $unset: ['extra'] }, { $merge: { into: 'members' } }], {
          bypassDocumentValidation: true,
        }),
    });
    const operations = [
      copy,
      deleteDocuments({ collection: 'users', filter: { user: { $exists: true } } }),
      ...(await plannedOperations(from, to)),
    ];
    const result = await runOperations(operations, from, to, { policy });
    expect({ ok: result.ok, ...(await bothCollections()) }).toEqual({
      ok: true,
      users: [{ admin: 'Ada' }],
      members: [{ user: 'Linus' }, { guest: 'Grace' }],
    });
  });

  it('stops at the validator check and says that the copy, which has no check, runs again', async () => {
    const from = contract(
      'from',
      {
        Admin: { collection: 'users', fields: { admin: 'admin' } },
        User: { collection: 'users', fields: { user: 'user' } },
        Guest: { collection: 'members', fields: { guest: 'guest' } },
      },
      {},
      'mongo/string@1',
      { members: GUEST_ONLY },
    );
    const to = contract(
      'to',
      {
        Admin: { collection: 'users', fields: { admin: 'role' } },
        Member: { collection: 'members', fields: { user: 'user' } },
        Guest: { collection: 'members', fields: { guest: 'guest' } },
      },
      {},
      'mongo/string@1',
      { members: GUEST_OR_MEMBER },
    );
    await db()
      .collection('users')
      .insertMany([{ admin: 'Ada' }, { user: 7 }]);
    await db().createCollection('members', {
      validator: { $jsonSchema: GUEST_ONLY },
      validationLevel: 'strict',
      validationAction: 'error',
    });
    await db().collection('members').insertOne({ guest: 'Grace' });
    await initMarker(from);
    const operations = [...move, ...(await plannedOperations(from, to))];
    const result = await runOperations(operations, from, to, { policy });
    if (result.ok) throw new Error('Expected the validator check to stop the apply');
    expect({
      code: result.failure.code,
      why: result.failure.why,
    }).toEqual({
      code: 'MIGRATION.PRECHECK_FAILED',
      why: expect.stringContaining(
        'This operation did not change the validator. Once the documents are fixed, run the command again. An operation whose check shows it already ran is skipped; an operation with no check, such as a copy in a dataTransform, runs again.',
      ),
    });
  });

  it('names the document a copy into a new collection writes and the validator rejects', async () => {
    const from = contract(
      'from',
      {
        Admin: { collection: 'users', fields: { admin: 'admin' } },
        User: { collection: 'users', fields: { user: 'user' } },
      },
      {},
    );
    const to = contract(
      'to',
      {
        Admin: { collection: 'users', fields: { admin: 'admin' } },
        Member: { collection: 'members', fields: { user: 'user' } },
      },
      {},
      'mongo/string@1',
      { members: closedSchema(['user']) },
    );
    const inserted = await db()
      .collection('users')
      .insertMany([{ admin: 'Ada' }, { user: 7 }]);
    await initMarker(from);
    const [create, ...rest] = await plannedOperations(from, to);
    if (create === undefined) throw new Error('Expected a plan');
    const copy = dataTransform('move User to members', {
      run: () => rawAggregate('users', [USERS, { $merge: { into: 'members' } }]),
    });
    const result = await runOperations([create, copy, ...rest], from, to, { policy });
    if (result.ok) throw new Error('Expected the copy to be rejected');
    expect(result.failure.why).toContain(
      `The rejected document has _id ObjectId("${String(inserted.insertedIds[1])}"): find it with db.getCollection("users").find({ _id: ObjectId("${String(inserted.insertedIds[1])}") }) in mongosh.`,
    );
  });

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
