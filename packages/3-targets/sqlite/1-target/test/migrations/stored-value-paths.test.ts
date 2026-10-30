import { describe, expect, it } from 'vitest';
import { createSqliteBuiltinCodecLookup } from '../../src/core/codec-registry';
import {
  RemoveStoredValueCall,
  ReplaceStoredValueCall,
} from '../../src/core/migrations/op-factory-call';

const LOCATION = 'table: "issue", column: "doc"';

function replaceAt(path: string): ReplaceStoredValueCall {
  return new ReplaceStoredValueCall('issue', 'doc', 'OPEN', 'DONE', undefined, path);
}

describe('replaceStoredValue and removeStoredValue at a path', () => {
  it('compare the value at a member by its JSON type and value', async () => {
    const holds = `(json_type("doc") = 'object' AND json_type("doc", '$."items"') IS NOT NULL AND (json_type(("doc" -> '$."items"')) = 'array' AND EXISTS (SELECT 1 FROM json_each(("doc" -> '$."items"')) AS e0 WHERE (json_type((("doc" -> '$."items"') -> e0.key)) = 'object' AND (json_type(((("doc" -> '$."items"') -> e0.key) -> '$."status"')) = 'text' AND (((("doc" -> '$."items"') -> e0.key) -> '$."status"') ->> '$') = ?1)))))`;

    expect(await replaceAt('$.items[*].status').toOp()).toMatchObject({
      id: 'replaceStoredValue.issue.doc.$.items[*].status.OPEN',
      label:
        'Replace value "OPEN" with "DONE" at path "$.items[*].status" in column "doc" of "issue"',
      precheck: [],
      execute: [{ sql: expect.stringMatching(/ WHERE /), params: ['OPEN', 'DONE'] }],
      postcheck: [
        {
          sql: `SELECT NOT EXISTS (SELECT 1 FROM "issue" WHERE ${holds}) AS result`,
          params: ['OPEN'],
        },
      ],
    });
  });

  it('remove an element from a list with no check, and check a member that takes no null', async () => {
    const fromList = await new RemoveStoredValueCall(
      'issue',
      'doc',
      3,
      undefined,
      undefined,
      '$.ranks[*]',
    ).toOp();
    const required = await new RemoveStoredValueCall(
      'issue',
      'doc',
      'OPEN',
      undefined,
      { enum: 'Status', member: 'OPEN' },
      '$.status',
    ).toOp();
    const nullable = await new RemoveStoredValueCall(
      'issue',
      'doc',
      'OPEN',
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
        `WHERE NOT (json_type((("doc" -> '$."ranks"') -> e0.key)) IN ('integer', 'real') AND ((("doc" -> '$."ranks"') -> e0.key) ->> '$') = ?1))`,
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
      setsNull: expect.stringContaining(`json_set("doc", '$."status"', json('null'))`),
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

  it('refuse a path with a codec, and nullable without a path', () => {
    const codec = {
      codecRef: { codecId: 'sqlite/text@1' },
      codecs: createSqliteBuiltinCodecLookup(),
    };
    const refused = (message: string) =>
      expect.objectContaining({ code: 'CONTRACT.ARGUMENT_INVALID', message });

    expect(() => new ReplaceStoredValueCall('issue', 'doc', 'a', 'b', codec, '$.tags[*]')).toThrow(
      refused(
        `replaceStoredValue({ ${LOCATION} }): path takes no codecRef: a value inside JSON is compared as a JSON value`,
      ),
    );
    expect(
      () => new RemoveStoredValueCall('issue', 'doc', 'a', undefined, undefined, undefined, true),
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
        'issue',
        'doc',
        'OPEN',
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
