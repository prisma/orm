import { describe, expect, it } from 'vitest';
import { planStatements } from '../src/core/migrations/statement-planning';
import {
  ALL_CLASSES,
  contractOf,
  fakeTarget,
  type ModelSpec,
  planned,
  rejection,
  renameField,
  renameModel,
  renameNamespace,
} from './statement-fixtures';

const ignoringCase = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();

const NOTHING = {
  calls: [],
  tableRenames: [],
  columnRenames: [],
  madeTables: [],
  plannedStatements: [],
};

function plan(
  origin: Record<string, ModelSpec>,
  destination: Record<string, ModelSpec>,
  target: ReturnType<typeof fakeTarget>,
  statements: Parameters<typeof planStatements>[0]['statements'] = [],
) {
  return planStatements({
    policy: ALL_CLASSES,
    statements,
    fromContract: contractOf(origin),
    contract: contractOf(destination),
    target,
  });
}

const tasks = (table: string): ModelSpec => ({ table, fields: { id: 'id', type: 'type' } });
const variant = (table: string, fields: Record<string, string>): ModelSpec => ({
  table,
  base: 'Task',
  fields,
});
const tasksTable = () =>
  fakeTarget(['app.tasks'], { 'app.tasks': ['id', 'type', 'severity', 'points'] });

describe('planStatements, storage whose removed objects stay behind', () => {
  it('renames the table of a base whose single-table variant the destination removes', () => {
    expect(
      planned(
        plan(
          {
            Task: tasks('tasks'),
            Bug: variant('tasks', { severity: 'severity' }),
            Story: variant('tasks', { points: 'points' }),
          },
          { Task: tasks('work'), Story: variant('work', { points: 'points' }) },
          tasksTable(),
        ),
      ),
    ).toEqual({
      calls: ['table app.tasks -> work'],
      tableRenames: [{ namespaceId: 'app', from: 'tasks', to: 'work' }],
      columnRenames: [],
      madeTables: [],
      plannedStatements: [],
    });
  });

  it('plans a model rename statement on a base whose single-table variant the destination removes', () => {
    const statement = renameModel('Task', 'Job');
    expect(
      planned(
        plan(
          {
            Task: tasks('tasks'),
            Bug: variant('tasks', { severity: 'severity' }),
            Story: variant('tasks', { points: 'points' }),
          },
          {
            Job: tasks('jobs'),
            Story: { table: 'jobs', base: 'Job', fields: { points: 'points' } },
          },
          tasksTable(),
          [statement],
        ),
      ),
    ).toEqual({
      calls: ['table app.tasks -> jobs'],
      tableRenames: [{ namespaceId: 'app', from: 'tasks', to: 'jobs' }],
      columnRenames: [],
      madeTables: [],
      plannedStatements: [{ statement, operations: { kind: 'planned', operationIndexes: [0, 1] } }],
    });
  });

  it('renames a column that a removed field shared with a field that keeps its name', () => {
    expect(
      planned(
        plan(
          {
            Task: tasks('tasks'),
            Bug: variant('tasks', { title: 'title' }),
            Story: variant('tasks', { title: 'title' }),
          },
          {
            Task: tasks('tasks'),
            Bug: variant('tasks', { title: 'heading' }),
            Story: variant('tasks', {}),
          },
          fakeTarget(['app.tasks'], { 'app.tasks': ['id', 'type', 'title'] }),
        ),
      ),
    ).toEqual({
      calls: ['column app.tasks.title -> heading'],
      tableRenames: [],
      columnRenames: [{ namespaceId: 'app', table: 'tasks', from: 'title', to: 'heading' }],
      madeTables: [],
      plannedStatements: [],
    });
  });
});

