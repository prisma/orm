import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Contract } from '@internal/contract/types';
import { probeUnknownKeys, SQL_OPERATIONS_OPEN_PLACES } from '@internal/family-sql/control';
import type { SqlStorage } from '@internal/sql-contract/types';
import { dirname, join } from 'pathe';
import { describe, expect, it } from 'vitest';
import mysqlControlTarget from '../../src/core/migrations/control-target';
import { readMysqlOperations } from '../../src/core/migrations/read-operations';
import { contractOf, createMysqlPlanner, frameworkComponents, int, text } from './fixtures';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../../../../..');

function savedOpsFiles(targetIds: readonly string[]): readonly string[] {
  return execFileSync('git', ['ls-files', '*ops.json'], { cwd: repoRoot, encoding: 'utf-8' })
    .trim()
    .split('\n')
    .filter((file) => {
      const operations: unknown = JSON.parse(readFileSync(join(repoRoot, file), 'utf-8'));
      return (
        Array.isArray(operations) &&
        operations.some((operation) =>
          targetIds.includes(Reflect.get(Object(Reflect.get(operation, 'target')), 'id')),
        )
      );
    });
}

function reasonOf(read: () => unknown): string {
  try {
    read();
  } catch (error) {
    return String(Reflect.get(Object(error), 'why'));
  }
  return 'accepted';
}

const user = { columns: { id: int, email: text }, primaryKey: { columns: ['id'] } };
const post = {
  columns: { id: int, authorId: int },
  primaryKey: { columns: ['id'] },
  uniques: [{ columns: ['authorId'], name: 'Post_authorId_key' }],
  indexes: [{ columns: ['authorId'], name: 'Post_authorId_idx' }],
  foreignKeys: [
    {
      source: { namespaceId: '__unbound__', tableName: 'Post', columns: ['authorId'] },
      target: { namespaceId: '__unbound__', tableName: 'User', columns: ['id'] },
      name: 'Post_authorId_fkey',
      index: false,
    },
  ],
};

async function plannedJson(from: Contract<SqlStorage> | null, to: Contract<SqlStorage>) {
  const result = createMysqlPlanner().plan({
    contract: to,
    schema: mysqlControlTarget.migrations.contractToSchema(from, frameworkComponents),
    policy: { allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'] },
    fromContract: from,
    origin: from === null ? null : { storageHash: from.storage.storageHash },
    statements: [],
    frameworkComponents,
    spaceId: 'app',
    snapshotsImportPath: '../../snapshots',
  });
  if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts));
  return JSON.parse(JSON.stringify(await Promise.all(result.plan.operations)));
}

describe('readMysqlOperations', () => {
  it('refuses a key the target details do not define', () => {
    const op = {
      id: 'table.User',
      label: 'Create table "User"',
      operationClass: 'additive',
      target: { id: 'mysql', details: { objectType: 'table', name: 'User', unexpected: 1 } },
      precheck: [],
      execute: [{ description: 'create table "User"', sql: 'CREATE TABLE `User` (`id` int)' }],
      postcheck: [],
    };
    expect(reasonOf(() => readMysqlOperations([op]))).toBe(
      'Operation 0 ("table.User") is not in a format this release of Prisma reads: target.details.unexpected must be removed.',
    );
  });

  it('reads every MySQL and MariaDB ops.json saved in the repository', () => {
    const files = savedOpsFiles(['mysql', 'mariadb']);
    expect(files.length).toBeGreaterThan(0);
    const refused = files.flatMap((file) => {
      const reason = reasonOf(() =>
        readMysqlOperations(JSON.parse(readFileSync(join(repoRoot, file), 'utf-8'))),
      );
      return reason === 'accepted' ? [] : [`${file}: ${reason}`];
    });
    expect(refused).toEqual([]);
  });

  it('refuses a key the format does not define at every object of each MySQL and MariaDB ops.json saved in the repository, outside the places the format leaves open', () => {
    const files = savedOpsFiles(['mysql', 'mariadb']);
    expect(files.length).toBeGreaterThan(0);
    const accepted = files.flatMap((file) =>
      probeUnknownKeys(
        JSON.parse(readFileSync(join(repoRoot, file), 'utf-8')),
        (operations) => readMysqlOperations(Array.isArray(operations) ? operations : []),
        SQL_OPERATIONS_OPEN_PLACES,
      ).accepted.map((place) => `${file}: ${place}`),
    );
    expect(accepted).toEqual([]);
  });

  it('reads what the MySQL planner writes', async () => {
    const empty = contractOf('empty', {});
    const full = contractOf('full', { User: user, Post: post });
    const planned = [...(await plannedJson(empty, full)), ...(await plannedJson(full, empty))];
    expect(planned.length).toBeGreaterThan(4);
    expect(reasonOf(() => readMysqlOperations(planned))).toBe('accepted');
  });
});
