import type { ResolvedMigrationStatement } from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import type { PlannerProducedMongoMigration } from '../src/core/migrations/planner-produced-migration';
import {
  type CollectionSpec,
  contract,
  type EnumSpec,
  type FieldTypeSpec,
  type ModelSpec,
  NS,
  plan,
  planned,
  refusal,
  renameField,
  renameModel,
  schemaCollection,
} from './mongo-statement-fixtures';

interface VariantSpec {
  readonly value: string;
  readonly fields?: readonly string[];
}

interface TaskOptions {
  /** The base's discriminator field; `type` by default. */
  readonly discriminator?: string;
  /** The discriminator field's type; a string by default. */
  readonly discriminatorType?: FieldTypeSpec;
  /** Other models stored in the collection. */
  readonly models?: Readonly<Record<string, ModelSpec>>;
  readonly enums?: Readonly<Record<string, EnumSpec>>;
}

/** Tasks discriminated by `type`, each variant stored in the base's collection with its own fields. */
function tasks(
  seed: string,
  variants: Readonly<Record<string, VariantSpec>>,
  collection: CollectionSpec = {},
  options: TaskOptions = {},
) {
  const discriminator = options.discriminator ?? 'type';
  const models: Record<string, ModelSpec> = {
    Task: {
      collection: 'tasks',
      fields: ['_id', discriminator],
      ...(options.discriminatorType === undefined
        ? {}
        : { types: { [discriminator]: options.discriminatorType } }),
      discriminator,
      variants: Object.fromEntries(
        Object.entries(variants).map(([name, { value }]) => [name, value]),
      ),
    },
    ...options.models,
  };
  for (const [name, { fields }] of Object.entries(variants)) {
    models[name] = { collection: 'tasks', fields: fields ?? [], base: 'Task' };
  }
  return contract(seed, models, { tasks: collection }, {}, options.enums);
}

const BUG: VariantSpec = { value: 'bug', fields: ['severity'] };
const EPIC: VariantSpec = { value: 'epic', fields: ['scope'] };
const BEFORE = tasks('from', { Bug: BUG, Epic: EPIC });
const live = [schemaCollection('tasks')];

const convert = (model: string): ResolvedMigrationStatement => ({
  kind: 'convert',
  entity: 'model',
  model: { namespaceId: NS, model },
});

const bugModel = { kind: 'model' as const, namespaceId: NS, model: 'Bug' };

/** The variant calls of the plan's migration.ts, without white space. */
function rendered(result: ReturnType<typeof plan>): readonly string[] {
  if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts, null, 2));
  const source = (result.plan as PlannerProducedMongoMigration)
    .renderTypeScript((specifier) => specifier)
    .replace(/\s+/g, '')
    .replace(/,\}/g, '}');
  return (
    source.match(
      /(?:replaceStoredValue|deleteDocuments|unsetField)\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)/g,
    ) ?? []
  );
}

const ONE_AT_A_TIME =
  "MongoDB applies a migration's operations one at a time, without a transaction, and knows that an operation already ran only from the documents.";

const TWO_MIGRATIONS = `${ONE_AT_A_TIME} If a later operation stops and the migration runs again, an operation whose discriminator value another operation wrote would delete or rewrite those documents a second time. Make the change in two migrations: first delete the variants, or move their values to discriminator values no variant uses, and apply that; then change the values to their final ones.`;

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
        summary:
          'Cannot convert variant "Epic": other operations of the migration free the discriminator value it writes, or write the value it frees (variant "Bug" deletes its documents with "bug" and variant "Epic" moves "epic" to "bug")',
        why: TWO_MIGRATIONS,
      },
    ]);
    expect(result.kind === 'failure' ? result.conflicts[0]?.leaveOut : undefined).toEqual([
      convert('Epic'),
    ]);
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
        summary:
          'Cannot convert variant "Bug": other operations of the migration free the discriminator value it writes, or write the value it frees (variant "Bug" moves "bug" to "epic" and variant "Epic" moves "epic" to "bug")',
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
      'Cannot convert variant "Bug": other operations of the migration free the discriminator value it writes, or write the value it frees (variant "Bug" moves "bug" to "defect" and variant "Epic" moves "epic" to "bug")',
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
      'Cannot convert variant "Epic": other operations of the migration free the discriminator value it writes, or write the value it frees (variant "Bug" deletes its documents with "bug" and variant "Epic" moves "epic" to "bug")',
    ]);
  });
});

describe('MongoMigrationPlanner, variants folded back into their base', () => {
  it('deletes no documents when the base no longer has a discriminator', () => {
    const folded = contract(
      'to',
      { Task: { collection: 'tasks', fields: ['_id', 'type', 'severity', 'scope'] } },
      { tasks: {} },
    );
    const result = plan({ from: BEFORE, to: folded, schema: live });
    expect(planned(result).labels.filter((label) => label.startsWith('Delete'))).toEqual([]);
  });
});

