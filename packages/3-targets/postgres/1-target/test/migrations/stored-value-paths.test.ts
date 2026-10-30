import { describe, expect, it } from 'vitest';
import {
  RemoveStoredValueCall,
  ReplaceStoredValueCall,
} from '../../src/core/migrations/op-factory-call';
import { postgresTypeLookups } from '../postgres-type-lookups';

const LOCATION = 'schema: "app", table: "issue", column: "doc"';

function replaceAt(path: string): ReplaceStoredValueCall {
  return new ReplaceStoredValueCall('app', 'issue', 'doc', 'OPEN', 'DONE', false, undefined, path);
}

describe('replaceStoredValue and removeStoredValue at a path', () => {
  it('compare the value at a member as a JSON value, passed as JSON text', async () => {
    const holds = `jsonb_path_exists("doc", 'strict $ ? (@.type() == "object").keyvalue() ? (@.key == "items").value ? (@.type() == "array")[*] ? (@.type() == "object" && exists(@.keyvalue() ? (@.key == "status" && @.value == $v)))', jsonb_build_object('v', $1::jsonb))`;

    expect(await replaceAt('$.items[*].status').toOp()).toMatchObject({
      id: 'replaceStoredValue.issue.doc.$.items[*].status.OPEN',
      label:
        'Replace value "OPEN" with "DONE" at path "$.items[*].status" in column "doc" of "issue"',
      precheck: [],
      execute: [
        {
          sql: `UPDATE "app"."issue" SET "doc" = CASE WHEN jsonb_typeof("doc") = 'object' AND "doc" ? 'items' THEN jsonb_set("doc", ARRAY['items'], CASE WHEN jsonb_typeof(("doc" -> 'items')) = 'array' THEN (SELECT coalesce(jsonb_agg(CASE WHEN jsonb_typeof(e0.v) = 'object' AND e0.v -> 'status' = $1::jsonb THEN jsonb_set(e0.v, ARRAY['status'], $2::jsonb) ELSE e0.v END ORDER BY e0.i), '[]'::jsonb) FROM jsonb_array_elements(("doc" -> 'items')) WITH ORDINALITY AS e0(v, i)) ELSE ("doc" -> 'items') END) ELSE "doc" END WHERE ${holds}`,
          params: ['"OPEN"', '"DONE"'],
        },
      ],
      postcheck: [
        {
          sql: `SELECT NOT EXISTS (SELECT 1 FROM "app"."issue" WHERE ${holds}) AS result`,
          params: ['"OPEN"'],
        },
      ],
    });
  });

  it('remove an element from a list with no check, and check a member that takes no null', async () => {
    const fromList = await new RemoveStoredValueCall(
      'app',
      'issue',
      'doc',
      3,
      false,
      undefined,
      undefined,
      '$.ranks[*]',
    ).toOp();
    const required = await new RemoveStoredValueCall(
      'app',
      'issue',
      'doc',
      'OPEN',
      false,
      undefined,
      { enum: 'Status', member: 'OPEN' },
      '$.status',
    ).toOp();
    const nullable = await new RemoveStoredValueCall(
      'app',
      'issue',
      'doc',
      'OPEN',
      false,
      undefined,
      undefined,
      '$.status',
      true,
    ).toOp();

    expect({
      fromList: fromList.precheck,
      list: fromList.execute[0]?.sql,
      required: required.precheck.map(({ description, meta }) => ({ description, meta })),
      nullable: nullable.precheck,
      setsNull: nullable.execute[0]?.sql,
    }).toEqual({
      fromList: [],
      list: expect.stringContaining(
        `(SELECT coalesce(jsonb_agg(e0.v ORDER BY e0.i), '[]'::jsonb) FROM jsonb_array_elements(("doc" -> 'ranks')) WITH ORDINALITY AS e0(v, i) WHERE e0.v <> $1::jsonb)`,
      ),
      required: [
        {
          description:
            'ensure no row holds "OPEN" at path "$.status" in column "doc" of "issue", a member that takes no null',
          meta: {
            rowsHoldingValue: {
              enumValue: { enum: 'Status', member: 'OPEN' },
              value: 'OPEN',
              table: 'issue',
              column: 'doc',
              storedValue: 'OPEN',
              path: '$.status',
            },
          },
        },
      ],
      nullable: [],
      setsNull: expect.stringContaining(`jsonb_set("doc", ARRAY['status'], 'null'::jsonb)`),
    });
  });

  it.each(['$..status', '$.*', '$[0]', '$[0:2]', '$[?@.status]', "$['a','b']", '$'])(
    'refuse the path %j when they are built',
    (path) => {
      expect(() => replaceAt(path)).toThrow(
        expect.objectContaining({
          code: 'CONTRACT.ARGUMENT_INVALID',
          message: expect.stringContaining(
            `replaceStoredValue({ ${LOCATION} }): path ${JSON.stringify(path)}`,
          ),
        }),
      );
    },
  );

  it('refuse a path with many or a codec, and nullable without a path', () => {
    const codec = { codecRef: { codecId: 'pg/text@1' }, codecs: postgresTypeLookups.codecLookup };
    const refused = (message: string) =>
      expect.objectContaining({ code: 'CONTRACT.ARGUMENT_INVALID', message });
    const comparedAsJson =
      'path takes neither many nor codecRef: a value inside JSON is compared as a JSON value';

    expect(
      () =>
        new ReplaceStoredValueCall('app', 'issue', 'doc', 'a', 'b', true, undefined, '$.tags[*]'),
    ).toThrow(refused(`replaceStoredValue({ ${LOCATION} }): ${comparedAsJson}`));
    expect(
      () => new RemoveStoredValueCall('app', 'issue', 'doc', 'a', false, codec, undefined, '$.s'),
    ).toThrow(refused(`removeStoredValue({ ${LOCATION} }): ${comparedAsJson}`));
    expect(
      () =>
        new RemoveStoredValueCall(
          'app',
          'issue',
          'doc',
          'a',
          false,
          undefined,
          undefined,
          undefined,
          true,
        ),
    ).toThrow(
      refused(
        `removeStoredValue({ ${LOCATION} }): nullable needs a path: a column says itself whether it takes NULL`,
      ),
    );
  });

  it('render the path in the facade call', () => {
    expect([
      replaceAt('$.status').renderTypeScript(),
      new RemoveStoredValueCall(
        'app',
        'issue',
        'doc',
        'OPEN',
        false,
        undefined,
        undefined,
        '$.status',
        true,
      ).renderTypeScript(),
    ]).toEqual([
      `this.replaceStoredValue({ ${LOCATION}, path: "$.status", from: "OPEN", to: "DONE" })`,
      `this.removeStoredValue({ ${LOCATION}, path: "$.status", value: "OPEN", nullable: true })`,
    ]);
  });
});
