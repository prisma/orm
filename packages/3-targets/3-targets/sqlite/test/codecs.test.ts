import { describe, expect, it } from 'vitest';
import { sqliteBigintDescriptor } from '../src/core/codecs';

describe('SQLite codec JSON representations', () => {
  const bigintCodec = sqliteBigintDescriptor.factory()({ name: 'test' });

  it('uses decimal text for bigint values, so the int64 range survives', () => {
    expect(bigintCodec.encodeJson(42n)).toBe('42');
    expect(bigintCodec.decodeJson('42')).toBe(42n);
    expect(bigintCodec.encodeJson(9223372036854775807n)).toBe('9223372036854775807');
    expect(bigintCodec.decodeJson('9223372036854775807')).toBe(9223372036854775807n);
  });

  it('rejects a JSON number, which has already lost digits', () => {
    expect(() => bigintCodec.decodeJson(42)).toThrow(
      'sqlite/bigint@1 database JSON value must be a decimal string',
    );
  });

  it('decodes number, bigint, and decimal-text wires to the same bigint', async () => {
    expect(await bigintCodec.decode(42, {})).toBe(42n);
    expect(await bigintCodec.decode(42n, {})).toBe(42n);
    expect(await bigintCodec.decode('9223372036854775807', {})).toBe(9223372036854775807n);
    expect(await bigintCodec.decode('-42', {})).toBe(-42n);
  });

  it('rejects a malformed string wire with a structured decode error', async () => {
    await expect(bigintCodec.decode('not-a-number', {})).rejects.toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      message: 'sqlite/bigint@1 wire value must be a decimal string',
      meta: { codecId: 'sqlite/bigint@1' },
    });
  });
});
