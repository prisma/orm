import { describe, expect, it } from 'vitest';
import { validateSavepointName } from '../../src/exports/ast';

describe('validateSavepointName', () => {
  it.each(['sp', 'sp_1', '_x', 'Savepoint9'])('accepts %j', (name) => {
    expect(validateSavepointName(name)).toBe(name);
  });

  it.each(['', '1sp', 'sp name', 'sp;DROP TABLE t', 'sp"x', "sp'x", 'sp-1', 'sp\n', null, 1])(
    'rejects %j',
    (name) => {
      expect(() => validateSavepointName(name)).toThrow(
        expect.objectContaining({ code: 'RUNTIME.ARGUMENT_INVALID' }),
      );
    },
  );
});
