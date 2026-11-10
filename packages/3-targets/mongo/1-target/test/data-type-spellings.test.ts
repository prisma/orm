import { describe, expect, it } from 'vitest';
import { mongoDecimal128Codec } from '../src/core/codecs';
import { mongoBinary, mongoDecimal128, mongoObjectId } from '../src/core/data-types';

describe('a Mongo value has one stored spelling', () => {
  it('refuses base64 with padding bits set, naming the base64 the type stores', () => {
    expect(() => mongoBinary.fromContract('AB==', {})).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.DECODE_FAILED',
        message: 'mongo/binary JSON value must be "AA==", as mongo/binary stores this value',
      }),
    );
  });

  it('reads base64 in the spelling it stores', () => {
    expect(mongoBinary.fromContract('AA==', {}).value).toBe('AA==');
  });

  it('refuses an ObjectId in upper case, naming the lower case it stores', () => {
    expect(() => mongoObjectId.fromContract('507F1F77BCF86CD799439011', {})).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.DECODE_FAILED',
        message:
          'mongo/objectid JSON value must be "507f1f77bcf86cd799439011", as mongo/objectid stores this value',
      }),
    );
  });

  it('builds a value from another spelling in the spelling it stores', () => {
    expect({
      binary: mongoBinary.valueFrom('AB==', {}).value,
      objectId: mongoObjectId.valueFrom('507F1F77BCF86CD799439011', {}).value,
    }).toEqual({ binary: 'AA==', objectId: '507f1f77bcf86cd799439011' });
  });
});

describe('a mongo/decimal128 value is spelled as MongoDB writes it', () => {
  it('drops leading zeros and keeps the sign of zero and trailing zeros', () => {
    expect(
      ['007.50', '-007', '00.5', '-0', '-00.0', '0', 'NaN', '-Infinity'].map(
        (text) => mongoDecimal128.valueFrom(text, {}).value,
      ),
    ).toEqual(['7.50', '-7', '0.5', '-0', '-0.0', '0', 'NaN', '-Infinity']);
  });

  it('refuses a stored value with leading zeros, naming the spelling it stores', () => {
    expect(() => mongoDecimal128.fromContract('007.5', {})).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.DECODE_FAILED',
        message: 'mongo/decimal128 JSON value must be "7.5", as mongo/decimal128 stores this value',
      }),
    );
  });

  it('keeps negative zero that the codec hands over', () => {
    expect(mongoDecimal128Codec.toDataTypeValue('-0').value).toBe('-0');
  });

  it.each([
    '0.1000000000000000000000000000000000000001',
    '123456789012345678901234567890123456789',
    `1.${'0'.repeat(36)}`,
  ])('refuses %s, which a Decimal128 would round', (text) => {
    expect(() => mongoDecimal128.valueFrom(text, {})).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.DECODE_FAILED',
        message:
          'mongo/decimal128 JSON value must be decimal text without an exponent that a Decimal128 holds exactly, or NaN, Infinity or -Infinity',
      }),
    );
  });

  it('refuses a stored value a Decimal128 would round, as contract.json loads it', () => {
    expect(() => mongoDecimal128.fromContract(`1.${'0'.repeat(36)}`, {})).toThrow(
      expect.objectContaining({ code: 'RUNTIME.DECODE_FAILED' }),
    );
  });
});
