import type { ResolvedMigrationStatement } from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import {
  contract,
  type EnumSpec,
  type ModelSpec,
  NS,
  plan,
  planned,
  refusal,
  renameField,
} from './mongo-statement-fixtures';
import {
  BEFORE,
  BUG,
  convert,
  deleteLabel,
  EPIC,
  live,
  rendered,
  replaceLabel,
  TWO_MIGRATIONS,
  tasks,
} from './mongo-variant-fixtures';

describe('MongoMigrationPlanner, a variant field renamed with its base discriminator', () => {
  const renameType = renameField('Task', 'type', 'Task', 'kind');
  const renameSeverity = renameField('Bug', 'severity', 'Bug', 'level');
  const after = tasks(
    'to',
    { Bug: { ...BUG, fields: ['level'] }, Epic: EPIC },
    {},
    {
      discriminator: 'kind',
    },
  );

  it('renames the variant field first, while its filter still finds the documents, in either order of the statements', () => {
    const labels = (statements: readonly ResolvedMigrationStatement[]) =>
      planned(plan({ from: BEFORE, to: after, schema: live, statements })).labels;
    const expected = [
      'Rename field severity to level in collection tasks in documents whose type is "bug"',
      'Rename field type to kind in collection tasks',
    ];
    expect({
      typeFirst: labels([renameType, renameSeverity]),
      severityFirst: labels([renameSeverity, renameType]),
    }).toEqual({ typeFirst: expected, severityFirst: expected });
  });
});

describe('MongoMigrationPlanner, variants that use the same field name', () => {
  it('plans a rename in one variant onto a name another variant renames away', () => {
    expect(
      planned(
        plan({
          from: tasks('from', { Bug: BUG, Epic: { value: 'epic', fields: ['level'] } }),
          to: tasks('to', {
            Bug: { value: 'bug', fields: ['level'] },
            Epic: { value: 'epic', fields: ['priority'] },
          }),
          schema: live,
          statements: [
            renameField('Bug', 'severity', 'Bug', 'level'),
            renameField('Epic', 'level', 'Epic', 'priority'),
          ],
        }),
      ).labels,
    ).toEqual([
      'Rename field severity to level in collection tasks in documents whose type is "bug"',
      'Rename field level to priority in collection tasks in documents whose type is "epic"',
    ]);
  });

  it('plans a field removed from one variant and added, required, to another', () => {
    expect(
      planned(
        plan({
          from: tasks('from', { Bug: { value: 'bug', fields: ['x'] }, Epic: EPIC }),
          to: tasks('to', {
            Bug: { value: 'bug', fields: [] },
            Epic: { value: 'epic', fields: ['scope', 'x'] },
          }),
          schema: live,
        }),
      ).labels,
    ).toEqual([
      'Fill field x in collection tasks where it is missing or null in documents whose type is "epic"',
      'Remove field x from collection tasks in documents whose type is "bug"',
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
    `Collection "tasks" stores several models and no discriminator tells their documents apart, so ${change} of "Note" too. To change only the documents of variant "Bug", move the models to separate collections, or carry out the change yourself, with a filter that selects only their documents, in a dataTransform operation of the migration.ts that migration plan writes or in mongosh.`;

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

  it('refuses an enum value rename that moves the discriminator in a collection that is not managed, as the enum value statement', () => {
    const external = (seed: string, bug: string, members: Readonly<Record<string, string>>) =>
      tasks(
        seed,
        { Bug: { ...BUG, value: bug }, Epic: EPIC },
        { control: 'external' },
        {
          discriminatorType: { codecId: 'mongo/string@1', valueSet: 'Kind' },
          enums: kind(members),
        },
      );
    const result = plan({
      from: external('from', 'bug', { BUG: 'bug', EPIC: 'epic' }),
      to: external('to', 'defect', { DEFECT: 'defect', EPIC: 'epic' }),
      schema: live,
      statements: [renameBug],
    });
    expect(result).toEqual({
      kind: 'failure',
      conflicts: [
        {
          kind: 'statementRefused',
          summary:
            'Cannot rename enum value "Kind.BUG" to "Kind.DEFECT": collection "tasks" has control policy "external"',
          why: 'Statements rename only collections, and fields of collections, whose control policy is "managed". Make the change in the database yourself and leave out this statement.',
          refusedStatement: renameBug,
        },
      ],
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

  it('refuses an enum value rename that takes the value of a removed variant, with no variant statement', () => {
    const renameEpic: ResolvedMigrationStatement = {
      kind: 'rename',
      entity: 'enumValue',
      from: { namespaceId: NS, enum: 'Kind', member: 'EPIC' },
      to: { namespaceId: NS, enum: 'Kind', member: 'ISSUE' },
    };
    const result = plan({
      from,
      to: tasks(
        'to',
        { Epic: { ...EPIC, value: 'bug' } },
        {},
        {
          discriminatorType: { codecId: 'mongo/string@1', valueSet: 'Kind' },
          enums: kind({ BUG: 'old', ISSUE: 'bug' }),
        },
      ),
      schema: live,
      statements: [renameEpic],
    });
    if (result.kind !== 'failure') throw new Error('Expected the plan to be refused');
    expect(
      result.conflicts.map(({ kind, summary, why, refusedStatement, leaveOut }) => ({
        kind,
        summary,
        why,
        refusedStatement,
        leaveOut,
      })),
    ).toEqual([
      {
        kind: 'statementRefused',
        summary: `Cannot rename enum value "Kind.EPIC" to "Kind.ISSUE": the migration writes a value that another of its operations reads (${deleteLabel('bug')}; ${replaceLabel('epic', 'bug')})`,
        why: TWO_MIGRATIONS,
        refusedStatement: renameEpic,
        leaveOut: undefined,
      },
    ]);
  });
});
