import { asNamespaceId, type Contract, type ContractModelBase } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import mysqlControlTarget from '../../src/core/migrations/control-target';
import { contractOf, createMysqlPlanner, frameworkComponents, int } from './fixtures';

interface ModelSpec {
  readonly table: string;
  readonly base?: string;
}

function contractWith(
  name: string,
  models: Readonly<Record<string, ModelSpec>>,
): Contract<SqlStorage> {
  const tables = Object.fromEntries(
    Object.values(models).map(({ table }) => [
      table,
      { columns: { id: int }, primaryKey: { columns: ['id'] } },
    ]),
  );
  const domainModels: Record<string, ContractModelBase> = Object.fromEntries(
    Object.entries(models).map(([model, { table, base }]) => [
      model,
      {
        fields: { id: { nullable: false, type: { kind: 'scalar', codecId: 'mysql/int@1' } } },
        relations: {},
        ...(base === undefined
          ? {}
          : { base: { namespace: asNamespaceId('__unbound__'), model: base } }),
        storage: { table, namespaceId: '__unbound__', fields: { id: { column: 'id' } } },
      },
    ]),
  );
  return { ...contractOf(name, tables), domain: applicationDomainOf({ models: domainModels }) };
}

function dataLossOf(from: Contract<SqlStorage>, to: Contract<SqlStorage>) {
  const result = createMysqlPlanner().plan({
    contract: to,
    schema: mysqlControlTarget.migrations.contractToSchema(from, frameworkComponents),
    policy: { allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'] },
    fromContract: from,
    origin: { storageHash: from.storage.storageHash },
    statements: [],
    frameworkComponents,
    spaceId: 'app',
    snapshotsImportPath: '../../snapshots',
  });
  if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts));
  return result.dataLoss;
}

describe('MysqlMigrationPlanner, advice on keeping the rows of a dropped table', () => {
  it('says how to rename the table by hand when only the table name of a model changes', () => {
    const from = contractWith('from', { Profile: { table: 'profiles' } });
    const to = contractWith('to', { Profile: { table: 'people' } });

    expect(dataLossOf(from, to)).toEqual([
      {
        operationIndex: 1,
        subject: { kind: 'model', namespaceId: '__unbound__', model: 'Profile' },
        loss: 'drop',
        label: 'Drop table profiles',
        keepDataAdvice:
          'To keep its rows, rename table "profiles" to "people" instead. The plan does not rename it: a plan renames the table of a model that keeps its name only on a target that plans table renames, when the control policy of the table is "managed" in both contracts, every model stored in it moves to the new table, and no model moves there from another table. With db update, rename the table in the database yourself with RENAME TABLE `profiles` TO `people`, then run prisma db update. With migration plan, write the rename as a migration of its own instead. That migration leads to the contract as it is when you write it, so first undo every other change to the contract, keep only the new table name, and run prisma contract emit. Then run prisma migration new --name <name> --from <hash of the migration the database is at>, add rawSql({\n  id: "renameTable.profiles",\n  label: "Rename table profiles to people",\n  operationClass: "widening",\n  target: { id: "mysql", details: { objectType: "table", name: "people" } },\n  precheck: [\n  {\n  description: "ensure table \\"profiles\\" exists",\n  sql: "SELECT (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?) > 0 AS result",\n  params: ["profiles"],\n  expectation: { expects: "present", object: "table \\"profiles\\"" },\n},\n  {\n  description: "ensure table \\"people\\" does not exist",\n  sql: "SELECT (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?) = 0 AS result",\n  params: ["people"],\n  expectation: { expects: "absent", object: "table \\"people\\"" },\n},\n],\n  execute: [\n  {\n  description: "rename table \\"profiles\\" to \\"people\\"",\n  sql: "RENAME TABLE `profiles` TO `people`",\n},\n],\n  postcheck: [\n  {\n  description: "verify table \\"people\\" exists",\n  sql: "SELECT (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?) > 0 AS result",\n  params: ["people"],\n  expectation: { expects: "present", object: "table \\"people\\"" },\n},\n  {\n  description: "verify table \\"profiles\\" no longer exists",\n  sql: "SELECT (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?) = 0 AS result",\n  params: ["profiles"],\n  expectation: { expects: "absent", object: "table \\"profiles\\"" },\n},\n],\n}) to the operations of its migration.ts, run node on that migration.ts so it writes ops.json, and run prisma db migrate. Then make the rest of the change again and plan it with prisma migration plan.',
      },
    ]);
  });

  it('says that keeping the rows is a data migration when a variant leaves its base table', () => {
    const from = contractWith('from', {
      Task: { table: 'tasks' },
      Bug: { table: 'tasks', base: 'Task' },
    });
    const to = contractWith('to', {
      Task: { table: 'work' },
      Bug: { table: 'bugs', base: 'Task' },
    });

    expect(dataLossOf(from, to)).toEqual([
      {
        operationIndex: 2,
        subject: { kind: 'model', namespaceId: '__unbound__', model: 'Task' },
        loss: 'drop',
        label: 'Drop table tasks',
        keepDataAdvice:
          'The origin stores models "Bug" and "Task" in table "tasks", and the destination stores them in different tables, so their storage is being split. Keeping their rows is a data migration, which a plan does not write. With migration plan, write this change as a hand-written migration instead: run prisma migration new, and in the operations of the migration.ts it writes, rewrite the rows of model "Bug" into table "bugs" and the rows of model "Task" into table "work" yourself, with the other operations of the change. Then run that migration.ts to emit its ops.json.',
      },
    ]);
  });
});
