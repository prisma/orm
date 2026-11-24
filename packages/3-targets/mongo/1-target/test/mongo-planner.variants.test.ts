import { describe, expect, it } from 'vitest';
import {
  type CollectionSpec,
  contract,
  NS,
  plan,
  planned,
  refusal,
  renameField,
  renameModel,
  schemaCollection,
} from './mongo-statement-fixtures';
import {
  BEFORE,
  BUG,
  bugModel,
  convert,
  deleteLabel,
  EPIC,
  live,
  rendered,
  replaceLabel,
  TWO_MIGRATIONS,
  tasks,
  type VariantSpec,
} from './mongo-variant-fixtures';

describe('MongoMigrationPlanner, a variant whose discriminator value changes', () => {
  const changed = tasks('to', { Bug: { ...BUG, value: 'defect' }, Epic: EPIC });

  it('is asked about as the model, and deletes its documents without a statement', () => {
    const result = plan({ from: BEFORE, to: changed, schema: live });
    expect({ ...planned(result), rendered: rendered(result) }).toEqual({
      labels: ['Delete the documents of collection tasks whose type is "bug"'],
      classes: ['destructive'],
      applied: [],
      dataLoss: [
        {
          operationIndex: 0,
          subject: bugModel,
          loss: 'drop',
          label: 'Delete the documents of collection tasks whose type is "bug"',
        },
      ],
      rendered: ['deleteDocuments({collection:"tasks",filter:{type:"bug"}})'],
    });
  });

  it('rewrites the stored value with --convert', () => {
    const result = plan({
      from: BEFORE,
      to: changed,
      schema: live,
      statements: [convert('Bug')],
    });
    expect({ ...planned(result), rendered: rendered(result) }).toEqual({
      labels: ['Replace value "bug" with "defect" in field type of collection tasks'],
      classes: ['widening'],
      applied: [[0]],
      dataLoss: [],
      rendered: [
        'replaceStoredValue({collection:"tasks",field:"type",from:"bug",to:{$literal:"defect"}})',
      ],
    });
  });

  it('rewrites the stored value for a rename that changes it', () => {
    const result = plan({
      from: BEFORE,
      to: tasks('to', { Defect: { ...BUG, value: 'defect' }, Epic: EPIC }),
      schema: live,
      statements: [renameModel('Bug', 'Defect')],
    });
    expect(planned(result)).toEqual({
      labels: ['Replace value "bug" with "defect" in field type of collection tasks'],
      classes: ['widening'],
      applied: [[0]],
      dataLoss: [],
    });
  });

  it('removes a field the variant loses from the documents that hold the new value, after the rewrite', () => {
    const result = plan({
      from: BEFORE,
      to: tasks('to', { Bug: { value: 'defect' }, Epic: EPIC }),
      schema: live,
      statements: [convert('Bug')],
    });
    expect(rendered(result)).toEqual([
      'replaceStoredValue({collection:"tasks",field:"type",from:"bug",to:{$literal:"defect"}})',
      'unsetField("tasks","severity",{filter:{type:"defect"}})',
    ]);
  });

  it("renames a key inside the variant's value objects after the rewrite, selecting its documents by the new value", () => {
    const withAddress = (seed: string, value: string, key: string) =>
      contract(
        seed,
        {
          Task: {
            collection: 'tasks',
            fields: ['_id', 'type'],
            discriminator: 'type',
            variants: { Bug: value },
          },
          Bug: {
            collection: 'tasks',
            fields: ['address'],
            types: { address: { codecId: '', valueObject: 'Address' } },
            base: 'Task',
          },
        },
        { tasks: {} },
        { Address: { [key]: { codecId: 'mongo/string@1' } } },
      );
    const result = plan({
      from: withAddress('from', 'bug', 'street'),
      to: withAddress('to', 'defect', 'line1'),
      schema: live,
      statements: [
        convert('Bug'),
        {
          kind: 'rename',
          entity: 'valueObjectField',
          from: { namespaceId: NS, valueObject: 'Address', field: 'street' },
          to: { namespaceId: NS, valueObject: 'Address', field: 'line1' },
        },
      ],
    });
    expect(planned(result).labels).toEqual([
      'Replace value "bug" with "defect" in field type of collection tasks',
      'Rename key "street" to "line1" at path "$" in field address of collection tasks in documents whose type is "defect"',
    ]);
  });

  it('plans nothing without an origin contract', () => {
    expect(planned(plan({ from: null, to: changed, schema: live }))).toEqual({
      labels: [],
      classes: [],
      applied: [],
      dataLoss: [],
    });
  });
});

