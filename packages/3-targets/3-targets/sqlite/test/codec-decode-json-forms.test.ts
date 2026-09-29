import type { CodecInstanceContext } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import { sqliteTextDescriptor } from '../src/core/codecs';

const ctx: CodecInstanceContext = { name: 'decode-json-forms' };

describe('sqlite/text@1 decodeJson', () => {
  const codec = sqliteTextDescriptor.factory()(ctx);

  // SQLite's json_object and json_group_array write a TEXT column as a JSON string, including a number stored into it, which TEXT affinity converts to text.
  it('reads the JSON strings SQLite writes for a text column', () => {
    expect(['hello', '', '42'].map((json) => codec.decodeJson(json))).toEqual(['hello', '', '42']);
  });

  it.each([[42], [true], [null], [['a']]])('refuses %j', (json) => {
    expect(() => codec.decodeJson(json)).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.DECODE_FAILED',
        meta: { codecId: 'sqlite/text@1', received: json === null ? 'object' : typeof json },
      }),
    );
  });
});
