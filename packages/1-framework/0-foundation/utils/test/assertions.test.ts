import { describe, expect, it } from 'vitest';
import { assertDefined, invariant } from '../src/assertions';

describe('assertDefined', () => {
  it('passes through defined values', () => {
    const value: string | undefined = 'hello';
    assertDefined(value, 'should not throw');
    expect(value.length).toBe(5);
  });

  it('throws for undefined', () => {
    const value: string | undefined = undefined;
    expect(() => assertDefined(value, 'value was undefined')).toThrow('value was undefined');
  });

  it('throws for null', () => {
    const errorMessage = 'value was null';
    const value: string | null = null;
    expect(() => assertDefined(value, errorMessage)).toThrow(errorMessage);
  });

  it('allows zero and empty string', () => {
    assertDefined(0, 'should not throw');
    assertDefined('', 'should not throw');
    assertDefined(false, 'should not throw');
  });
});

describe('invariant', () => {
  it('passes when condition is true', () => {
    expect(() => invariant(true, 'should not throw')).not.toThrow();
  });

  it('throws when condition is false', () => {
    expect(() => invariant(false, 'condition failed')).toThrow('condition failed');
  });
});
