import type { ResolvedMigrationStatement } from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import type { PlannerProducedMongoMigration } from '../src/core/migrations/planner-produced-migration';
import {
  contract,
  listedOperations,
  type ModelSpec,
  NS,
  plan,
  planned,
  refusal,
  renameField,
  renameModel,
} from './mongo-statement-fixtures';
import {
  BEFORE,
  BUG,
  convert,
  EPIC,
  live,
  ONE_AT_A_TIME,
  replaceLabel,
  tasks,
  type VariantSpec,
} from './mongo-variant-fixtures';

describe('MongoMigrationPlanner, a discriminator renamed without its statement', () => {
  const renameType = renameField('Task', 'type', 'Task', 'kind');
  const backfillKind: ResolvedMigrationStatement = {
    kind: 'backfill',
    entity: 'field',
    field: { namespaceId: NS, model: 'Task', field: 'kind' },
  };
  const after = (variants: Readonly<Record<string, VariantSpec>>) =>
    tasks('to', variants, {}, { discriminator: 'kind' });
  const valueChanged = after({ Bug: { ...BUG, value: 'defect' }, Epic: EPIC });
  const NO_TEMPORARY_VALUE =
    "A document's discriminator value says which variant it is, and no temporary value names a variant, so the plan does not fill the field.";
  const kindRefusal = {
    kind: 'unsupportedOperation',
    summary:
      'Cannot plan the migration: new discriminator field "Task.kind" has no value in the documents of collection tasks',
    why: `${NO_TEMPORARY_VALUE} The documents hold their variant in "Task.type", which the plan removes: add --rename Task.type:Task.kind to keep it, and run the command again.`,
  };

  it('refuses the plan and offers the rename, for the rename alone, a changed variant value and a removed variant', () => {
    expect(
      [after({ Bug: BUG, Epic: EPIC }), valueChanged, after({ Epic: EPIC })].map((to) =>
        refusal(plan({ from: BEFORE, to, schema: live })),
      ),
    ).toEqual([[kindRefusal], [kindRefusal], [kindRefusal]]);
  });

  const jobs = contract(
    'to',
    {
      Job: {
        collection: 'tasks',
        fields: ['_id', 'kind'],
        discriminator: 'kind',
        variants: { Bug: 'bug', Epic: 'epic' },
      },
      Bug: { collection: 'tasks', fields: ['severity'], base: 'Job' },
      Epic: { collection: 'tasks', fields: ['scope'], base: 'Job' },
    },
    { tasks: {} },
  );

  it('offers the rename of the base with the discriminator rename when no statement renames the base', () => {
    expect(refusal(plan({ from: BEFORE, to: jobs, schema: live }))).toEqual([
      {
        kind: 'unsupportedOperation',
        summary:
          'Cannot plan the migration: new discriminator field "Job.kind" has no value in the documents of collection tasks',
        why: `${NO_TEMPORARY_VALUE} The documents hold their variant in "Task.type", which the plan removes: add --rename Task:Job --rename Job.type:Job.kind to keep it, and run the command again.`,
      },
    ]);
  });

  it("names the discriminator rename through the base's new name when the base is renamed too", () => {
    expect(
      refusal(
        plan({ from: BEFORE, to: jobs, schema: live, statements: [renameModel('Task', 'Job')] }),
      ),
    ).toEqual([
      {
        kind: 'unsupportedOperation',
        summary:
          'Cannot plan the migration: new discriminator field "Job.kind" has no value in the documents of collection tasks',
        why: `${NO_TEMPORARY_VALUE} The documents hold their variant in "Task.type", which the plan removes: add --rename Job.type:Job.kind to keep it, and run the command again.`,
      },
    ]);
  });

  it('refuses --convert Bug when the old discriminator is deleted instead of renamed', () => {
    expect(
      refusal(plan({ from: BEFORE, to: valueChanged, schema: live, statements: [convert('Bug')] })),
    ).toEqual([kindRefusal]);
  });

  it('plans no fill of the discriminator a base gains first, and no refusal', () => {
    const plain = contract(
      'from',
      { Task: { collection: 'tasks', fields: ['_id'] } },
      {
        tasks: {},
      },
    );
    expect(
      planned(plan({ from: plain, to: after({ Bug: BUG, Epic: EPIC }), schema: live })).labels,
    ).toEqual([]);
  });

  it('plans a backfill of the discriminator a base gains first, as the document check offers', async () => {
    const plain = contract(
      'from',
      { Task: { collection: 'tasks', fields: ['_id'] } },
      { tasks: {} },
    );
    const result = plan({
      from: plain,
      to: after({ Bug: BUG, Epic: EPIC }),
      schema: live,
      statements: [backfillKind],
    });
    if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts, null, 2));
    expect(await listedOperations(result.plan as PlannerProducedMongoMigration)).toEqual([
      expect.objectContaining({ operationClass: 'data' }),
    ]);
  });

  describe('with the old discriminator kept as a field', () => {
    const kindBesideType = (bug: ModelSpec, bugValue = 'bug', seed = 'to') =>
      contract(
        seed,
        {
          Task: {
            collection: 'tasks',
            fields: ['_id', 'type', 'kind'],
            discriminator: 'kind',
            variants: { Bug: bugValue, Epic: 'epic' },
          },
          Bug: { collection: 'tasks', base: 'Task', ...bug },
          Epic: { collection: 'tasks', fields: ['scope'], base: 'Task' },
        },
        { tasks: {} },
      );
    const ids = async (
      statements: readonly ResolvedMigrationStatement[],
      to: ReturnType<typeof contract>,
    ) => {
      const result = plan({ from: BEFORE, to, schema: live, statements });
      if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts, null, 2));
      return (await listedOperations(result.plan as PlannerProducedMongoMigration)).map(
        (operation) => Reflect.get(operation ?? {}, 'id'),
      );
    };

    it('refuses a changed variant value until the new discriminator holds the current values, and plans each of the two steps it gives', async () => {
      const valueChangedBesideType = kindBesideType({ fields: ['severity'] }, 'defect');
      const kindHolds = kindBesideType({ fields: ['severity'] }, 'bug', 'from');
      expect({
        refused: refusal(
          plan({
            from: BEFORE,
            to: valueChangedBesideType,
            schema: live,
            statements: [convert('Bug')],
          }),
        ),
        first: await ids([backfillKind], kindHolds),
        second: planned(
          plan({
            from: kindHolds,
            to: valueChangedBesideType,
            schema: live,
            statements: [convert('Bug')],
          }),
        ).labels,
      }).toEqual({
        refused: [
          {
            kind: 'statementRefused',
            summary:
              'Cannot convert variant "Bug": its documents hold their discriminator value in field "type", which the plan does not rename to "kind"',
            why: `The plan rewrites the documents of a variant by their value in field "kind", which only a rename of field "type" gives them. Make the change as two changes to the contract, and apply the first, by a migration or by db update, before you make the second: first make "kind" the discriminator with the variants' current values, giving every document its value there (under migration plan, with --backfill Task.kind); then change the variants.`,
          },
        ],
        first: ['data_transform.Task.kind'],
        second: [replaceLabel('bug', 'defect', 'kind')],
      });
    });

    it('backfills the discriminator before a backfill of a variant field selected by it, in either order of the statements', async () => {
      const to = kindBesideType({ fields: ['severity', 'level'] });
      const backfillLevel: ResolvedMigrationStatement = {
        kind: 'backfill',
        entity: 'field',
        field: { namespaceId: NS, model: 'Bug', field: 'level' },
      };
      expect({
        kindFirst: await ids([backfillKind, backfillLevel], to),
        levelFirst: await ids([backfillLevel, backfillKind], to),
      }).toEqual({
        kindFirst: ['data_transform.Task.kind', 'data_transform.Bug.level'],
        levelFirst: ['data_transform.Task.kind', 'data_transform.Bug.level'],
      });
    });

    it('backfills the discriminator before a conversion of a variant field selected by it, in either order of the statements', async () => {
      const to = kindBesideType({
        fields: ['severity'],
        types: { severity: { codecId: 'mongo/int32@1' } },
      });
      const convertSeverity: ResolvedMigrationStatement = {
        kind: 'convert',
        entity: 'field',
        field: { namespaceId: NS, model: 'Bug', field: 'severity' },
      };
      expect({
        kindFirst: await ids([backfillKind, convertSeverity], to),
        convertFirst: await ids([convertSeverity, backfillKind], to),
      }).toEqual({
        kindFirst: ['data_transform.Task.kind', 'data_transform.Bug.severity'],
        convertFirst: ['data_transform.Task.kind', 'data_transform.Bug.severity'],
      });
    });
  });

  it('plans no fill of a new discriminator when the old one stays as a field', () => {
    const typeKept = contract(
      'to',
      {
        Task: {
          collection: 'tasks',
          fields: ['_id', 'type', 'kind'],
          discriminator: 'kind',
          variants: { Bug: 'bug', Epic: 'epic' },
        },
        Bug: { collection: 'tasks', fields: ['severity'], base: 'Task' },
        Epic: { collection: 'tasks', fields: ['scope'], base: 'Task' },
      },
      { tasks: {} },
    );
    expect(planned(plan({ from: BEFORE, to: typeKept, schema: live })).labels).toEqual([]);
  });

  it('refuses a variant convert or delete that selects documents by a discriminator the plan backfills instead of renaming', () => {
    const refusedWhy =
      'The plan rewrites the documents of a variant by their value in field "kind", which only a rename of field "type" gives them. Add --rename Task.type:Task.kind and run the command again.';
    expect({
      converted: refusal(
        plan({
          from: BEFORE,
          to: valueChanged,
          schema: live,
          statements: [backfillKind, convert('Bug')],
        }),
      ),
      deleted: refusal(
        plan({ from: BEFORE, to: after({ Epic: EPIC }), schema: live, statements: [backfillKind] }),
      ),
    }).toEqual({
      converted: [
        {
          kind: 'statementRefused',
          summary:
            'Cannot convert variant "Bug": its documents hold their discriminator value in field "type", which the plan does not rename to "kind"',
          why: refusedWhy,
        },
      ],
      deleted: [
        {
          kind: 'unsupportedOperation',
          summary:
            'Cannot plan the migration: the documents of variant "Bug" hold their discriminator value in field "type", which the plan does not rename to "kind"',
          why: refusedWhy,
        },
      ],
    });
  });

  it('plans the change with the rename, and fills no discriminator', () => {
    expect(
      planned(
        plan({
          from: BEFORE,
          to: valueChanged,
          schema: live,
          statements: [renameType, convert('Bug')],
        }),
      ).labels,
    ).toEqual([
      'Rename field type to kind in collection tasks',
      replaceLabel('bug', 'defect', 'kind'),
    ]);
  });
});

describe('MongoMigrationPlanner, a plan-wide refusal involving a removed variant', () => {
  it('offers the rename to the one new variant of its base, and nothing for the fields of the removed variant, as the question does', () => {
    const why = refusal(
      plan({
        from: BEFORE,
        to: tasks('to', { Defect: { ...BUG, value: 'defect' }, Epic: { ...EPIC, value: 'bug' } }),
        schema: live,
        statements: [convert('Epic')],
      }),
    ).map(({ why: text }) => text?.slice(0, text.indexOf(ONE_AT_A_TIME)));
    expect(why).toEqual([
      'The plan holds changes that no --rename or --convert statement carries: model "Bug", whose documents the plan deletes. To keep their data, run the command again with: --rename Bug:Defect. ',
    ]);
  });
});