describe('MongoMigrationPlanner, a removed variant', () => {
  it('is asked about as the model, and --delete deletes its documents', () => {
    const result = plan({ from: BEFORE, to: tasks('to', { Epic: EPIC }), schema: live });
    expect({ ...planned(result), rendered: rendered(result) }).toEqual({
      labels: ['Delete the documents of collection tasks whose type is "bug"'],
      classes: ['destructive'],
      applied: [],
      dataLoss: [
        {
          operationIndex: 0,
          subject: bugModel,
          loss: 'drop',
          label: 'Delete the documents of collection tasks whose type is "bug"',
        },
      ],
      rendered: ['deleteDocuments({collection:"tasks",filter:{type:"bug"}})'],
    });
  });

  it('deletes before another variant moves to a value nothing else uses', () => {
    const result = plan({
      from: BEFORE,
      to: tasks('to', { Epic: { ...EPIC, value: 'story' } }),
      schema: live,
      statements: [convert('Epic')],
    });
    expect(planned(result).labels).toEqual([
      'Delete the documents of collection tasks whose type is "bug"',
      'Replace value "epic" with "story" in field type of collection tasks',
    ]);
  });
});

describe('MongoMigrationPlanner, a variant renamed with its discriminator value kept', () => {
  const renamed = tasks('to', { Issue: BUG, Epic: EPIC });

  it('deletes no documents, with or without the rename, since the documents keep the collection and the value', () => {
    const without = plan({ from: BEFORE, to: renamed, schema: live });
    const withRename = plan({
      from: BEFORE,
      to: renamed,
      schema: live,
      statements: [renameModel('Bug', 'Issue')],
    });
    expect([planned(without), planned(withRename)]).toEqual([
      { labels: [], classes: [], applied: [], dataLoss: [] },
      { labels: [], classes: [], applied: [[]], dataLoss: [] },
    ]);
  });
});

describe('MongoMigrationPlanner, a new variant that takes the value of a removed one', () => {
  const saga = tasks('to', { Saga: { value: 'bug', fields: ['scope'] } });

  it('refuses a rename onto it, which would merge the removed variant into the renamed one', () => {
    const result = plan({
      from: BEFORE,
      to: saga,
      schema: live,
      statements: [renameModel('Epic', 'Saga')],
    });
    expect(refusal(result)).toEqual([
      {
        kind: 'statementRefused',
        summary: `Cannot rename model "Epic" to "Saga": the migration writes a value that another of its operations reads (${deleteLabel('bug')}; ${replaceLabel('epic', 'bug')})`,
        why: TWO_MIGRATIONS,
      },
    ]);
  });

  it('without a statement, keeps the documents of the variant stored the same way and asks about the other', () => {
    const result = plan({ from: BEFORE, to: saga, schema: live });
    expect(planned(result).dataLoss.map(({ subject }) => subject)).toEqual([
      { kind: 'model', namespaceId: NS, model: 'Epic' },
      { kind: 'field', namespaceId: NS, model: 'Bug', field: 'severity' },
    ]);
    expect(planned(result).labels[0]).toBe(deleteLabel('epic'));
  });
});

describe('MongoMigrationPlanner, a base renamed without a statement', () => {
  const renamedBase = (discriminator: string) =>
    contract(
      'to',
      {
        Ticket: {
          collection: 'tasks',
          fields: ['_id', discriminator],
          discriminator,
          variants: { Epic: 'epic' },
        },
        Epic: { collection: 'tasks', fields: ['scope'], base: 'Ticket' },
      },
      { tasks: {} },
    );

  it('pairs nothing by storage, since the base is a root model: the plan has no operation for the removed variant or the renamed discriminator', () => {
    expect({
      sameDiscriminator: planned(plan({ from: BEFORE, to: renamedBase('type'), schema: live })),
      renamedDiscriminator: planned(plan({ from: BEFORE, to: renamedBase('kind'), schema: live })),
    }).toEqual({
      sameDiscriminator: { labels: [], classes: [], applied: [], dataLoss: [] },
      renamedDiscriminator: { labels: [], classes: [], applied: [], dataLoss: [] },
    });
  });
});

describe('MongoMigrationPlanner, discriminator values one operation frees and another writes', () => {
  it('refuses a removed variant whose value another variant takes', () => {
    const result = plan({
      from: BEFORE,
      to: tasks('to', { Epic: { ...EPIC, value: 'bug' } }),
      schema: live,
      statements: [convert('Epic')],
    });
    expect(refusal(result)).toEqual([
      {
        kind: 'statementRefused',
        summary: `Cannot convert variant "Epic": the migration writes a value that another of its operations reads (${deleteLabel('bug')}; ${replaceLabel('epic', 'bug')})`,
        why: TWO_MIGRATIONS,
      },
    ]);
    expect(
      result.kind === 'failure'
        ? { ...result.conflicts[0], summary: undefined, why: undefined }
        : undefined,
    ).toEqual({
      kind: 'statementRefused',
      summary: undefined,
      why: undefined,
      refusedStatement: convert('Epic'),
    });
  });

  it('refuses two variants that swap values', () => {
    expect(
      refusal(
        plan({
          from: BEFORE,
          to: tasks('to', { Bug: { ...BUG, value: 'epic' }, Epic: { ...EPIC, value: 'bug' } }),
          schema: live,
          statements: [convert('Bug'), convert('Epic')],
        }),
      ),
    ).toEqual([
      {
        kind: 'statementRefused',
        summary: `Cannot convert variant "Bug": the migration writes a value that another of its operations reads (${replaceLabel('bug', 'epic')}; ${replaceLabel('epic', 'bug')})`,
        why: TWO_MIGRATIONS,
      },
    ]);
  });

  it('refuses a chain, where one variant takes the value another moves from', () => {
    expect(
      refusal(
        plan({
          from: BEFORE,
          to: tasks('to', { Bug: { ...BUG, value: 'defect' }, Epic: { ...EPIC, value: 'bug' } }),
          schema: live,
          statements: [convert('Bug'), convert('Epic')],
        }),
      )[0]?.summary,
    ).toBe(
      `Cannot convert variant "Bug": the migration writes a value that another of its operations reads (${replaceLabel('bug', 'defect')}; ${replaceLabel('epic', 'bug')})`,
    );
  });
});

