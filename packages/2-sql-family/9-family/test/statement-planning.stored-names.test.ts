import { describe, expect, it } from 'vitest';
import { planStatements } from '../src/core/migrations/statement-planning';
import {
  ALL_CLASSES,
  contractOf,
  fakeTarget,
  planned,
  rejection,
  renameField,
  renameModel,
} from './statement-fixtures';

const ignoringCase = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();

const users = { table: 'users', fields: { id: 'id', email: 'email' } };

function plan(
  origin: ReturnType<typeof contractOf>,
  destination: ReturnType<typeof contractOf>,
  target: ReturnType<typeof fakeTarget>,
  statements: Parameters<typeof planStatements>[0]['statements'] = [],
) {
  return planStatements({
    policy: ALL_CLASSES,
    statements,
    fromContract: origin,
    contract: destination,
    target,
  });
}

describe('planStatements, a model whose table changes and whose name both contracts keep', () => {
  it('renames the table, reports no statement, and records where the table came from', () => {
    const result = plan(
      contractOf({ User: users }),
      contractOf({ User: { ...users, table: 'app_users' } }),
      fakeTarget(['app.users'], { 'app.users': ['id', 'email'] }),
    );
    expect(planned(result)).toEqual({
      calls: ['table app.users -> app_users'],
      tableRenames: [{ namespaceId: 'app', from: 'users', to: 'app_users' }],
      columnRenames: [],
      madeTables: [],
      plannedStatements: [],
    });
    expect(
      result.ok && result.value.origins.originTable({ namespaceId: 'app', table: 'app_users' }),
    ).toEqual({ namespaceId: 'app', table: 'users' });
  });

  it('renames the column of a field whose name both contracts keep', () => {
    const result = plan(
      contractOf({ User: users }),
      contractOf({ User: { ...users, fields: { id: 'id', email: 'email_address' } } }),
      fakeTarget(['app.users'], { 'app.users': ['id', 'email'] }),
    );
    expect(planned(result)).toEqual({
      calls: ['column app.users.email -> email_address'],
      tableRenames: [],
      columnRenames: [{ namespaceId: 'app', table: 'users', from: 'email', to: 'email_address' }],
      madeTables: [],
      plannedStatements: [],
    });
  });

  it('renames the table first, then the column on the renamed table', () => {
    const result = plan(
      contractOf({ User: users }),
      contractOf({ User: { table: 'app_users', fields: { id: 'id', email: 'email_address' } } }),
      fakeTarget(['app.users'], { 'app.users': ['id', 'email'] }),
    );
    expect(planned(result)).toEqual({
      calls: ['table app.users -> app_users', 'column app.app_users.email -> email_address'],
      tableRenames: [{ namespaceId: 'app', from: 'users', to: 'app_users' }],
      columnRenames: [
        { namespaceId: 'app', table: 'app_users', from: 'email', to: 'email_address' },
      ],
      madeTables: [],
      plannedStatements: [],
    });
    expect(
      result.ok &&
        result.value.origins.originColumn({ namespaceId: 'app', table: 'users' }, 'email_address'),
    ).toBe('email');
  });

  it('renames the table before a field statement, which renames the column on the renamed table', () => {
    const statement = renameField('User', 'name', 'fullName');
    expect(
      planned(
        plan(
          contractOf({ User: { table: 'users', fields: { id: 'id', name: 'name' } } }),
          contractOf({ User: { table: 'app_users', fields: { id: 'id', fullName: 'full_name' } } }),
          fakeTarget(['app.users'], { 'app.users': ['id', 'name'] }),
          [statement],
        ),
      ),
    ).toEqual({
      calls: ['table app.users -> app_users', 'column app.app_users.name -> full_name'],
      tableRenames: [{ namespaceId: 'app', from: 'users', to: 'app_users' }],
      columnRenames: [{ namespaceId: 'app', table: 'app_users', from: 'name', to: 'full_name' }],
      madeTables: [],
      plannedStatements: [{ statement, operations: { kind: 'planned', operationIndexes: [2, 3] } }],
    });
  });

  it('renames the column of a field that keeps its name on a model a statement renames', () => {
    const statement = renameModel('Profile', 'User');
    expect(
      planned(
        plan(
          contractOf({ Profile: { table: 'profile', fields: { email: 'email' } } }),
          contractOf({ User: { table: 'users', fields: { email: 'email_address' } } }),
          fakeTarget(['app.profile'], { 'app.profile': ['email'] }),
          [statement],
        ),
      ),
    ).toEqual({
      calls: ['table app.profile -> users', 'column app.users.email -> email_address'],
      tableRenames: [{ namespaceId: 'app', from: 'profile', to: 'users' }],
      columnRenames: [{ namespaceId: 'app', table: 'users', from: 'email', to: 'email_address' }],
      madeTables: [],
      plannedStatements: [{ statement, operations: { kind: 'planned', operationIndexes: [0, 1] } }],
    });
  });

  it('renames a table that a model and its single-table variants share once', () => {
    const tasks = (table: string) =>
      contractOf({
        Task: { table, fields: { id: 'id', type: 'type' } },
        Bug: { table, base: 'Task', fields: { severity: 'severity' } },
      });
    expect(
      planned(
        plan(
          tasks('tasks'),
          tasks('work_items'),
          fakeTarget(['app.tasks'], { 'app.tasks': ['id', 'type', 'severity'] }),
        ),
      ),
    ).toEqual({
      calls: ['table app.tasks -> work_items'],
      tableRenames: [{ namespaceId: 'app', from: 'tasks', to: 'work_items' }],
      columnRenames: [],
      madeTables: [],
      plannedStatements: [],
    });
  });

  it('plans a new model in the table a rename frees', () => {
    expect(
      planned(
        plan(
          contractOf({ User: users }),
          contractOf({
            User: { ...users, table: 'app_users' },
            Account: { table: 'users', fields: { id: 'id' } },
          }),
          fakeTarget(['app.users'], { 'app.users': ['id', 'email'] }),
        ),
      ),
    ).toEqual({
      calls: ['table app.users -> app_users'],
      tableRenames: [{ namespaceId: 'app', from: 'users', to: 'app_users' }],
      columnRenames: [],
      madeTables: [],
      plannedStatements: [],
    });
  });

  it('plans a new field in the column a rename frees', () => {
    expect(
      planned(
        plan(
          contractOf({ User: users }),
          contractOf({
            User: { ...users, fields: { id: 'id', email: 'email_address', legacy: 'email' } },
          }),
          fakeTarget(['app.users'], { 'app.users': ['id', 'email'] }),
        ),
      ),
    ).toEqual({
      calls: ['column app.users.email -> email_address'],
      tableRenames: [],
      columnRenames: [{ namespaceId: 'app', table: 'users', from: 'email', to: 'email_address' }],
      madeTables: [],
      plannedStatements: [],
    });
  });

  it('renames a table and a column whose names change only in case where the target ignores case', () => {
    expect(
      planned(
        plan(
          contractOf({ User: { table: 'user', fields: { email: 'email' } } }),
          contractOf({ User: { table: 'User', fields: { email: 'Email' } } }),
          fakeTarget(['app.user'], { 'app.user': ['email'] }, ['widening'], ignoringCase),
        ),
      ),
    ).toEqual({
      calls: ['table app.user -> User', 'column app.User.email -> Email'],
      tableRenames: [{ namespaceId: 'app', from: 'user', to: 'User' }],
      columnRenames: [{ namespaceId: 'app', table: 'User', from: 'email', to: 'Email' }],
      madeTables: [],
      plannedStatements: [],
    });
  });
});

