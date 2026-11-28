import { describe, expect, it } from 'vitest';
import { validatorRefusalKey } from '../src/build-refusals';
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

  it('treats a refusal of a kind its own release cannot produce as a bug', () => {
    expect(() => refusalError({ kind: '%future added value', key: undefined })).toThrow(
      /words every refusal of its own release/,
    );
  });

  it('places no key for, and treats as a bug, a validator refusal its release cannot produce', () => {
    const refusal = { kind: '%future added value' } as const;
    expect(validatorRefusalKey(refusal)).toBeUndefined();
    expect(() => refusalError({ kind: 'validator', key: undefined, refusal })).toThrow(
      /words every validator refusal of its own release/,
    );
  });

  it("treats a field's codec refusal its release cannot produce as a bug", () => {
    const refuse = () =>
      refusalError({
        kind: 'validator',
        key: undefined,
        refusal: {
          kind: 'fieldBsonType',
          owner: { kind: 'model', name: 'User' },
          fieldName: 'email',
          codecId: 'acme/email@1',
          refusal: { kind: '%future added value', reason: 'has a codec this version cannot read.' },
        },
      });
    expect(refuse).toThrow(/words every codec refusal of its own release/);
  });
});
