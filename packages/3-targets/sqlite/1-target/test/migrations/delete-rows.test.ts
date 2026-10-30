import { describe, expect, it } from 'vitest';
import { createSqliteBuiltinCodecLookup } from '../../src/core/codec-registry';
import { DeleteRowsCall } from '../../src/core/migrations/op-factory-call';

describe('deleteRows', () => {
  it('deletes the rows that hold the value, and checks afterwards that none does', async () => {
    expect(await new DeleteRowsCall('issue', 'kind', 'Bug').toOp()).toEqual({
      id: 'deleteRows.issue.kind.Bug',
      label: 'Delete the rows of "issue" that hold value "Bug" in column "kind"',
      operationClass: 'destructive',
      target: { id: 'sqlite', details: { objectType: 'column', name: 'kind', table: 'issue' } },
      precheck: [],
      execute: [
        {
          description: 'delete the rows of "issue" that hold value "Bug" in column "kind"',
          sql: 'DELETE FROM "issue" WHERE "kind" = ?1',
          params: ['Bug'],
        },
      ],
      postcheck: [
        {
          description: 'verify no row of "issue" holds value "Bug" in column "kind"',
          sql: 'SELECT NOT EXISTS (SELECT 1 FROM "issue" WHERE "kind" = ?1) AS result',
          params: ['Bug'],
        },
      ],
    });
  });

  it('writes the value through the codec it carries, and renders the codec', async () => {
    const codec = {
      codecRef: { codecId: 'sqlite/integer@1' },
      codecs: createSqliteBuiltinCodecLookup(),
    };
    const call = new DeleteRowsCall('issue', 'rank', '7', codec);

    expect([
      (await call.toOp()).execute[0]?.params,
      call.renderTypeScript(),
      call.importRequirements(),
    ]).toEqual([
      [7],
      'this.deleteRows({ table: "issue", column: "rank", value: "7", codecRef: { codecId: "sqlite/integer@1" } })',
      [],
    ]);
  });

  it('refuses a value that is neither a string nor a number', () => {
    expect(() => new DeleteRowsCall('issue', 'kind', null as unknown as string)).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.ARGUMENT_INVALID',
        message:
          'deleteRows({ table: "issue", column: "kind" }): value must be a string or a number; got null',
      }),
    );
  });
});