describe('planStatements, storage that does not move whole', () => {
  const tasks = { table: 'tasks', fields: { id: 'id', type: 'type' } };

  it('renames nothing when a single-table variant moves to its own table', () => {
    expect(
      planned(
        plan(
          contractOf({
            Task: tasks,
            Bug: { table: 'tasks', base: 'Task', fields: { severity: 'severity' } },
          }),
          contractOf({
            Task: tasks,
            Bug: { table: 'bugs', base: 'Task', fields: { severity: 'severity' } },
          }),
          fakeTarget(['app.tasks'], { 'app.tasks': ['id', 'type', 'severity'] }),
        ),
      ),
    ).toEqual({
      calls: [],
      tableRenames: [],
      columnRenames: [],
      madeTables: [],
      plannedStatements: [],
    });
  });

  it("renames nothing when a variant's own table folds back into its base's table", () => {
    expect(
      planned(
        plan(
          contractOf({
            Task: tasks,
            Bug: { table: 'bugs', base: 'Task', fields: { severity: 'severity' } },
          }),
          contractOf({
            Task: tasks,
            Bug: { table: 'tasks', base: 'Task', fields: { severity: 'severity' } },
          }),
          fakeTarget(['app.tasks', 'app.bugs'], {
            'app.tasks': ['id', 'type'],
            'app.bugs': ['severity'],
          }),
        ),
      ),
    ).toEqual({
      calls: [],
      tableRenames: [],
      columnRenames: [],
      madeTables: [],
      plannedStatements: [],
    });
  });

  it('renames nothing when one of two variant fields that share a column changes its column', () => {
    expect(
      planned(
        plan(
          contractOf({
            Task: { table: 'tasks', fields: { id: 'id', title: 'title' } },
            Bug: { table: 'tasks', base: 'Task', fields: { title: 'title' } },
          }),
          contractOf({
            Task: { table: 'tasks', fields: { id: 'id', title: 'title' } },
            Bug: { table: 'tasks', base: 'Task', fields: { title: 'heading' } },
          }),
          fakeTarget(['app.tasks'], { 'app.tasks': ['id', 'title'] }),
        ),
      ),
    ).toEqual({
      calls: [],
      tableRenames: [],
      columnRenames: [],
      madeTables: [],
      plannedStatements: [],
    });
  });

  it.each([
    ['origin', 'external'],
    ['origin', 'observed'],
    ['origin', 'tolerated'],
    ['destination', 'external'],
    ['destination', 'observed'],
    ['destination', 'tolerated'],
  ] as const)(
    'renames nothing when the table is not managed in the %s contract',
    (side, control) => {
      const origin = contractOf({ User: side === 'origin' ? { ...users, control } : users });
      const destination = contractOf({
        User: {
          table: 'app_users',
          fields: { id: 'id', email: 'email_address' },
          ...(side === 'destination' ? { control } : {}),
        },
      });
      expect(
        planned(
          plan(origin, destination, fakeTarget(['app.users'], { 'app.users': ['id', 'email'] })),
        ),
      ).toEqual({
        calls: [],
        tableRenames: [],
        columnRenames: [],
        madeTables: [],
        plannedStatements: [],
      });
    },
  );

  it('renames nothing without an origin contract', () => {
    expect(
      planned(
        planStatements({
          policy: ALL_CLASSES,
          statements: [],
          fromContract: null,
          contract: contractOf({ User: { ...users, table: 'app_users' } }),
          target: fakeTarget(['app.users'], { 'app.users': ['id', 'email'] }),
        }),
      ),
    ).toEqual({
      calls: [],
      tableRenames: [],
      columnRenames: [],
      madeTables: [],
      plannedStatements: [],
    });
  });

  it('refuses a rename the policy does not allow, naming the contract change and no statement', () => {
    const conflict = rejection(
      planStatements({
        policy: { allowedOperationClasses: ['additive'] },
        statements: [],
        fromContract: contractOf({ User: users }),
        contract: contractOf({ User: { ...users, table: 'app_users' } }),
        target: fakeTarget(['app.users'], { 'app.users': ['id', 'email'] }),
      }),
    );
    expect(conflict).toEqual({
      kind: 'unsupportedOperation',
      summary:
        'Cannot rename table "users" to "app_users": the plan does not allow "widening" operations',
      why: 'The table of model "app.User" changes from "users" to "app_users", and the rename produces a "widening" operation, which this command does not plan: it plans only "additive" operations. Make the change with a command that allows "widening" operations, such as db update or migration plan.',
      refusedOperationClass: 'widening',
      location: { namespaceId: 'app', entityKind: 'table', entityName: 'app_users' },
    });
  });
});

