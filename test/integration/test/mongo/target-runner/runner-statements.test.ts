import { introspectSchema } from '@internal/adapter-mongo/control';
import type { MigrationOperationPolicy } from '@internal/framework-components/control';
import { MongoCollection } from '@internal/mongo-contract';
import { MongoMigrationPlanner } from '@internal/target-mongo/control';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import {
  closedCollection,
  contract,
  NS,
  useStatementsDatabase,
} from './runner-statements-fixtures';

const live = useStatementsDatabase('runner_statements_test');

const policy: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'],
};

describe('MongoMigrationPlanner and runner - statements', () => {
  it(
    'renames a model and a uniquely indexed field behind a closed validator, keeping every document',
    async () => {
      await live.createClosed('profiles', ['name'], ['name'], [{ name: 'Ada' }, { name: 'Bo' }]);
      const from = contract(
        'from',
        { Profile: { collection: 'profiles', fields: ['_id', 'name'] } },
        { profiles: closedCollection(['name'], ['name']) },
      );
      const to = contract(
        'to',
        { User: { collection: 'users', fields: ['_id', 'fullName'] } },
        { users: closedCollection(['fullName'], ['fullName']) },
      );

      const { planned, result } = await live.planAndRun(from, to, [
        {
          kind: 'rename',
          entity: 'model',
          from: { namespaceId: NS, model: 'Profile' },
          to: { namespaceId: NS, model: 'User' },
        },
        {
          kind: 'rename',
          entity: 'field',
          from: { namespaceId: NS, model: 'Profile', field: 'name' },
          to: { namespaceId: NS, model: 'User', field: 'fullName' },
        },
      ]);

      expect(result.ok ? result.value.operationsExecuted : result.failure).toBe(5);
      expect(planned.kind === 'success' ? planned.dataLoss : undefined).toEqual([]);
      expect({
        collections: (
          await live
            .db()
            .listCollections({ name: { $in: ['profiles', 'users'] } })
            .toArray()
        ).map((c) => c.name),
        users: await live.documents('users'),
        further: await live.furtherPlanLabels(to),
      }).toEqual({
        collections: ['users'],
        users: [{ fullName: 'Ada' }, { fullName: 'Bo' }],
        further: [],
      });
      await expect(
        live
          .db()
          .collection('users')
          .updateOne({ fullName: 'Ada' }, { $set: { fullName: 'Ada L.' } }),
      ).resolves.toMatchObject({ modifiedCount: 1 });
      await expect(live.db().collection('users').insertOne({ fullName: 'Bo' })).rejects.toThrow(
        /duplicate key/,
      );
    },
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'removes a field the destination no longer has from every document',
    async () => {
      await live.createClosed(
        'users',
        ['email', 'nickname'],
        [],
        [
          { email: 'a@x', nickname: 'a' },
          { email: 'b@x', nickname: 'b' },
        ],
      );
      const from = contract(
        'from',
        { User: { collection: 'users', fields: ['_id', 'email', 'nickname'] } },
        { users: closedCollection(['email', 'nickname']) },
      );
      const to = contract(
        'to',
        { User: { collection: 'users', fields: ['_id', 'email'] } },
        { users: closedCollection(['email']) },
      );

      const { planned, result } = await live.planAndRun(from, to);

      expect(result.ok ? result.value.operationsExecuted : result.failure).toBe(2);
      expect(planned.kind === 'success' ? planned.dataLoss : undefined).toEqual([
        {
          operationIndex: 0,
          subject: { kind: 'field', namespaceId: NS, model: 'User', field: 'nickname' },
          label: 'Remove field nickname from collection users',
          loss: 'drop',
        },
      ]);
      expect({
        users: await live.documents('users'),
        further: await live.furtherPlanLabels(to),
      }).toEqual({
        users: [{ email: 'a@x' }, { email: 'b@x' }],
        further: [],
      });
      await expect(
        live
          .db()
          .collection('users')
          .updateOne({ email: 'a@x' }, { $set: { email: 'a@y' } }),
      ).resolves.toMatchObject({ modifiedCount: 1 });
    },
    timeouts.spinUpMongoMemoryServer,
  );

  function readings(storageHash: string, model: string, collection: string) {
    return contract(
      storageHash,
      { [model]: { collection, fields: ['_id', 'at'] } },
      { [collection]: new MongoCollection({ options: { timeseries: { timeField: 'at' } } }) },
    );
  }

  it(
    'plans nothing for a time-series collection that has not changed',
    async () => {
      const to = readings('to', 'Reading', 'readings');

      const { result } = await live.planAndRun(contract('from', {}, {}), to);

      expect(result.ok ? result.value.operationsExecuted : result.failure).toBe(1);
      expect(await live.furtherPlanLabels(to)).toEqual([]);
    },
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'keeps the documents of a time-series collection when its refusal is followed as printed',
    async () => {
      const from = readings('from', 'Reading', 'readings');
      const to = readings('to', 'Measurement', 'measurements');
      await live.db().createCollection('readings', { timeseries: { timeField: 'at' } });
      await live
        .db()
        .collection('readings')
        .insertOne({ at: new Date('2026-01-01T00:00:00Z') });
      const refused = new MongoMigrationPlanner().plan({
        contract: to,
        schema: await introspectSchema(live.db()),
        policy,
        fromContract: from,
        origin: { storageHash: 'from' },
        statements: [
          {
            kind: 'rename',
            entity: 'model',
            from: { namespaceId: NS, model: 'Reading' },
            to: { namespaceId: NS, model: 'Measurement' },
          },
        ],
        frameworkComponents: [],
        snapshotsImportPath: '../../snapshots',
      });
      expect(refused.kind === 'failure' ? refused.conflicts[0]?.why : refused.kind).toBe(
        'MongoDB cannot rename a time-series collection. Leave out this statement. To keep the documents, first create collection "measurements" yourself with the same time-series options and copy them into it; the plan then drops "readings" once --delete names the model.',
      );

      await live.db().createCollection('measurements', { timeseries: { timeField: 'at' } });
      const copied = await live
        .db()
        .collection('readings')
        .find({}, { projection: { _id: 0 } })
        .toArray();
      await live.db().collection('measurements').insertMany(copied);
      const { planned, result } = await live.planAndRun(from, to);

      expect(result.ok ? result.value.operationsExecuted : result.failure).toBe(1);
      expect(
        planned.kind === 'success' ? planned.dataLoss.map(({ subject }) => subject) : [],
      ).toEqual([{ kind: 'model', namespaceId: NS, model: 'Reading' }]);
      expect({
        measurements: await live
          .db()
          .collection('measurements')
          .find({}, { projection: { _id: 0 } })
          .toArray(),
        readings: await live.db().listCollections({ name: 'readings' }).toArray(),
        further: await live.furtherPlanLabels(to),
      }).toEqual({
        measurements: [{ at: new Date('2026-01-01T00:00:00Z') }],
        readings: [],
        further: [],
      });
    },
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'refuses at plan time to rename or remove a field of a live time-series collection, and plans nothing once it is kept',
    async () => {
      const withFields = (storageHash: string, fields: readonly string[]) =>
        contract(
          storageHash,
          { Reading: { collection: 'readings', fields: ['_id', 'at', ...fields] } },
          {
            readings: new MongoCollection({ options: { timeseries: { timeField: 'at' } } }),
          },
        );
      await live.db().createCollection('readings', { timeseries: { timeField: 'at' } });
      await live
        .db()
        .collection('readings')
        .insertOne({ at: new Date('2026-01-01'), value: 1 });
      const planFor = async (
        to: ReturnType<typeof withFields>,
        statements: Parameters<MongoMigrationPlanner['plan']>[0]['statements'] = [],
      ) =>
        new MongoMigrationPlanner().plan({
          contract: to,
          schema: await introspectSchema(live.db()),
          policy,
          fromContract: withFields('from', ['value']),
          origin: { storageHash: 'from' },
          statements,
          frameworkComponents: [],
          snapshotsImportPath: '../../snapshots',
        });

      const renamed = await planFor(withFields('to', ['reading']), [
        {
          kind: 'rename',
          entity: 'field',
          from: { namespaceId: NS, model: 'Reading', field: 'value' },
          to: { namespaceId: NS, model: 'Reading', field: 'reading' },
        },
      ]);
      const removed = await planFor(withFields('to', []));
      const kept = await planFor(withFields('to', ['value']));

      expect({
        renamed: renamed.kind === 'failure' ? renamed.conflicts.map(({ summary }) => summary) : [],
        removed: removed.kind === 'failure' ? removed.conflicts.map(({ summary }) => summary) : [],
        kept: kept.kind === 'success' ? kept.plan.operations.length : kept.conflicts,
      }).toEqual({
        renamed: [
          'Cannot rename field "Reading.value" to "Reading.reading": collection "readings" is a time-series collection',
        ],
        removed: [
          'Cannot remove field "value" from collection "readings": it is a time-series collection',
        ],
        kept: 0,
      });
    },
    timeouts.spinUpMongoMemoryServer,
  );
});
