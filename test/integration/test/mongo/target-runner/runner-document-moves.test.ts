import { introspectSchema } from '@internal/adapter-mongo/control';
import type { MigrationOperationPolicy } from '@internal/framework-components/control';
import type { MongoContract } from '@internal/mongo-contract';
import type { AnyMongoMigrationOperation } from '@internal/mongo-query-ast/control';
import { MongoMigrationPlanner } from '@internal/target-mongo/control';
import { dataTransform, deleteDocuments, rawAggregate } from '@internal/target-mongo/migration';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { closedSchema, useStatementsDatabase } from './runner-statements-fixtures';
import { contract } from './runner-stored-name-fixtures';

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
});
