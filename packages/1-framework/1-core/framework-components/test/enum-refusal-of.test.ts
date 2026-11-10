import { describe, expect, it } from 'vitest';
import { enumRefusalOf } from '../src/shared/codec-descriptor';

describe('enumRefusalOf', () => {
  it('lets an enum use a codec that declares equality and gives no reason against it', () => {
    expect(enumRefusalOf({ traits: ['equality', 'order'] })).toBeUndefined();
  });

  it('refuses a codec that does not declare equality, saying so', () => {
    expect(enumRefusalOf({ traits: ['order'] })).toBe(
      'The codec does not declare the equality trait, so no value can be compared with a member. Use a codec that declares it.',
    );
  });

  it("quotes the codec's own reason before the missing equality trait", () => {
    expect({
      withEquality: enumRefusalOf({
        traits: ['equality'],
        enumRefusal: 'Values read back differ.',
      }),
      withoutEquality: enumRefusalOf({ traits: [], enumRefusal: 'Values read back differ.' }),
    }).toEqual({
      withEquality: 'Values read back differ.',
      withoutEquality: 'Values read back differ.',
    });
  });
});
