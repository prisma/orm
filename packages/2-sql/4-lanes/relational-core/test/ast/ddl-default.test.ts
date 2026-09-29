import type { JsonValue } from '@internal/contract/types';
import type { CodecInstanceContext } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import { readLiteralDefault } from '../../src/ast/ddl-default';
import { sqlTextDescriptor } from '../../src/ast/sql-codecs';
import { defineTestCodec } from './test-codec';

const ctx: CodecInstanceContext = { name: 'ddl-default' };
const text = sqlTextDescriptor.factory()(ctx);
const document = defineTestCodec({
  typeId: 'test/document@1',
  encode: (value: JsonValue) => JSON.stringify(value),
  decode: (wire: string): JsonValue => JSON.parse(wire),
});

describe('readLiteralDefault', () => {
  it('reads a stored default with the codec, and passes a Date through', () => {
    const date = new Date('2024-01-02T03:04:05.000Z');
    expect([readLiteralDefault(text, 'hello'), readLiteralDefault(text, date)]).toEqual([
      { kind: 'value', value: 'hello' },
      { kind: 'value', value: date },
    ]);
  });

  it('reads a null default as SQL NULL when the codec refuses null', () => {
    expect(readLiteralDefault(text, null)).toEqual({ kind: 'sql-null' });
  });

  it('reads a null default as the value null when the codec reads null', () => {
    expect(readLiteralDefault(document, null)).toEqual({ kind: 'value', value: null });
  });

  it('rethrows the codec refusal for any other value', () => {
    expect(() => readLiteralDefault(text, 1)).toThrow(
      expect.objectContaining({ code: 'RUNTIME.DECODE_FAILED' }),
    );
  });
});