describe('MongoMigrationPlanner, variant rewrites it refuses', () => {
  const changed = (collection: CollectionSpec) =>
    tasks('to', { Bug: { ...BUG, value: 'defect' }, Epic: EPIC }, collection);

  it('refuses a convert in a time-series collection', () => {
    expect(
      refusal(
        plan({
          from: tasks('from', { Bug: BUG, Epic: EPIC }, { timeField: 'at' }),
          to: changed({ timeField: 'at' }),
          schema: [schemaCollection('tasks', { timeseries: true })],
          statements: [convert('Bug')],
        }),
      ),
    ).toEqual([
      {
        kind: 'statementRefused',
        summary: 'Cannot convert variant "Bug": collection "tasks" is a time-series collection',
        why: 'MongoDB updates the documents of a time-series collection only through its metaField, so the plan does not rewrite or delete the documents of a variant there. Keep the variant and its discriminator value in the contract, then run this command again.',
      },
    ]);
  });

  it('refuses deleting the documents of a variant in a time-series collection', () => {
    expect(
      refusal(
        plan({
          from: tasks('from', { Bug: BUG, Epic: EPIC }, { timeField: 'at' }),
          to: tasks('to', { Epic: EPIC }, { timeField: 'at' }),
          schema: [schemaCollection('tasks', { timeseries: true })],
        }),
      ),
    ).toEqual([
      {
        kind: 'unsupportedOperation',
        summary:
          'Cannot delete the documents of variant "Bug": collection "tasks" is a time-series collection',
        why: 'MongoDB updates the documents of a time-series collection only through its metaField, so the plan does not rewrite or delete the documents of a variant there. Keep the variant and its discriminator value in the contract, then run this command again.',
      },
    ]);
  });

  it('refuses a convert in a collection that is not managed', () => {
    expect(
      refusal(
        plan({
          from: tasks('from', { Bug: BUG, Epic: EPIC }, { control: 'external' }),
          to: changed({ control: 'external' }),
          schema: live,
          statements: [convert('Bug')],
        }),
      ),
    ).toEqual([
      {
        kind: 'statementRefused',
        summary: 'Cannot convert variant "Bug": collection "tasks" has control policy "external"',
        why: 'Statements rename only collections, and fields of collections, whose control policy is "managed". Make the change in the database yourself and leave out this statement.',
      },
    ]);
  });

  it('leaves the documents of a variant in a collection that is not managed as they are', () => {
    expect(
      planned(
        plan({
          from: tasks('from', { Bug: BUG, Epic: EPIC }, { control: 'external' }),
          to: changed({ control: 'external' }),
          schema: live,
        }),
      ).labels,
    ).toEqual([]);
  });
});

describe('MongoMigrationPlanner, a removed variant whose base renames its discriminator field', () => {
  const renamed = (variants: Readonly<Record<string, VariantSpec>>) =>
    tasks('to', variants, {}, { discriminator: 'kind' });
  const renameType = renameField('Task', 'type', 'Task', 'kind');

  it('deletes its documents by the field as the destination stores it', () => {
    const result = plan({
      from: BEFORE,
      to: renamed({ Epic: EPIC }),
      schema: live,
      statements: [renameType],
    });
    expect(rendered(result)).toEqual(['deleteDocuments({collection:"tasks",filter:{kind:"bug"}})']);
  });

  it('refuses another variant taking the value it frees', () => {
    expect(
      refusal(
        plan({
          from: BEFORE,
          to: renamed({ Epic: { ...EPIC, value: 'bug' } }),
          schema: live,
          statements: [renameType, convert('Epic')],
        }),
      ).map(({ summary }) => summary),
    ).toEqual([
      `Cannot convert variant "Epic": the migration writes a value that another of its operations reads (${deleteLabel('bug', 'kind')}; ${replaceLabel('epic', 'bug', 'kind')})`,
    ]);
  });
});
