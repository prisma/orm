import { describe, expect, it } from 'vitest';
import { subjectsOfCalls } from '../src/core/migrations/operation-subjects';
import { NO_RENAMED_ORIGINS } from '../src/core/migrations/statement-planning';
import { app, byHand, losing, renamesBetween, table } from './operation-subjects-fixtures';
import { contractOf } from './statement-fixtures';

describe('subjectsOfCalls for a table whose model keeps its name', () => {
  const from = contractOf({ Profile: { table: 'profiles', fields: { id: 'id' } } });

  it('says how to rename the table by hand to keep its rows', () => {
    const to = contractOf({ Profile: { table: 'people', fields: { id: 'id' } } });

    expect(
      subjectsOfCalls([losing(table('profiles'))], {
        fromContract: from,
        contract: to,
        storageRenames: renamesBetween(from, to),
        origins: NO_RENAMED_ORIGINS,
        byHand,
        removedVariants: [],
      }).dataLoss,
    ).toEqual([
      {
        operationIndex: 0,
        subject: { kind: 'model', namespaceId: app, model: 'Profile' },
        loss: 'drop',
        label: 'Drop',
        keepDataAdvice:
          'To keep its rows, rename table "profiles" to "people" instead. The plan does not rename it: a plan renames the table of a model that keeps its name only on a target that plans table renames, when the control policy of the table is "managed" in both contracts, every model stored in it moves to the new table, and no model moves there from another table. With db update, rename the table in the database yourself with ALTER TABLE "profiles" RENAME TO "people", then run prisma db update. With migration plan, write the rename as a migration of its own instead. That migration leads to the contract as it is when you write it, so first undo every other change to the contract, keep only the new table name, and run prisma contract emit. Then run prisma migration new --name <name> --from <hash of the migration the database is at>, add this.renameTable("profiles", "people") to the operations of its migration.ts, run node on that migration.ts so it writes ops.json, and run prisma db migrate. Then make the rest of the change again and plan it with prisma migration plan.',
      },
    ]);
  });

  it('gives no advice when the destination has no model of that name', () => {
    const to = contractOf({ Person: { table: 'people', fields: { id: 'id' } } });

    expect(
      subjectsOfCalls([losing(table('profiles'))], {
        fromContract: from,
        contract: to,
        storageRenames: renamesBetween(from, to),
        origins: NO_RENAMED_ORIGINS,
        byHand,
        removedVariants: [],
      }).dataLoss,
    ).toEqual([
      {
        operationIndex: 0,
        subject: { kind: 'model', namespaceId: app, model: 'Profile' },
        loss: 'drop',
        label: 'Drop',
      },
    ]);
  });

  it('gives no advice when the new table already holds another model of the origin', () => {
    const withPeople = contractOf({
      Profile: { table: 'profiles', fields: { id: 'id' } },
      Person: { table: 'people', fields: { id: 'id' } },
    });
    const to = contractOf({ Profile: { table: 'people', fields: { id: 'id' } } });

    expect(
      subjectsOfCalls([losing(table('profiles'))], {
        fromContract: withPeople,
        contract: to,
        storageRenames: renamesBetween(withPeople, to),
        origins: NO_RENAMED_ORIGINS,
        byHand,
        removedVariants: [],
      }).dataLoss.map(({ keepDataAdvice }) => keepDataAdvice),
    ).toEqual([undefined]);
  });
  it('says that keeping the rows is a data migration when two tables merge into the new one', () => {
    const two = contractOf({
      User: { table: 'users', fields: { id: 'id' } },
      Member: { table: 'members', fields: { id: 'id' } },
    });
    const merged = contractOf({
      User: { table: 'people', fields: { id: 'id' } },
      Member: { table: 'people', fields: { id: 'id' } },
    });

    expect(
      subjectsOfCalls([losing(table('users')), losing(table('members'))], {
        fromContract: two,
        contract: merged,
        storageRenames: renamesBetween(two, merged),
        origins: NO_RENAMED_ORIGINS,
        byHand,
        removedVariants: [],
      }).dataLoss,
    ).toEqual(
      [
        { operationIndex: 0, model: 'User' },
        { operationIndex: 1, model: 'Member' },
      ].map(({ operationIndex, model }) => ({
        operationIndex,
        subject: { kind: 'model', namespaceId: app, model },
        loss: 'drop',
        label: 'Drop',
        keepDataAdvice:
          'The destination stores models "app.Member" and "app.User" in table "people", and the origin stores them in different tables, so their storage is being merged. Keeping their rows is a data migration, which a plan does not write. With migration plan, write this change as a hand-written migration instead: run prisma migration new, and in the operations of the migration.ts it writes, rewrite the rows of models "app.Member" and "app.User" into table "people" yourself, with the other operations of the change. Then run that migration.ts to emit its ops.json.',
      })),
    );
  });

  it('says that keeping the rows is a data migration when the old table splits', () => {
    const shared = contractOf({
      Task: { table: 'tasks', fields: { id: 'id' } },
      Bug: { table: 'tasks', fields: { id: 'id' }, base: 'Task' },
    });
    const split = contractOf({
      Task: { table: 'work', fields: { id: 'id' } },
      Bug: { table: 'bugs', fields: { id: 'id' }, base: 'Task' },
    });

    expect(
      subjectsOfCalls([losing(table('tasks'))], {
        fromContract: shared,
        contract: split,
        storageRenames: renamesBetween(shared, split),
        origins: NO_RENAMED_ORIGINS,
        byHand,
        removedVariants: [],
      }).dataLoss,
    ).toEqual([
      {
        operationIndex: 0,
        subject: { kind: 'model', namespaceId: app, model: 'Task' },
        loss: 'drop',
        label: 'Drop',
        keepDataAdvice:
          'The origin stores models "app.Bug" and "app.Task" in table "tasks", and the destination stores them in different tables, so their storage is being split. Keeping their rows is a data migration, which a plan does not write. With migration plan, write this change as a hand-written migration instead: run prisma migration new, and in the operations of the migration.ts it writes, rewrite the rows of model "app.Bug" into table "bugs" and the rows of model "app.Task" into table "work" yourself, with the other operations of the change. Then run that migration.ts to emit its ops.json.',
      },
    ]);
  });
});
