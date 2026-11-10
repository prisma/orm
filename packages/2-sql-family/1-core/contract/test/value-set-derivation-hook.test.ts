import { describe, expect, it } from 'vitest';
import {
  deriveValueSetFromEntity,
  providesValueSetDerivation,
} from '../src/value-set-derivation-hook';

describe('providesValueSetDerivation', () => {
  it('true for an output exposing a deriveValueSet function', () => {
    const output = { factory: () => undefined, deriveValueSet: () => undefined };
    expect(providesValueSetDerivation(output)).toBe(true);
  });

  it('false for an output without deriveValueSet', () => {
    const output = { factory: () => undefined };
    expect(providesValueSetDerivation(output)).toBe(false);
  });

  it('false when deriveValueSet is not a function', () => {
    const output = { factory: () => undefined, deriveValueSet: 'not-a-function' };
    expect(providesValueSetDerivation(output)).toBe(false);
  });

  it('false for null and non-object values', () => {
    expect(providesValueSetDerivation(null)).toBe(false);
    expect(providesValueSetDerivation(undefined)).toBe(false);
    expect(providesValueSetDerivation('entityType')).toBe(false);
  });
});

describe('deriveValueSetFromEntity', () => {
  it('invokes deriveValueSet with the entity and returns its result', () => {
    const entity = {
      members: [
        { name: 'A', value: 'a' },
        { name: 'B', value: 'b' },
      ],
    };
    const output = {
      factory: () => undefined,
      deriveValueSet: (e: unknown) => {
        const typed = e as typeof entity;
        return { kind: 'valueSet' as const, values: typed.members.map((m) => m.value) };
      },
    };

    expect(deriveValueSetFromEntity(output, entity)).toEqual({
      kind: 'valueSet',
      values: ['a', 'b'],
    });
  });

  it('returns undefined when the output has no deriveValueSet hook', () => {
    const output = { factory: () => undefined };
    expect(deriveValueSetFromEntity(output, {})).toBeUndefined();
  });

  it('returns undefined when deriveValueSet itself returns undefined', () => {
    const output = { factory: () => undefined, deriveValueSet: () => undefined };
    expect(deriveValueSetFromEntity(output, {})).toBeUndefined();
  });
});
