import { describe, expect, it } from 'vitest';
import {
  contract,
  NS,
  plan,
  planned,
  schemaCollection,
  sharedJsonSchema,
} from './mongo-statement-fixtures';

const liveUsers = [
  schemaCollection('users', { jsonSchema: sharedJsonSchema(['level'], ['level']) }),
];

describe('MongoMigrationPlanner, a stored name every root model of a shared collection changes alike', () => {
  const people = (seed: string, admin: string, stored: string) =>
    contract(
      seed,
      {
        Admin: { collection: 'users', fields: ['_id', admin], storedAs: { [admin]: stored } },
        User: { collection: 'users', fields: ['_id', 'level'], storedAs: { level: stored } },
      },
      { users: { jsonSchema: sharedJsonSchema([stored], [stored]) } },
    );

  it('renames the field once with no statement', () => {
    expect(
      planned(
        plan({
          from: people('from', 'level', 'level'),
          to: people('to', 'level', 'tier'),
          schema: liveUsers,
        }),
      ).labels,
    ).toEqual([
      'Rename field level to tier in collection users',
      'Update validator on users (added: tier; removed: level)',
    ]);
  });

  it('renames the field once when one model states its field rename and the other only changes @map', () => {
    expect(
      planned(
        plan({
          from: people('from', 'level', 'level'),
          to: people('to', 'rank', 'tier'),
          schema: liveUsers,
          statements: [
            {
              kind: 'rename',
              entity: 'field',
              from: { namespaceId: NS, model: 'Admin', field: 'level' },
              to: { namespaceId: NS, model: 'Admin', field: 'rank' },
            },
          ],
        }),
      ).labels,
    ).toEqual([
      'Rename field level to tier in collection users',
      'Update validator on users (added: tier; removed: level)',
    ]);
  });

  it('still refuses the field rename statement when the other model keeps the stored name', () => {
    const to = contract(
      'to',
      {
        Admin: { collection: 'users', fields: ['_id', 'rank'], storedAs: { rank: 'tier' } },
        User: { collection: 'users', fields: ['_id', 'level'] },
      },
      { users: { jsonSchema: sharedJsonSchema(['level', 'tier'], []) } },
    );
    const result = plan({
      from: people('from', 'level', 'level'),
      to,
      schema: liveUsers,
      statements: [
        {
          kind: 'rename',
          entity: 'field',
          from: { namespaceId: NS, model: 'Admin', field: 'level' },
          to: { namespaceId: NS, model: 'Admin', field: 'rank' },
        },
      ],
    });
    expect(result.kind === 'failure' ? result.conflicts.map(({ summary }) => summary) : []).toEqual(
      [
        'Cannot rename field "Admin.level" to "Admin.rank": model "User" stores field "level" in the same collection, "users"',
      ],
    );
  });
});
