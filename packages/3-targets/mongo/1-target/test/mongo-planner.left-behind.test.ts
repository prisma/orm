import { describe, expect, it } from 'vitest';
import {
  contract,
  NS,
  plan,
  planned,
  schemaCollection,
  sharedJsonSchema,
} from './mongo-statement-fixtures';

/** What happens to the documents a model leaves behind in `people`, and how to move them. */
const LEFT = (moving: string, to: string, reader: string) =>
  `The origin stores models "Admin" and "User" in collection "people", and no discriminator tells their documents apart, so the plan cannot move the documents of model "${moving}" to collection "${to}". They stay in collection "people", where model "${reader}" still reads them, and model "${moving}" starts with no documents. To keep them, write this change as a hand-written migration that moves them: run prisma migration new, and in the operations of the migration.ts it writes, rewrite the documents of model "${moving}" into collection "${to}" yourself, with the other operations of the change. Then run that migration.ts to emit its ops.json.`;

describe('MongoMigrationPlanner, a root model that leaves a collection it shares with other root models', () => {
  it('asks about the model that moves out when the model that stays is paired by storage with a new name', () => {
    const from = contract(
      'from',
      {
        Admin: { collection: 'people', fields: ['_id', 'admin'] },
        User: { collection: 'people', fields: ['_id', 'user'] },
      },
      { people: { jsonSchema: sharedJsonSchema(['admin'], ['user']) } },
    );
    const to = contract(
      'to',
      {
        Boss: { collection: 'people', fields: ['_id', 'admin'] },
        User: { collection: 'users', fields: ['_id', 'user'] },
      },
      { people: { jsonSchema: sharedJsonSchema(['admin']) }, users: { required: ['user'] } },
    );
    expect(
      planned(
        plan({
          from,
          to,
          schema: [
            schemaCollection('people', { jsonSchema: sharedJsonSchema(['admin'], ['user']) }),
          ],
        }),
      ),
    ).toEqual({
      labels: ['Create collection users', 'Update validator on people (removed: user)'],
      classes: ['additive', 'widening'],
      applied: [],
      dataLoss: [
        {
          operationIndex: 0,
          subject: { kind: 'model', namespaceId: NS, model: 'User' },
          loss: 'drop',
          label: 'Create collection users',
          keepDataAdvice: `${LEFT('User', 'users', 'Boss')} --delete User accepts that model "User" starts with no documents; it deletes nothing.`,
        },
      ],
    });
  });

  it('asks nothing about a model paired by storage with a new model in the same collection', () => {
    const from = contract(
      'from',
      {
        Admin: { collection: 'people', fields: ['_id', 'admin'] },
        User: { collection: 'people', fields: ['_id', 'user'] },
      },
      { people: { jsonSchema: sharedJsonSchema(['admin'], ['user']) } },
    );
    const to = contract(
      'to',
      {
        Admin: { collection: 'people', fields: ['_id', 'admin'] },
        Member: { collection: 'people', fields: ['_id', 'user'] },
      },
      { people: { jsonSchema: sharedJsonSchema(['admin'], ['user']) } },
    );
    expect(
      planned(
        plan({
          from,
          to,
          schema: [
            schemaCollection('people', { jsonSchema: sharedJsonSchema(['admin'], ['user']) }),
          ],
        }),
      ),
    ).toEqual({ labels: [], classes: [], applied: [], dataLoss: [] });
  });

  it('asks nothing about a root model the destination removes, and plans nothing when nothing else changes', () => {
    const from = contract(
      'from',
      {
        Admin: { collection: 'people', fields: ['_id', 'level'] },
        User: { collection: 'people', fields: ['_id', 'level'] },
      },
      { people: {} },
    );
    const to = contract(
      'to',
      { Admin: { collection: 'people', fields: ['_id', 'level'] } },
      { people: {} },
    );
    expect(planned(plan({ from, to, schema: [schemaCollection('people')] }))).toEqual({
      labels: [],
      classes: [],
      applied: [],
      dataLoss: [],
    });
  });

  it('refuses a model that moves out when the plan has no operation that gives it its new storage', () => {
    const from = contract(
      'from',
      {
        Admin: { collection: 'people', fields: ['_id', 'level'] },
        User: { collection: 'people', fields: ['_id', 'level'] },
      },
      { people: {}, archive: {} },
    );
    const to = contract(
      'to',
      {
        Admin: { collection: 'people', fields: ['_id', 'level'] },
        User: { collection: 'archive', fields: ['_id', 'level'] },
      },
      { people: {}, archive: {} },
    );
    expect(
      plan({ from, to, schema: [schemaCollection('people'), schemaCollection('archive')] }),
    ).toEqual({
      kind: 'failure',
      conflicts: [
        {
          kind: 'unsupportedOperation',
          summary:
            'Cannot move model "User" out of collection "people": no discriminator tells its documents apart from those of the other models stored there',
          why: `${LEFT('User', 'archive', 'Admin')} The plan has no operation that gives the model its new storage to ask about this on. Keep the model in collection "people", or move its documents with a hand-written migration first, and plan again.`,
        },
      ],
    });
  });
});
