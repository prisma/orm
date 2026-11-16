import type { ResolvedMigrationStatement } from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import type { PlannerProducedMongoMigration } from '../src/core/migrations/planner-produced-migration';
import {
  type CollectionSpec,
  contract,
  type ModelSpec,
  NS,
  plan,
  planned,
  refusal,
  renameModel,
  schemaCollection,
} from './mongo-statement-fixtures';

interface VariantSpec {
  readonly value: string;
  readonly fields?: readonly string[];
}

/** Tasks discriminated by `type`, each variant stored in the base's collection with its own fields. */
function tasks(
  seed: string,
  variants: Readonly<Record<string, VariantSpec>>,
  collection: CollectionSpec = {},
) {
  const models: Record<string, ModelSpec> = {
    Task: {
      collection: 'tasks',
      fields: ['_id', 'type'],
      discriminator: 'type',
      variants: Object.fromEntries(
        Object.entries(variants).map(([name, { value }]) => [name, value]),
      ),
    },
  };
  for (const [name, { fields }] of Object.entries(variants)) {
    models[name] = { collection: 'tasks', fields: fields ?? [], base: 'Task' };
  }
  return contract(seed, models, { tasks: collection });
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
