import { describe, expect, it } from 'vitest';
import { sqliteDatetimeDescriptor } from '../src/core/codecs';
import { sqliteDatetime } from '../src/core/data-types';
import { fromContractJson, toContractJson } from './contract-json';

describe('sqlite/datetime@1', () => {
  const codec = sqliteDatetimeDescriptor.factory()({ name: '<test>' });

  it('represents sqlite/datetime, which owns the value', () => {
    expect(sqliteDatetimeDescriptor.dataType).toBe(sqliteDatetime.id);
  });

  it('writes a Date as the text toISOString() writes', () => {
    expect([
      toContractJson(codec, new Date('2024-01-01T00:00:00.000Z')),
      toContractJson(codec, new Date('2024-01-01T00:00:00.250Z')),
      toContractJson(codec, new Date('-000043-03-15T00:00:00.000Z')),
    ]).toEqual([
      '2024-01-01T00:00:00.000Z',
      '2024-01-01T00:00:00.250Z',
      '-000043-03-15T00:00:00.000Z',
    ]);
  });

  it('reads the stored value as the instant it names', () => {
    expect(fromContractJson(codec, '2024-01-01T00:00:00.000Z')).toEqual(
      new Date('2024-01-01T00:00:00.000Z'),
    );
  });

  it('refuses a stored value without three fraction digits', () => {
    expect(() => fromContractJson(codec, '2024-01-01T00:00:00Z')).toThrow(
      expect.objectContaining({ code: 'RUNTIME.DECODE_FAILED' }),
    );
  });
});
