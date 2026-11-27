import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { createSqlOperationsReader } from '../src/core/migrations/operations-reader';

const readOperations = createSqlOperationsReader({
  targetDetails: type({ '+': 'reject', objectType: "'table' | 'column'", name: 'string' }),
  stepMeta: type({ 'targetOnly?': { '+': 'reject', schema: 'string' } }),
});

const rowsHoldingValue = {
  enumValue: { namespaceId: 'public', enum: 'Mood', member: 'sad' },
  value: 'sad',
  codecRef: { codecId: 'pg/text@1', typeParams: { anything: [1, { goes: true }] } },
  table: 'user',
  column: 'mood',
  storedValue: 'sad',
};

function operation(): Record<string, unknown> {
  return {
    id: 'column.user.mood',
    label: 'Remove a value from "mood"',
    operationClass: 'destructive',
    invariantId: 'mood-cleanup',
    summary: 'Removes "sad"',
    target: { id: 'postgres', details: { objectType: 'column', name: 'mood' } },
    precheck: [
      {
        description: 'ensure no row holds "sad"',
        sql: 'SELECT NOT EXISTS (SELECT 1 FROM "user" WHERE "mood" = $1) AS ok',
        params: ['sad', { any: { json: ['value'] } }],
        expectation: { expects: 'absent', object: 'value "sad"' },
        meta: {
          rowsHoldingValue,
          requiredColumn: { table: 'user', column: 'mood', reason: 'nullValues' },
          targetOnly: { schema: 'public' },
          note: { what: 'a planner note no reader acts on', nested: { free: 1 } },
        },
      },
    ],
    execute: [
      {
        description: 'convert "mood"',
        sql: 'ALTER TABLE "user" ALTER COLUMN "mood" TYPE text',
        meta: { convertedColumn: { table: 'user', column: 'mood', by: 'cast' } },
      },
    ],
    postcheck: [{ description: 'verify', sql: 'SELECT true AS ok' }],
    meta: { warning: 'TABLE_REWRITE', anything: { nested: true } },
  };
}

function withKey(path: readonly (string | number)[]): unknown {
  const op = structuredClone(operation());
  let at: unknown = op;
  for (const segment of path) at = Reflect.get(at as object, segment);
  Reflect.set(at as object, 'unexpected', true);
  return op;
}

function reasonOf(read: () => unknown): string {
  try {
    read();
  } catch (error) {
    return String(Reflect.get(error as object, 'why'));
  }
  return 'accepted';
}

describe('createSqlOperationsReader', () => {
  it('reads an operation that uses every field the format defines, leaving its open places as they are', () => {
    const op = operation();
    expect(readOperations([op])).toEqual([op]);
  });

  it.each([
    ['the operation', [], 'unexpected'],
    ['the target', ['target'], 'target.unexpected'],
    ['the target details', ['target', 'details'], 'target.details.unexpected'],
    ['a precheck step', ['precheck', 0], 'precheck[0].unexpected'],
    ['an execute step', ['execute', 0], 'execute[0].unexpected'],
    ['a postcheck step', ['postcheck', 0], 'postcheck[0].unexpected'],
    ['a check expectation', ['precheck', 0, 'expectation'], 'precheck[0].expectation.unexpected'],
    [
      'a required column mark',
      ['precheck', 0, 'meta', 'requiredColumn'],
      'precheck[0].meta.requiredColumn.unexpected',
    ],
    [
      'a converted column mark',
      ['execute', 0, 'meta', 'convertedColumn'],
      'execute[0].meta.convertedColumn.unexpected',
    ],
    [
      'a removed value mark',
      ['precheck', 0, 'meta', 'rowsHoldingValue'],
      'precheck[0].meta.rowsHoldingValue.unexpected',
    ],
    [
      "a removed value mark's enum value",
      ['precheck', 0, 'meta', 'rowsHoldingValue', 'enumValue'],
      'precheck[0].meta.rowsHoldingValue.enumValue.unexpected',
    ],
    [
      "a removed value mark's codec",
      ['precheck', 0, 'meta', 'rowsHoldingValue', 'codecRef'],
      'precheck[0].meta.rowsHoldingValue.codecRef.unexpected',
    ],
    [
      "a target's own step mark",
      ['precheck', 0, 'meta', 'targetOnly'],
      'precheck[0].meta.targetOnly.unexpected',
    ],
  ])('refuses a key %s does not define, naming its path', (_, path, keyPath) => {
    expect(reasonOf(() => readOperations([operation(), withKey(path)]))).toBe(
      `Operation 1 ("column.user.mood") is not in a format this release of Prisma reads: ${keyPath} must be removed.`,
    );
  });

  it('names the migration and space an operation belongs to', () => {
    expect(
      reasonOf(() =>
        readOperations([operation(), operation(), withKey(['target'])], {
          space: 'app',
          migrations: [
            { dirName: '20260101T0000_init', operationCount: 2 },
            { dirName: '20260201T0000_moods', operationCount: 1 },
          ],
        }),
      ),
    ).toBe(
      'Operation 0 ("column.user.mood") of migration "20260201T0000_moods" in space "app" is not in a format this release of Prisma reads: target.unexpected must be removed.',
    );
  });

  it('refuses the entry with the code the migration tooling uses for a malformed operation', () => {
    let thrown: unknown;
    try {
      readOperations([withKey([])]);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({
      code: 'MIGRATION.INVALID_OPERATION_ENTRY',
      message: 'Migration operation entry is malformed',
      meta: { index: 0, operationId: 'column.user.mood', reason: 'unexpected must be removed' },
    });
  });

  it('refuses a malformed value of a mark a reader acts on', () => {
    const op = operation();
    Reflect.set(
      Reflect.get((op['execute'] as object[])[0] as object, 'meta') as object,
      'convertedColumn',
      { table: 'user', column: 'mood', by: 'magic' },
    );
    expect(reasonOf(() => readOperations([op]))).toContain('execute[0].meta.convertedColumn.by');
  });

  it('reads an operation an in-memory planner built with keys it left undefined', () => {
    const op = { ...operation(), summary: undefined, invariantId: undefined };
    expect(readOperations([op])).toEqual([op]);
  });
});
