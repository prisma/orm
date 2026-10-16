import { structuredError } from '@internal/utils/structured-error';
import { describe, expect, it } from 'vitest';
import { contractDefaultRefusal } from '../src/ir/default-in-canonical-form';

const noLiteralValues = () => {
  throw structuredError('CONTRACT.LITERAL_VALUES_ABSENT', 'This type has no literal values.', {});
};

describe('a literal default of a type that has no literal values', () => {
  it('is refused with the data type message, without saying to re-emit', () => {
    expect(contractDefaultRefusal({ kind: 'literal', value: 'x' }, noLiteralValues, false)).toBe(
      'The contract holds a literal default. This type has no literal values.',
    );
  });

  it('is refused for a list default too', () => {
    expect(contractDefaultRefusal({ kind: 'literal', value: ['x'] }, noLiteralValues, true)).toBe(
      'The contract holds a literal default. This type has no literal values.',
    );
  });
});
