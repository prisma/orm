import { describe, expect, it } from 'vitest';
import { coerceLedgerAppliedAt, operationCountFromStored } from '../src/core/ledger-decode';

describe('coerceLedgerAppliedAt', () => {
  it('returns Date instances unchanged', () => {
    const date = new Date('2024-01-15T10:30:00.000Z');
    expect(coerceLedgerAppliedAt(date)).toBe(date);
  });

  it('parses Z-suffixed ISO-8601 as UTC', () => {
    const parsed = coerceLedgerAppliedAt('2024-06-01T12:00:00.000Z');
    expect(parsed.toISOString()).toBe('2024-06-01T12:00:00.000Z');
  });

  it('parses designator-less SQLite datetime as UTC', () => {
    const parsed = coerceLedgerAppliedAt('2024-06-01 12:00:00');
    expect(parsed.toISOString()).toBe('2024-06-01T12:00:00.000Z');
  });
});

describe('operationCountFromStored', () => {
  it('counts array operations', () => {
    expect(operationCountFromStored([{ id: 'a' }, { id: 'b' }])).toBe(2);
  });

  it('parses JSON string operations', () => {
    expect(operationCountFromStored('[{"id":"a"}]')).toBe(1);
  });

  it('returns zero for invalid JSON', () => {
    expect(operationCountFromStored('not-json')).toBe(0);
  });
});
