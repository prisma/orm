/**
 * An integer literal `@default` on a bigint-valued codec keeps its exact
 * digits. The codec here is a double of the Postgres int8 JSON encoder, kept
 * local so this package does not depend on a target pack.
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

const int8Codec: Codec = {
  id: 'pg/int8@1',
  encode: async (v: unknown) => v,
  decode: async (w: unknown) => w,
  encodeJson(value) {
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value).toString();
    throw new Error(`pg/int8@1 refuses ${typeof value} ${String(value)}`);
  },
  decodeJson: (json) => json as never,
};

const codecs = new Map<string, Codec>([[int8Codec.id, int8Codec]]);

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

describe('BigInt literal defaults', () => {
  it('keeps every digit of an integer literal past the safe integer range', () => {
    expect(
      columnDefault(
        `model T {
  id Int @id
  big BigInt @default(9007199254740993)
}`,
        'big',
      ),
    ).toEqual({ kind: 'literal', value: '9007199254740993' });
  });

  it('keeps every digit inside a list literal', () => {
    expect(
      columnDefault(
        `model T {
  id Int @id
  bigs BigInt[] @default([1, 9007199254740993])
}`,
        'bigs',
      ),
    ).toEqual({ kind: 'literal', value: ['1', '9007199254740993'] });
  });

  it('leaves a safe integer literal on a bigint column exact as well', () => {
    expect(
      columnDefault(
        `model T {
  id Int @id
  big BigInt @default(42)
}`,
        'big',
      ),
    ).toEqual({ kind: 'literal', value: '42' });
  });
});