describe('planStatements, storage that other storage joins', () => {
  it("renames nothing when a variant's own table joins its base's table as the base's table is renamed", () => {
    expect(
      planned(
        plan(
          { Task: tasks('tasks'), Feature: variant('features', { priority: 'priority' }) },
          { Task: tasks('work'), Feature: variant('work', { priority: 'priority' }) },
          fakeTarget(['app.tasks', 'app.features'], {
            'app.tasks': ['id', 'type'],
            'app.features': ['priority'],
          }),
        ),
      ),
    ).toEqual(NOTHING);
  });

  it('renames nothing when two tables move to one name', () => {
    expect(
      planned(
        plan(
          { User: { table: 'users', fields: { id: 'id' } }, Member: { table: 'members' } },
          { User: { table: 'people', fields: { id: 'id' } }, Member: { table: 'people' } },
          fakeTarget(['app.users', 'app.members']),
        ),
      ),
    ).toEqual(NOTHING);
  });

  it('renames nothing when two tables move to names the target takes for one', () => {
    expect(
      planned(
        plan(
          { User: { table: 'users' }, Member: { table: 'members' } },
          { User: { table: 'people' }, Member: { table: 'People' } },
          fakeTarget(['app.users', 'app.members'], {}, ['widening'], ignoringCase),
        ),
      ),
    ).toEqual(NOTHING);
  });

  it('renames nothing when two columns move to one name', () => {
    expect(
      planned(
        plan(
          { Task: { table: 'tasks', fields: { a: 'x' } }, Bug: variant('tasks', { b: 'y' }) },
          { Task: { table: 'tasks', fields: { a: 'z' } }, Bug: variant('tasks', { b: 'z' }) },
          fakeTarget(['app.tasks'], { 'app.tasks': ['x', 'y'] }),
        ),
      ),
    ).toEqual(NOTHING);
  });

  it('renames nothing when two columns move to names the target takes for one', () => {
    expect(
      planned(
        plan(
          { Task: { table: 'tasks', fields: { a: 'x' } }, Bug: variant('tasks', { b: 'y' }) },
          { Task: { table: 'tasks', fields: { a: 'z' } }, Bug: variant('tasks', { b: 'Z' }) },
          fakeTarget(['app.tasks'], { 'app.tasks': ['x', 'y'] }, ['widening'], ignoringCase),
        ),
      ),
    ).toEqual(NOTHING);
  });

  it.each([
    ['one name', 'people'],
    ['a name the target takes for it', 'People'],
  ])('refuses a model rename statement whose table joins another table moving to %s', (_, to) => {
    const statement = renameModel('Member', 'Person');
    expect(
      rejection(
        plan(
          { User: { table: 'users' }, Member: { table: 'members' } },
          { User: { table: 'people' }, Person: { table: to } },
          fakeTarget(['app.users', 'app.members'], {}, ['widening'], ignoringCase),
          [statement],
        ),
      ),
    ).toEqual({
      kind: 'statementRefused',
      summary: `Cannot rename table "members" to "${to}": table "${to}" also stores model "app.User", whose rows are not in table "members"`,
      why: `A table rename moves the rows of one table, and table "${to}" would also store the rows of model "app.User". Moving the rows of two tables into one is a data migration, which a plan does not write. Leave out this statement to plan the change without moving them: the plan then asks about the data it drops. A question about model "app.Member" offers this same rename again, which is refused again for the same reason. Answer it with --delete, which it also offers: that plans the change and deletes the data. To keep the data with migration plan, write this change as a hand-written migration instead: run prisma migration new, and in the operations of the migration.ts it writes, rewrite the rows of model "app.Member", and those of model "app.User" that table "${to}" does not already hold, into table "${to}" yourself, with the other operations of the change. Then run that migration.ts to emit its ops.json.`,
      refusedStatement: statement,
      location: { namespaceId: 'app', entityKind: 'table', entityName: 'members' },
    });
  });
  it('refuses a field rename statement whose column joins another column moving to its new name', () => {
    const statement = renameField('Bug', 'b', 'c');
    expect(
      rejection(
        plan(
          { Task: { table: 'tasks', fields: { a: 'x' } }, Bug: variant('tasks', { b: 'y' }) },
          { Task: { table: 'tasks', fields: { a: 'z' } }, Bug: variant('tasks', { c: 'z' }) },
          fakeTarget(['app.tasks'], { 'app.tasks': ['x', 'y'] }),
          [statement],
        ),
      ),
    ).toEqual({
      kind: 'statementRefused',
      summary:
        'Cannot rename column "tasks"."y" to "z": column "z" also stores field "app.Task.a", whose values are not in column "y"',
      why: 'A column rename moves the values of one column, and column "z" would also store the values of field "app.Task.a". Moving the values of two columns into one is a data migration, which a plan does not write. Leave out this statement to plan the change without moving them: the plan then asks about the data it drops. A question about field "app.Bug.b" offers this same rename again, which is refused again for the same reason. Answer it with --delete, which it also offers: that plans the change and deletes the data. To keep the data with migration plan, write this change as a hand-written migration instead: run prisma migration new, and in the operations of the migration.ts it writes, rewrite the values of field "app.Bug.b", and those of field "app.Task.a" that column "z" does not already hold, into column "z" yourself, with the other operations of the change. Then run that migration.ts to emit its ops.json.',
      refusedStatement: statement,
      location: { namespaceId: 'app', entityKind: 'table', entityName: 'tasks', column: 'y' },
    });
  });
});

describe('planStatements, a namespace rename statement', () => {
  it('renames the table and column of a model that keeps its name in the renamed namespace', () => {
    const statement = renameNamespace('billing', 'finance');
    expect(
      planned(
        plan(
          { Invoice: { table: 'invoices', namespace: 'billing', fields: { total: 'total' } } },
          { Invoice: { table: 'bills', namespace: 'finance', fields: { total: 'amount' } } },
          fakeTarget(['billing.invoices'], { 'billing.invoices': ['total'] }),
          [statement],
        ),
      ),
    ).toEqual({
      calls: [
        'rename-namespace billing -> finance',
        'table finance.invoices -> bills',
        'column finance.bills.total -> amount',
      ],
      tableRenames: [{ namespaceId: 'finance', from: 'invoices', to: 'bills' }],
      columnRenames: [{ namespaceId: 'finance', table: 'bills', from: 'total', to: 'amount' }],
      madeTables: [],
      plannedStatements: [{ statement, operations: { kind: 'planned', operationIndexes: [0] } }],
    });
  });

  it('renames the column of a model whose table keeps its name in the renamed namespace', () => {
    const statement = renameNamespace('billing', 'finance');
    expect(
      planned(
        plan(
          { Invoice: { table: 'invoices', namespace: 'billing', fields: { total: 'total' } } },
          { Invoice: { table: 'invoices', namespace: 'finance', fields: { total: 'amount' } } },
          fakeTarget(['billing.invoices'], { 'billing.invoices': ['total'] }),
          [statement],
        ),
      ),
    ).toEqual({
      calls: ['rename-namespace billing -> finance', 'column finance.invoices.total -> amount'],
      tableRenames: [],
      columnRenames: [{ namespaceId: 'finance', table: 'invoices', from: 'total', to: 'amount' }],
      madeTables: [],
      plannedStatements: [{ statement, operations: { kind: 'planned', operationIndexes: [0] } }],
    });
  });
});
