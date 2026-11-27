import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'pathe';
import { describe, expect, it } from 'vitest';
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

  it('reads the schema name that releases up to 8.0.0-rc.19 wrote into target details', () => {
    const op = structuredClone(rebuild);
    Reflect.set(op.target.details, 'schema', 'main');
    expect(readSqliteOperations([op])).toEqual([op]);
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
    const refused = savedOpsFiles('sqlite').flatMap((file) => {
      const reason = reasonOf(() =>
        readSqliteOperations(JSON.parse(readFileSync(join(repoRoot, file), 'utf-8'))),
      );
      return reason === 'accepted' ? [] : [`${file}: ${reason}`];
    });
    expect(refused).toEqual([]);
  });

  it('reads what the SQLite planner writes', () => {
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
