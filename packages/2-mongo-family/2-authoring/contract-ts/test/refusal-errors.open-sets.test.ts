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

  it('words a refusal of a kind it does not know by the kind', () => {
    const error = refusalError({ kind: '%future added value', key: undefined });
    expect(error).toMatchObject({
      code: 'CONTRACT.ARGUMENT_INVALID',
      message:
        'The contract definition is refused for a reason this version does not name ("%future added value").',
    });
  });

  it('words a validator refusal of a kind it does not know by the kind', () => {
    const refusal = { kind: '%future added value' } as const;
    expect(validatorRefusalKey(refusal)).toBeUndefined();
    expect(refusalError({ kind: 'validator', key: undefined, refusal })).toMatchObject({
      code: 'CONTRACT.ARGUMENT_INVALID',
      message:
        'The collection validator refuses the contract for a reason this version does not name ("%future added value").',
    });
  });

  it("words a field's codec refusal of a kind it does not know by its reason", () => {
    const error = refusalError({
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
    expect(error).toMatchObject({
      code: 'CONTRACT.PACK_CONTRIBUTION_INVALID',
      message: 'Model "User" field "email" has a codec this version cannot read.',
      meta: { reason: '%future added value' },
    });
  });
});
