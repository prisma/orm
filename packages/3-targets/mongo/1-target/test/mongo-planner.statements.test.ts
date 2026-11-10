import type { ResolvedMigrationStatement } from '@internal/framework-components/control';
import { MongoSchemaCollection, MongoSchemaCollectionOptions } from '@internal/mongo-schema-ir';
import { describe, expect, it } from 'vitest';
import {
  contract,
  NS,
  plan,
  planned,
  profiles,
  profilesSchema,
  renameModel,
  users,
} from './mongo-statement-fixtures';

describe('MongoMigrationPlanner, model statements', () => {
  it('without a statement, drops the old collection and creates the new one', () => {
    expect(planned(plan({ from: profiles, to: users, schema: profilesSchema })).labels).toEqual([
      'Create collection users',
      'Drop index name_1 on profiles (name:1)',
      'Create index name_1 on users (name:1)',
      'Drop collection profiles',
    ]);
  });

  it('renames the collection, which keeps its indexes and validator, and reports the rename applied', () => {
    expect(
      planned(
        plan({
          from: profiles,
          to: users,
          schema: profilesSchema,
          statements: [renameModel('Profile', 'User')],
        }),
      ),
    ).toEqual({
      labels: ['Rename collection profiles to users'],
      classes: ['widening'],
      applied: [[0]],
      dataLoss: [],
    });
  });

  it('plans nothing for a model whose collection keeps its name', () => {
    const to = contract(
      'to',
      { User: { collection: 'profiles', fields: ['_id', 'name'] } },
      { profiles: { unique: ['name'], required: ['name'] } },
    );
    expect(
      planned(
        plan({
          from: profiles,
          to,
          schema: profilesSchema,
          statements: [renameModel('Profile', 'User')],
        }),
      ),
    ).toEqual({ labels: [], classes: [], applied: [[]], dataLoss: [] });
  });
});

describe('MongoMigrationPlanner, time-series options the server fills in', () => {
  it('plans nothing when the live collection holds only server defaults the contract leaves out', () => {
    const readings = contract(
      'to',
      { Reading: { collection: 'readings', fields: ['_id', 'at'] } },
      { readings: { timeField: 'at' } },
    );
    const serverFilled = {
      timeField: 'at',
      granularity: 'seconds' as const,
      bucketMaxSpanSeconds: 3600,
    };
    const live = new MongoSchemaCollection({
      name: 'readings',
      options: new MongoSchemaCollectionOptions({ timeseries: serverFilled }),
    });
    expect(planned(plan({ from: readings, to: readings, schema: [live] })).labels).toEqual([]);
  });

  const readings = contract(
    'to',
    { Reading: { collection: 'readings', fields: ['_id', 'at'] } },
    { readings: { timeField: 'at' } },
  );

  function liveReadings(extra: Record<string, unknown>) {
    const timeseries = { timeField: 'at', bucketMaxSpanSeconds: 3600, ...extra };
    return new MongoSchemaCollection({
      name: 'readings',
      options: new MongoSchemaCollectionOptions({ timeseries }),
    });
  }

  it('reports a conflict when the contract removes a declared metaField', () => {
    const result = plan({
      from: readings,
      to: readings,
      schema: [liveReadings({ metaField: 'meta', granularity: 'seconds' })],
    });
    expect(result.kind === 'failure' ? result.conflicts.map(({ summary }) => summary) : []).toEqual(
      [expect.stringContaining('timeseries')],
    );
  });

  it('reports a conflict when the contract removes a granularity other than the server default', () => {
    const result = plan({
      from: readings,
      to: readings,
      schema: [liveReadings({ granularity: 'hours' })],
    });
    expect(result.kind).toBe('failure');
  });

  it('plans nothing for custom bucketing set outside the contract', () => {
    expect(
      planned(
        plan({
          from: readings,
          to: readings,
          schema: [liveReadings({ bucketRoundingSeconds: 3600 })],
        }),
      ).labels,
    ).toEqual([]);
  });
});

describe('MongoMigrationPlanner, convert and backfill statements', () => {
  it('refuses a convert or backfill statement, which it cannot carry out', () => {
    const field = { namespaceId: NS, model: 'Profile', field: 'name' };
    const convert: ResolvedMigrationStatement = { kind: 'convert', entity: 'field', field };
    const backfill: ResolvedMigrationStatement = { kind: 'backfill', entity: 'field', field };
    const refused = (statement: ResolvedMigrationStatement) =>
      plan({ from: profiles, to: profiles, schema: profilesSchema, statements: [statement] });

    expect([refused(convert), refused(backfill)]).toEqual(
      (['convert', 'backfill'] as const).map((verb, index) => ({
        kind: 'failure',
        conflicts: [
          {
            kind: 'statementRefused',
            summary: `MongoDB does not apply ${verb} statements in this release, so nothing was planned: ${verb} field "Profile.name"`,
            why: `MongoDB cannot carry out ${verb} statements in this release. Leave out the statement.`,
            refusedStatement: [convert, backfill][index],
          },
        ],
      })),
    );
  });
});
