import { describe, expect, it } from 'vitest';
import { sqliteBigintDescriptor } from '../src/core/codecs';
import { fromContractJson, toContractJson } from './contract-json';

describe('SQLite codec JSON representations', () => {
  const bigintCodec = sqliteBigintDescriptor.factory()({ name: 'test' });

  it('uses decimal text for bigint values, so the int64 range survives', () => {
    expect(toContractJson(bigintCodec, 42n)).toBe('42');
    expect(fromContractJson(bigintCodec, '42')).toBe(42n);
    expect(toContractJson(bigintCodec, 9223372036854775807n)).toBe('9223372036854775807');
    expect(fromContractJson(bigintCodec, '9223372036854775807')).toBe(9223372036854775807n);
  });

  it('rejects a JSON number, which has already lost digits', () => {
    expect(() => fromContractJson(bigintCodec, 42)).toThrow(
      'sqlite/integer JSON value must be a decimal integer string from -9223372036854775808 to 9223372036854775807',
    );
  });

  it('decodes number, bigint, and decimal-text wires to the same bigint', async () => {
    expect(await bigintCodec.fromWire(42, {})).toBe(42n);
    expect(await bigintCodec.fromWire(42n, {})).toBe(42n);
    expect(await bigintCodec.fromWire('9223372036854775807', {})).toBe(9223372036854775807n);
    expect(await bigintCodec.fromWire('-42', {})).toBe(-42n);
  });

  it('rejects a malformed string wire with a structured decode error', async () => {
    await expect(bigintCodec.fromWire('not-a-number', {})).rejects.toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      message: 'sqlite/bigint@1 wire value must be a decimal string',
      meta: { codecId: 'sqlite/bigint@1' },
    });
  });
});
