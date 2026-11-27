import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { readPostgresOperations } from '../../src/core/migrations/read-operations';

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

const schemaDrop = {
  id: 'schema.billing.drop',
  label: 'Drop schema "billing"',
  operationClass: 'destructive',
  target: {
    id: 'postgres',
    details: { schema: 'billing', objectType: 'dependency', name: 'billing' },
  },
  precheck: [
    {
      description: 'ensure schema "billing" is empty',
      sql: 'SELECT true AS ok',
      meta: { schemaContents: { schema: 'billing' } },
    },
  ],
  execute: [{ description: 'drop schema "billing"', sql: 'DROP SCHEMA "billing"' }],
  postcheck: [],
};

function reasonOf(read: () => unknown): string {
  try {
    read();
  } catch (error) {
    return String(Reflect.get(Object(error), 'why'));
  }
  return 'accepted';
}

describe('readPostgresOperations', () => {
  it('reads an operation with the details and step marks Postgres defines', () => {
    expect(readPostgresOperations([schemaDrop])).toEqual([schemaDrop]);
  });

  it.each([
    [
      'the target details',
      (op: typeof schemaDrop) => Reflect.set(op.target.details, 'unexpected', 1),
      'target.details.unexpected',
    ],
    [
      'a schema contents mark',
      (op: typeof schemaDrop) => Reflect.set(op.precheck[0]!.meta.schemaContents, 'unexpected', 1),
      'precheck[0].meta.schemaContents.unexpected',
    ],
  ])('refuses a key %s does not define', (_, addKey, path) => {
    const op = structuredClone(schemaDrop);
    addKey(op);
    expect(reasonOf(() => readPostgresOperations([op]))).toBe(
      `Operation 0 ("schema.billing.drop") is not in a format this release of Prisma reads: ${path} must be removed.`,
    );
  });

  it('reads every Postgres ops.json saved in the repository', () => {
    const files = savedOpsFiles('postgres');
    expect(files.length).toBeGreaterThan(50);
    const refused = files.flatMap((file) => {
      const reason = reasonOf(() =>
        readPostgresOperations(JSON.parse(readFileSync(join(repoRoot, file), 'utf-8'))),
      );
      return reason === 'accepted' ? [] : [`${file}: ${reason}`];
    });
    expect(refused).toEqual([]);
  });

  it('reads what the Postgres planner writes', () => {
    const golden = JSON.parse(
      readFileSync(
        join(
          repoRoot,
          'test/integration/test/planner-golden/fixtures/postgres/planned.golden.json',
        ),
        'utf-8',
      ),
    );
    expect(golden.planned.operations.length).toBeGreaterThan(0);
    expect(reasonOf(() => readPostgresOperations(golden.planned.operations))).toBe('accepted');
  });
});
