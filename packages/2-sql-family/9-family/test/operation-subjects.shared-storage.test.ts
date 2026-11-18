import { describe, expect, it } from 'vitest';
import { subjectsOfCalls } from '../src/core/migrations/operation-subjects';
import { NO_RENAMED_ORIGINS, planStatements } from '../src/core/migrations/statement-planning';
import type { StorageRenames } from '../src/core/migrations/storage-renames';
import { app, byHand, losing, renamesBetween, table } from './operation-subjects-fixtures';
import { ALL_CLASSES, contractOf, fakeTarget, renameModel } from './statement-fixtures';

const ignoringCase = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();

const two = contractOf({
  User: { table: 'users', fields: { id: 'id' } },
  Member: { table: 'members', fields: { id: 'id' } },
});

function adviceOnDroppingUsers(
  contract: ReturnType<typeof contractOf>,
  renames: StorageRenames | undefined,
) {
  return subjectsOfCalls([losing(table('users'))], {
    fromContract: two,
    contract,
    renames,
    origins: NO_RENAMED_ORIGINS,
    byHand,
    removedVariants: [],
  }).dataLoss.map(({ keepDataAdvice }) => keepDataAdvice);
}

const users = { namespaceId: 'app', table: 'users' };
const people = { namespaceId: 'app', table: 'people' };

describe('the advice for a dropped table and the planner agree whether its storage is shared', () => {
  it('when a statement renames the model that moves into the new table', () => {
    const merged = contractOf({
      User: { table: 'people', fields: { id: 'id' } },
      Person: { table: 'people', fields: { id: 'id' } },
    });
    const renames = renamesBetween(two, merged, [renameModel('Member', 'Person')]);

    expect(renames.sharedTable({ origin: users, destination: people })).toEqual({
      kind: 'merged',
      objects: [{ namespaceId: app, model: 'Member' }],
    });
    expect(adviceOnDroppingUsers(merged, renames)).toEqual([
      'The destination stores models "app.Person" and "app.User" in table "people", and the origin stores them in different tables, so their storage is being merged. Keeping their rows is a data migration, which a plan does not write. With migration plan, write this change as a hand-written migration instead: run prisma migration new, and in the operations of the migration.ts it writes, rewrite the rows of models "app.Person" and "app.User" into table "people" yourself, with the other operations of the change. Then run that migration.ts to emit its ops.json.',
    ]);
  });

  it('when the new table names differ only in case on a database that ignores case', () => {
    const merged = contractOf({
      User: { table: 'people', fields: { id: 'id' } },
      Member: { table: 'People', fields: { id: 'id' } },
    });
    const result = planStatements({
      policy: ALL_CLASSES,
      statements: [],
      fromContract: two,
      contract: merged,
      target: fakeTarget(['app.users', 'app.members'], {}, ['widening'], ignoringCase),
    });
    if (!result.ok) throw new Error(result.failure.summary);

    expect(result.value.tableRenames).toEqual([]);
    expect(adviceOnDroppingUsers(merged, result.value.renames)).toEqual([
      'The destination stores models "app.Member" and "app.User" in table "people", and the origin stores them in different tables, so their storage is being merged. Keeping their rows is a data migration, which a plan does not write. With migration plan, write this change as a hand-written migration instead: run prisma migration new, and in the operations of the migration.ts it writes, rewrite the rows of models "app.Member" and "app.User" into table "people" yourself, with the other operations of the change. Then run that migration.ts to emit its ops.json.',
    ]);
  });
});
