import { isStructuredError } from '@internal/utils/structured-error';
import { describe, expect, it } from 'vitest';
import { defineContract } from '../src/contract-builder';

describe('defineContract argument validation', () => {
  it('non-object definition raises CONTRACT.ARGUMENT_INVALID', () => {
    let caught: unknown;
    try {
      defineContract(null as never);
    } catch (error) {
      caught = error;
    }
    expect(isStructuredError(caught)).toBe(true);
    expect(caught).toMatchObject({
      code: 'CONTRACT.ARGUMENT_INVALID',
      message:
        'defineContract expects a contract definition object. Define your contract with defineContract({ family, target, models, ... }).',
    });
  });
});
