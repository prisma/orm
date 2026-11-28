import type { ResolvedMigrationStatement } from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import { contract, NS, plan, planned, schemaCollection } from './mongo-statement-fixtures';

/** `Admin` and `User`, root models in `people` with no discriminator, each with the fields given. */
function origin(
  fields: readonly string[],
  options: Parameters<typeof contract>[3] = {},
  enums?: Parameters<typeof contract>[4],
) {
  return contract(
    'from',
    {
      Admin: { collection: 'people', fields: ['_id', ...fields], ...options },
      User: { collection: 'people', fields: ['_id', ...fields], ...options },
    },
    { people: {} },
    {},
    enums,
  );
}

const live = [schemaCollection('people')];

describe('MongoMigrationPlanner, a root model the destination removes from a collection it shares', () => {
  it('blocks no field rename of the other model', () => {
    const to = contract(
      'to',
      { User: { collection: 'people', fields: ['_id', 'name'], storedAs: { name: 'n' } } },
      { people: {} },
    );
    expect(planned(plan({ from: origin(['name']), to, schema: live }))).toEqual({
      labels: ['Rename field name to n in collection people'],
      classes: ['widening'],
      applied: [],
      dataLoss: [],
    });
  });

  it('blocks no field rename of the other model when it also moves to its own collection', () => {
    const to = contract(
      'to',
      { User: { collection: 'members', fields: ['_id', 'name'], storedAs: { name: 'n' } } },
      { members: {} },
    );
    expect(planned(plan({ from: origin(['name']), to, schema: live }))).toEqual({
      labels: [
        'Rename collection people to members',
        'Rename field name to n in collection members',
      ],
      classes: ['widening', 'widening'],
      applied: [],
      dataLoss: [],
    });
  });

  it('blocks no field rename statement of the other model', () => {
    const statement: ResolvedMigrationStatement = {
      kind: 'rename',
      entity: 'field',
      from: { namespaceId: NS, model: 'User', field: 'name' },
      to: { namespaceId: NS, model: 'User', field: 'nick' },
    };
    const to = contract(
      'to',
      { User: { collection: 'people', fields: ['_id', 'nick'] } },
      { people: {} },
    );
    expect(
      planned(plan({ from: origin(['name']), to, schema: live, statements: [statement] })),
    ).toEqual({
      labels: ['Rename field name to nick in collection people'],
      classes: ['widening'],
      applied: [[0]],
      dataLoss: [],
    });
  });

  it('blocks no stored value replacement of an enum the other model holds', () => {
    const types = { status: { codecId: 'mongo/string@1', valueSet: 'Status' } };
    const to = contract(
      'to',
      { User: { collection: 'people', fields: ['_id', 'status'], types } },
      { people: {} },
      {},
      { Status: { members: { ACTIVE: 'act' } } },
    );
    expect(
      planned(
        plan({
          from: origin(['status'], { types }, { Status: { members: { ACTIVE: 'active' } } }),
          to,
          schema: live,
        }),
      ),
    ).toEqual({
      labels: ['Replace value "active" with "act" in field status of collection people'],
      classes: ['widening'],
      applied: [],
      dataLoss: [],
    });
  });
});
