/**
 * A string literal `@default` on a JSON codec is JSON text. The codec here is
 * a double of the Postgres jsonb JSON encoder, kept local so this package does
 * not depend on a target pack.
 */
import type { Codec, CodecLookup } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { interpretPslDocumentToSqlContract } from '../src/interpreter';
import {
  createBuiltinLikeControlMutationDefaults,
  postgresNativeScalarTypeDescriptors,
  postgresTarget,
  symbolTableInputFromParseArgs,
} from './fixtures';
import { sqlStorageFromSuccessfulSqlInterpretation } from './interpret-sql-contract-storage';
import { unboundTables } from './unbound-tables';

const jsonbCodec: Codec = {
  id: 'pg/jsonb@1',
  encode: async (v: unknown) => v,
  decode: async (w: unknown) => w,
  encodeJson: (value) => value as never,
  decodeJson: (json) => json as never,
};

const codecs = new Map<string, Codec>([[jsonbCodec.id, jsonbCodec]]);

const codecLookup: CodecLookup = {
  get: (id) => codecs.get(id),
  targetTypesFor: () => undefined,
  renderOutputTypeFor: () => undefined,
};

function interpret(schema: string) {
  const document = symbolTableInputFromParseArgs({ schema, sourceId: 'schema.prisma' });
  return interpretPslDocumentToSqlContract({
    ...document,
    target: postgresTarget,
    scalarColumnDescriptors: postgresNativeScalarTypeDescriptors,
    controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
    composedExtensionContracts: new Map(),
    createNamespace: createTestSqlNamespace,
    capabilities: { sql: { scalarList: true } },
    codecLookup,
  });
}

function columnDefault(schema: string, column: string) {
  const result = interpret(schema);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(JSON.stringify(result.failure.diagnostics));
  return unboundTables(sqlStorageFromSuccessfulSqlInterpretation(result.value))['t']?.columns[
    column
  ]?.default;
}

describe('JSON literal defaults', () => {
  it.each([
    ['{"a":1}', { a: 1 }],
    ['{}', {}],
    ['[]', []],
    ['[1,"two",null]', [1, 'two', null]],
  ])(
    'lowers the string literal %s on a Jsonb column to the JSON value it spells',
    (text, value) => {
      expect(
        columnDefault(
          `model T {
  id Int @id
  payload Jsonb @default(${JSON.stringify(text)})
}`,
          'payload',
        ),
      ).toEqual({ kind: 'literal', value });
    },
  );

  it('reports invalid JSON text with the field and the parse error', () => {
    const result = interpret(`model T {
  id Int @id
  payload Jsonb @default("{oops")
}`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual([
      expect.objectContaining({
        code: 'PSL_INVALID_JSON_DEFAULT',
        message: expect.stringContaining('T.payload'),
        span: expect.objectContaining({ start: expect.objectContaining({ line: 3 }) }),
      }),
    ]);
    expect(result.failure.diagnostics[0]?.message).toMatch(/JSON/);
  });

  it('leaves a string literal on a text column a string', () => {
    expect(
      columnDefault(
        `model T {
  id Int @id
  title String @default("{}")
}`,
        'title',
      ),
    ).toEqual({ kind: 'literal', value: '{}' });
  });
});
