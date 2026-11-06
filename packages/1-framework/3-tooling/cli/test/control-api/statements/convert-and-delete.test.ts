import { describe, expect, it } from 'vitest';
import { convertAndDelete } from '../../../src/control-api/statements/statement-text';
import { errorConvertAndDelete } from '../../../src/utils/cli-errors';

describe('convertAndDelete', () => {
  it('finds a field that a convert and a delete both name', () => {
    expect(
      convertAndDelete([
        { verb: 'delete', text: 'Post' },
        { verb: 'convert', text: 'User.age' },
        { verb: 'delete', text: 'User.age' },
      ]),
    ).toBe('User.age');
  });

  it('finds nothing when they name different subjects', () => {
    expect(
      convertAndDelete([
        { verb: 'convert', text: 'User.age' },
        { verb: 'delete', text: 'User.name' },
      ]),
    ).toBeUndefined();
  });
});

describe('errorConvertAndDelete', () => {
  it('says the two flags conflict and to give one', () => {
    const error = errorConvertAndDelete('User.age');
    expect({
      code: error.code,
      message: error.message,
      why: error.why,
      fix: error.fix,
    }).toEqual({
      code: 'MIGRATION.STATEMENT_INVALID',
      message: '"--convert User.age" and "--delete User.age" conflict',
      why: 'Both answer the type change of "User.age": --convert converts each value with code you write in migration.ts, and --delete lets the database cast each value, losing those it cannot keep.',
      fix: 'Give one of them: --convert User.age, or --delete User.age.',
    });
  });
});
