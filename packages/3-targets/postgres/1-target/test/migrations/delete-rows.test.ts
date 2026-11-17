import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { DeleteRowsCall } from '../../src/core/migrations/op-factory-call';
import { postgresTypeLookups } from '../postgres-type-lookups';

describe('deleteRows', () => {
  it('deletes the rows that hold the value, and checks afterwards that none does', async () => {
    expect(await new DeleteRowsCall('app', 'issue', 'kind', 'Bug').toOp()).toEqual({
      id: 'deleteRows.issue.kind.Bug',
      label: 'Delete the rows of "issue" that hold value "Bug" in column "kind"',
      operationClass: 'destructive',
      target: {
        id: 'postgres',
        details: { schema: 'app', objectType: 'column', name: 'kind', table: 'issue' },
      },
      precheck: [],
      execute: [
        {
          description: 'delete the rows of "issue" that hold value "Bug" in column "kind"',
          sql: 'DELETE FROM "app"."issue" WHERE "kind" = $1',
          params: ['Bug'],
        },
      ],
      postcheck: [
        {
          description: 'verify no row of "issue" holds value "Bug" in column "kind"',
          sql: 'SELECT NOT EXISTS (SELECT 1 FROM "app"."issue" WHERE "kind" = $1) AS result',
          params: ['Bug'],
        },
      ],
    });
  });

  it('writes the value through the codec it carries, and renders the codec', async () => {
    const codec = { codecRef: { codecId: 'pg/int8@1' }, codecs: postgresTypeLookups.codecLookup };
    const call = new DeleteRowsCall(UNBOUND_NAMESPACE_ID, 'issue', 'rank', '7', codec);

    expect([
      (await call.toOp()).execute[0]?.params,
      call.renderTypeScript(),
      call.importRequirements(),
    ]).toEqual([
      ['7'],
      'this.deleteRows({ table: "issue", column: "rank", value: "7", codecRef: { codecId: "pg/int8@1" } })',
      [],
    ]);
  });

  it('refuses a value that is neither a string nor a number', () => {
    expect(() => new DeleteRowsCall('app', 'issue', 'kind', null as unknown as string)).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.ARGUMENT_INVALID',
        message:
          'deleteRows({ schema: "app", table: "issue", column: "kind" }): value must be a string or a number; got null',
      }),
    );
  });
});