describe('MongoMigrationPlanner, a variant sharing its collection with another root model', () => {
  const note: Readonly<Record<string, ModelSpec>> = {
    Note: { collection: 'tasks', fields: ['_id', 'type', 'text'] },
  };
  const SHARED_WHY = (change: string) =>
    `Collection "tasks" stores several models and no discriminator tells their documents apart, so ${change} of "Note" too. To change only the documents of variant "Bug", move the models to separate collections, or carry out the change in a dataTransform operation of a migration.ts, with a filter that selects only their documents.`;

  it('refuses deleting the documents of a removed variant', () => {
    expect(
      refusal(
        plan({
          from: tasks('from', { Bug: BUG, Epic: EPIC }, {}, { models: note }),
          to: tasks('to', { Epic: EPIC }, {}, { models: note }),
          schema: live,
        }),
      ),
    ).toEqual([
      {
        kind: 'unsupportedOperation',
        summary:
          'Cannot delete the documents of variant "Bug": model "Note" is stored in collection "tasks" and its documents can hold type "bug"',
        why: SHARED_WHY('deleting the documents with that value would delete the documents'),
      },
    ]);
  });

  it('refuses a convert', () => {
    expect(
      refusal(
        plan({
          from: tasks('from', { Bug: BUG, Epic: EPIC }, {}, { models: note }),
          to: tasks('to', { Bug: { ...BUG, value: 'defect' }, Epic: EPIC }, {}, { models: note }),
          schema: live,
          statements: [convert('Bug')],
        }),
      ),
    ).toEqual([
      {
        kind: 'statementRefused',
        summary:
          'Cannot convert variant "Bug": model "Note" is stored in collection "tasks" and its documents can hold type "bug"',
        why: SHARED_WHY('replacing the value would replace it in the documents'),
      },
    ]);
  });
});

describe('MongoMigrationPlanner, an enum-typed discriminator', () => {
  const kind = (members: Readonly<Record<string, string>>): Readonly<Record<string, EnumSpec>> => ({
    Kind: { members },
  });
  const typed = (seed: string, bug: string, members: Readonly<Record<string, string>>) =>
    tasks(
      seed,
      { Bug: { ...BUG, value: bug }, Epic: EPIC },
      {},
      {
        discriminatorType: { codecId: 'mongo/string@1', valueSet: 'Kind' },
        enums: kind(members),
      },
    );
  const from = typed('from', 'bug', { BUG: 'bug', EPIC: 'epic' });
  const to = typed('to', 'defect', { DEFECT: 'defect', EPIC: 'epic' });
  const renameBug: ResolvedMigrationStatement = {
    kind: 'rename',
    entity: 'enumValue',
    from: { namespaceId: NS, enum: 'Kind', member: 'BUG' },
    to: { namespaceId: NS, enum: 'Kind', member: 'DEFECT' },
  };
  const REPLACE =
    'replaceStoredValue({collection:"tasks",field:"type",from:"bug",to:{$literal:"defect"}})';

  it('replaces the value once for the enum value rename, and deletes nothing', () => {
    const result = plan({ from, to, schema: live, statements: [renameBug] });
    expect({ ...planned(result), rendered: rendered(result) }).toEqual({
      labels: ['Replace value "bug" with "defect" in field type of collection tasks'],
      classes: ['widening'],
      applied: [[0]],
      dataLoss: [],
      rendered: [REPLACE],
    });
  });

  it('replaces the value once for the enum value rename and --convert together', () => {
    const result = plan({ from, to, schema: live, statements: [renameBug, convert('Bug')] });
    expect({ ...planned(result), rendered: rendered(result) }).toEqual({
      labels: ['Replace value "bug" with "defect" in field type of collection tasks'],
      classes: ['widening'],
      applied: [[0], [0]],
      dataLoss: [],
      rendered: [REPLACE],
    });
  });
});

describe('MongoMigrationPlanner, a variant of an embedded model', () => {
  const items = (seed: string, value: string) =>
    contract(
      seed,
      {
        User: {
          collection: 'users',
          fields: ['_id'],
          embeds: { items: { field: 'items', model: 'Item', cardinality: '1:N' } },
        },
        Item: {
          owner: 'User',
          fields: ['kind'],
          discriminator: 'kind',
          variants: { Photo: value },
        },
        Photo: { fields: ['url'], base: 'Item' },
      },
      { users: {} },
    );

  it('refuses --convert, since the plan rewrites discriminator values only in a collection', () => {
    expect(
      refusal(
        plan({
          from: items('from', 'photo'),
          to: items('to', 'image'),
          schema: [schemaCollection('users')],
          statements: [convert('Photo')],
        }),
      ),
    ).toEqual([
      {
        kind: 'statementRefused',
        summary:
          'Cannot convert variant "Photo": model "Photo" is embedded in the documents of model "User"',
        why: 'The plan rewrites discriminator values only in the collection of a base, not inside the documents of another model. Rewrite them in a dataTransform operation of migration.ts, or leave out this statement.',
      },
    ]);
  });
});
