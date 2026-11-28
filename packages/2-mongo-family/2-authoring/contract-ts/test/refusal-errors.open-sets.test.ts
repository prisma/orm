import { describe, expect, it } from 'vitest';
import { refusalError } from '../src/refusal-errors';

describe('refusalError for a value a later release adds', () => {
  it('words an index rule it has no message for by its name', () => {
    const error = refusalError({
      kind: 'indexShape',
      key: { kind: 'index', model: 'User', position: 0 },
      rule: 'future-rule',
      signature: '{ email: 1 }',
    });
    expect(error.message).toBe(
      'Model "User" index { email: 1 } breaks the index rule "future-rule".',
    );
  });

  it('words a restated-field difference it does not know by its name', () => {
    const error = refusalError({
      kind: 'restatedBaseFieldDiffers',
      key: { kind: 'field', owner: { kind: 'model', name: 'Admin' }, field: 'email' },
      baseModel: 'User',
      differences: ['type', 'collation'],
    });
    expect(error.message).toContain('with a different type and collation.');
  });
});
