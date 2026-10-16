import { describe, expect, it } from 'vitest';
import { mongoBinary, mongoObjectId } from '../src/core/data-types';

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
