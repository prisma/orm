import { describe, expect, it } from 'vitest';
import { validateSqliteIsolationLevel } from '../src/core/transaction-isolation';

describe('SQLite isolation validation', () => {
  it('accepts Serializable', () => {
    expect(validateSqliteIsolationLevel('Serializable')).toBe('Serializable');
  });

  it.each([
    null,
    undefined,
    0,
    true,
    {},
    'ReadUncommitted',
    'ReadCommitted',
    'RepeatableRead',
    'Serializable; SELECT 1',
  ])('rejects %j with structured argument metadata', (value) => {
    expect(() => validateSqliteIsolationLevel(value)).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.ARGUMENT_INVALID',
        why: expect.any(String),
        fix: expect.any(String),
        meta: { argument: 'isolationLevel', received: value },
      }),
    );
  });
});
