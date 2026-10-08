import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import type { AuthoringStorageTypeTemplate } from '../src/shared/framework-authoring';
import { validateAuthoringTypeParams } from '../src/shared/framework-authoring';

const lengthSchema = type({ 'length?': 'number.integer >= 1 & number.integer <= 10' });

const sized: AuthoringStorageTypeTemplate = {
  codecId: 'test/sized@1',
  typeParams: { length: { kind: 'arg', index: 1 } },
};

describe('validateAuthoringTypeParams', () => {
  it('accepts parameters the codec schema accepts', () => {
    expect(() =>
      validateAuthoringTypeParams('Sized', sized, { length: 10 }, lengthSchema),
    ).not.toThrow();
  });

  it('refuses a parameter the codec schema refuses, naming the argument it came from', () => {
    expect(() => validateAuthoringTypeParams('Sized', sized, { length: 11 }, lengthSchema)).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.ARGUMENT_INVALID',
        message:
          'Authoring helper argument at Sized[1] is invalid: length must be at most 10 (was 11)',
        details: expect.objectContaining({ helperPath: 'Sized', argumentIndex: 1 }),
      }),
    );
  });

  it('refuses a parameter at the lower edge of the schema', () => {
    expect(() => validateAuthoringTypeParams('Sized', sized, { length: 0 }, lengthSchema)).toThrow(
      'Authoring helper argument at Sized[1] is invalid: length must be at least 1 (was 0)',
    );
  });

  it('names no argument when the failure is not one parameter', () => {
    const paired = type({ 'a?': 'number', 'b?': 'number' }).narrow(
      (params, ctx) => params.b === undefined || params.a !== undefined || ctx.reject('a with b'),
    );
    expect(() =>
      validateAuthoringTypeParams(
        'Pair',
        { codecId: 'test/pair@1', typeParams: { b: { kind: 'arg', index: 0 } } },
        { b: 1 },
        paired,
      ),
    ).toThrow(/^The type parameters of Pair are invalid: /);
  });

  it('checks nothing for a template that maps no argument', () => {
    expect(() =>
      validateAuthoringTypeParams('Plain', { codecId: 'test/plain@1' }, undefined, lengthSchema),
    ).not.toThrow();
  });

  it('checks nothing for a codec without a parameter schema', () => {
    expect(() =>
      validateAuthoringTypeParams('Sized', sized, { length: 11 }, undefined),
    ).not.toThrow();
  });
});
