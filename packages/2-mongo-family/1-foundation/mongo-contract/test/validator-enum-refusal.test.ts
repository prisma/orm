import { describe, expect, it } from 'vitest';
import {
  validatorEnumMemberRefusalOf,
  validatorEnumRefusalOf,
} from '../src/validator-enum-refusal';

describe('validatorEnumRefusalOf', () => {
  it('refuses a codec with more than one BSON type', () => {
    expect(validatorEnumRefusalOf(['int', 'long'])).toBe(
      'declares 2 BSON types; an enum needs exactly one. Use a codec with one BSON type, such as mongo/string@1.',
    );
  });

  it('refuses a codec that accepts any BSON value', () => {
    expect(validatorEnumRefusalOf([])).toBe(
      'declares 0 BSON types; an enum needs exactly one. Use a codec with one BSON type, such as mongo/string@1.',
    );
  });

  it('refuses a BSON type whose values JSON cannot hold', () => {
    expect(validatorEnumRefusalOf(['long'])).toBe(
      'stores BSON type long, which a collection validator cannot list as an enum value. Use a codec whose BSON type is string, int, double, bool, object or array.',
    );
  });

  it('accepts a BSON type whose values JSON holds', () => {
    expect(validatorEnumRefusalOf(['int'])).toBeUndefined();
  });
});

describe('validatorEnumMemberRefusalOf', () => {
  it('accepts a member stored as the JSON type of the BSON type', () => {
    expect(validatorEnumMemberRefusalOf(['int'], 3)).toBeUndefined();
  });

  it('refuses a member stored as another JSON type', () => {
    expect(validatorEnumMemberRefusalOf(['int'], '3')).toBe(
      'is stored as "3", which a collection validator cannot list as a int. A member of a int enum must be a finite number.',
    );
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'refuses a member stored as %s, which JSON cannot hold',
    (stored) => {
      expect(validatorEnumMemberRefusalOf(['double'], stored)).toBe(
        `is stored as ${stored}, which a collection validator cannot list as a double. A member of a double enum must be a finite number.`,
      );
    },
  );

  it('refuses a member stored as a bigint', () => {
    expect(validatorEnumMemberRefusalOf(['string'], 1n)).toBe(
      'is stored as 1, which a collection validator cannot list as a string. A member of a string enum must be a string.',
    );
  });

  it('refuses every member of an enum whose BSON type is refused', () => {
    expect(validatorEnumMemberRefusalOf(['long'], 3)).toBe(validatorEnumRefusalOf(['long']));
  });
});