describe('planStatements, statements on storage that does not move whole', () => {
  const tasks = { table: 'tasks', fields: { id: 'id', type: 'type' } };

  it("refuses a model rename that would move the rows of the other models in the variant's table", () => {
    const statement = renameModel('Bug', 'Defect');
    const conflict = rejection(
      plan(
        contractOf({
          Task: tasks,
          Bug: { table: 'tasks', base: 'Task', fields: { severity: 'severity' } },
        }),
        contractOf({
          Task: tasks,
          Defect: { table: 'defects', base: 'Task', fields: { severity: 'severity' } },
        }),
        fakeTarget(['app.tasks'], { 'app.tasks': ['id', 'type', 'severity'] }),
        [statement],
      ),
    );
    expect(conflict).toEqual({
      kind: 'statementRefused',
      summary:
        'Cannot rename table "tasks" to "defects": table "tasks" also stores model "app.Task"',
      why: 'A table rename moves every row of the table, and the rows of model "app.Task" do not move to table "defects". Moving the rows of one model out of a table it shares with others is a data migration, which a plan does not write. Leave out this statement to plan the change without moving them: the plan then asks about the data it drops. To keep the data with migration plan, write this change as a hand-written migration instead: run prisma migration new, and in the operations of the migration.ts it writes, rewrite the rows of model "app.Bug" into table "defects" yourself, with the other operations of the change. Then run that migration.ts to emit its ops.json.',
      refusedStatement: statement,
      location: { namespaceId: 'app', entityKind: 'table', entityName: 'tasks' },
    });
  });

  it('refuses a field rename that would move the values of another field stored in the column', () => {
    const statement = renameField('Bug', 'title', 'heading');
    const conflict = rejection(
      plan(
        contractOf({
          Task: { table: 'tasks', fields: { id: 'id', title: 'title' } },
          Bug: { table: 'tasks', base: 'Task', fields: { title: 'title' } },
        }),
        contractOf({
          Task: { table: 'tasks', fields: { id: 'id', title: 'title' } },
          Bug: { table: 'tasks', base: 'Task', fields: { heading: 'heading' } },
        }),
        fakeTarget(['app.tasks'], { 'app.tasks': ['id', 'title'] }),
        [statement],
      ),
    );
    expect(conflict).toEqual({
      kind: 'statementRefused',
      summary:
        'Cannot rename column "tasks"."title" to "heading": column "title" also stores field "app.Task.title"',
      why: 'A column rename moves the values of every row, and the values of field "app.Task.title" do not move to column "heading". Moving the values of one field out of a column it shares with others is a data migration, which a plan does not write. Leave out this statement to plan the change without moving them: the plan then asks about the data it drops. To keep the data with migration plan, write this change as a hand-written migration instead: run prisma migration new, and in the operations of the migration.ts it writes, rewrite the values of field "app.Bug.title" into column "heading" yourself, with the other operations of the change. Then run that migration.ts to emit its ops.json.',
      refusedStatement: statement,
      location: { namespaceId: 'app', entityKind: 'table', entityName: 'tasks', column: 'title' },
    });
  });

  it('refuses a field rename on a model whose table changes and is not renamed', () => {
    const statement = renameField('Bug', 'sev', 'severity');
    const conflict = rejection(
      plan(
        contractOf({
          Task: tasks,
          Bug: { table: 'tasks', base: 'Task', fields: { sev: 'sev' } },
        }),
        contractOf({
          Task: tasks,
          Bug: { table: 'bugs', base: 'Task', fields: { severity: 'severity' } },
        }),
        fakeTarget(['app.tasks'], { 'app.tasks': ['id', 'type', 'sev'] }),
        [statement],
      ),
    );
    expect(conflict).toEqual({
      kind: 'statementRefused',
      summary:
        'Cannot rename column "tasks"."sev": the model\'s table changes from "tasks" to "bugs", and the plan does not rename it',
      why: 'The plan renames a table only when every model stored in it moves to the same new table and its control policy is "managed" in both contracts, so the column would be renamed on a table the destination does not store the model in. Leave out this statement.',
      refusedStatement: statement,
      location: { namespaceId: 'app', entityKind: 'table', entityName: 'tasks', column: 'sev' },
    });
  });
});
