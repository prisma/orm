import { describe, expect, it } from 'vitest';
import { validatePostgresIsolationLevel } from '../src/core/transaction-isolation';

describe('PostgreSQL isolation validation', () => {
  it.each(['ReadUncommitted', 'ReadCommitted', 'RepeatableRead', 'Serializable'])(
    'accepts %s',
    (value) => expect(validatePostgresIsolationLevel(value)).toBe(value),
  );

  it.each([null, undefined, 0, true, {}, 'read committed', 'Serializable; SELECT 1'])(
    'rejects %j with structured argument metadata',
    (value) => {
      expect(() => validatePostgresIsolationLevel(value)).toThrow(
        expect.objectContaining({
          code: 'RUNTIME.ARGUMENT_INVALID',
          why: expect.any(String),
          fix: expect.any(String),
          meta: { argument: 'isolationLevel', received: value },
        }),
      );
    },
  );
});
