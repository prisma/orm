import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { probeUnknownKeys, SQL_OPERATIONS_OPEN_PLACES } from '@internal/family-sql/control';
import { dirname, join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { RemoveStoredValueCall } from '../../src/core/migrations/op-factory-call';
import { readSqliteOperations } from '../../src/core/migrations/read-operations';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../../../..');

function savedOpsFiles(targetId: string): readonly string[] {
  return execFileSync('git', ['ls-files', '*ops.json'], { cwd: repoRoot, encoding: 'utf-8' })
    .trim()
    .split('\n')
    .filter((file) => {
      const operations: unknown = JSON.parse(readFileSync(join(repoRoot, file), 'utf-8'));
      return (
        Array.isArray(operations) &&
        operations.some(
          (operation) => Reflect.get(Object(Reflect.get(operation, 'target')), 'id') === targetId,
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

const rebuild = {
  id: 'table.User.rebuild',
  label: 'Rebuild table "User"',
  operationClass: 'widening',
  target: { id: 'sqlite', details: { objectType: 'table', name: 'User' } },
  precheck: [],
  execute: [
    {
      description: 'copy rows into the rebuilt "User"',
      sql: 'INSERT INTO "_new_User" SELECT CAST("age" AS INTEGER) FROM "User"',
      meta: { conversionCopy: { table: 'User', expressions: { age: 'CAST("age" AS INTEGER)' } } },
    },
  ],
  postcheck: [],
};

describe('readSqliteOperations', () => {
  it('reads an operation with the step marks SQLite defines', () => {
    expect(readSqliteOperations([rebuild])).toEqual([rebuild]);
  });

  it('reads the schema name that releases up to 8.0.0-rc.20 wrote into target details, as details without it', () => {
    const op = structuredClone(rebuild);
    Reflect.set(op.target.details, 'schema', 'main');
    expect(readSqliteOperations([op])).toEqual([rebuild]);
  });

  it('reads the removed-value mark that 8.0.0-rc.21 and rc.22 wrote, as the mark this release writes', () => {
    const description =
      'ensure column "state" of "task" takes NULL, or no row holds "archived" in it';
    const sql = 'SELECT true AS result';
    const enumValue = { enum: 'Status', member: 'ARCHIVED' };
    const removal = (meta: Record<string, unknown>) => ({
      id: 'removeStoredValue.task.state.archived',
      label: 'Remove value "archived" from column "state" of "task"',
      operationClass: 'destructive',
      target: { id: 'sqlite', details: { objectType: 'column', name: 'state', table: 'task' } },
      precheck: [{ description, sql, params: ['archived'], meta }],
      execute: [],
      postcheck: [],
    });
    expect(
      readSqliteOperations([removal({ rowsHoldingValue: { enumValue, value: 'archived' } })]),
    ).toEqual([
      removal({
        rowsHoldingValue: {
          enumValue,
          value: 'archived',
          table: 'task',
          column: 'state',
          storedValue: 'archived',
        },
      }),
    ]);
  });

  it('refuses a schema name other than main', () => {
    const op = structuredClone(rebuild);
    Reflect.set(op.target.details, 'schema', 'other');
    expect(reasonOf(() => readSqliteOperations([op]))).toMatch(
      /^Operation 0 \("table\.User\.rebuild"\) is not in a format this release of Prisma reads: target\.details\.schema /,
    );
  });

  it('refuses a key beside the schema name that target details do not define', () => {
    const op = structuredClone(rebuild);
    Reflect.set(op.target.details, 'schema', 'main');
    Reflect.set(op.target.details, 'unexpected', 1);
    expect(reasonOf(() => readSqliteOperations([op]))).toBe(
      'Operation 0 ("table.User.rebuild") is not in a format this release of Prisma reads: target.details.unexpected must be removed.',
    );
  });

  it.each([
    [
      'the target details',
      (op: typeof rebuild) => Reflect.set(op.target.details, 'unexpected', 1),
      'target.details.unexpected',
    ],
    [
      'a conversion copy mark',
      (op: typeof rebuild) => Reflect.set(op.execute[0]!.meta.conversionCopy, 'unexpected', 1),
      'execute[0].meta.conversionCopy.unexpected',
    ],
  ])('refuses a key %s does not define', (_, addKey, path) => {
    const op = structuredClone(rebuild);
    addKey(op);
    expect(reasonOf(() => readSqliteOperations([op]))).toBe(
      `Operation 0 ("table.User.rebuild") is not in a format this release of Prisma reads: ${path} must be removed.`,
    );
  });

  it('reads every SQLite ops.json saved in the repository', () => {
    const files = savedOpsFiles('sqlite');
    expect(files.length).toBeGreaterThan(0);
    const refused = files.flatMap((file) => {
      const reason = reasonOf(() =>
        readSqliteOperations(JSON.parse(readFileSync(join(repoRoot, file), 'utf-8'))),
      );
      return reason === 'accepted' ? [] : [`${file}: ${reason}`];
    });
    expect(refused).toEqual([]);
  });

  it('refuses a key the format does not define at every object of each SQLite ops.json saved in the repository, outside the places the format leaves open', () => {
    const files = savedOpsFiles('sqlite');
    expect(files.length).toBeGreaterThan(0);
    const accepted = files.flatMap((file) =>
      probeUnknownKeys(
        JSON.parse(readFileSync(join(repoRoot, file), 'utf-8')),
        (operations) => readSqliteOperations(Array.isArray(operations) ? operations : []),
        SQL_OPERATIONS_OPEN_PLACES,
      ).accepted.map((place) => `${file}: ${place}`),
    );
    expect(accepted).toEqual([]);
  });

  it('reads what the SQLite planner writes for a removed enum value, through JSON', async () => {
    const calls = [
      new RemoveStoredValueCall('task', 'state', 'archived', undefined, {
        enum: 'Status',
        member: 'ARCHIVED',
      }),
      new RemoveStoredValueCall(
        'task',
        'doc',
        'OPEN',
        undefined,
        { enum: 'Status', member: 'OPEN' },
        '$.status',
      ),
    ];
    const written = JSON.parse(JSON.stringify(await Promise.all(calls.map((c) => c.toOp()))));
    expect(written[0].precheck[0].meta.rowsHoldingValue).toBeDefined();
    expect(written[1].precheck[0].meta.rowsHoldingValue.path).toBe('$.status');
    expect(readSqliteOperations(written)).toEqual(written);
  });

  it('reads the recording of what the SQLite planner wrote up to 8.0.0-rc.20', () => {
    const golden = JSON.parse(
      readFileSync(
        join(repoRoot, 'test/integration/test/planner-golden/fixtures/sqlite/planned.golden.json'),
        'utf-8',
      ),
    );
    expect(golden.planned.operations.length).toBeGreaterThan(0);
    expect(reasonOf(() => readSqliteOperations(golden.planned.operations))).toBe('accepted');
  });
});
