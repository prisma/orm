import type { JsonValue } from '@internal/contract/types';
import type { ToCanonicalForm } from '@internal/framework-components/codec';
import { InternalError } from '@internal/utils/internal-error';
import { structuredError } from '@internal/utils/structured-error';
import { describe, expect, it } from 'vitest';
import { defaultInCanonicalForm } from '../src/ir/default-in-canonical-form';

const toCanonicalForm: ToCanonicalForm = (value: JsonValue) => {
  if (value === '2026-01-01T00:00:00.000Z' || value === '2026-01-01T00:00:00Z') {
    return '2026-01-01T00:00:00Z';
  }
  throw structuredError('CONTRACT.CAST_REFUSED', `${JSON.stringify(value)} is not an instant.`);
};

describe('defaultInCanonicalForm', () => {
  it('gives a value its canonical form', () => {
    expect(defaultInCanonicalForm('2026-01-01T00:00:00.000Z', toCanonicalForm, false)).toEqual({
      value: '2026-01-01T00:00:00Z',
      refusal: undefined,
      noLiteralValues: false,
    });
  });

  it('reads a Date as its ISO text first', () => {
    expect(
      defaultInCanonicalForm(new Date('2026-01-01T00:00:00.000Z'), toCanonicalForm, false),
    ).toEqual({ value: '2026-01-01T00:00:00Z', refusal: undefined, noLiteralValues: false });
  });

  it('gives each element of a list its canonical form', () => {
    expect(defaultInCanonicalForm(['2026-01-01T00:00:00.000Z'], toCanonicalForm, true)).toEqual({
      value: ['2026-01-01T00:00:00Z'],
      refusal: undefined,
      noLiteralValues: false,
    });
  });

  it('preserves null defaults and null list elements', () => {
    expect({
      scalar: defaultInCanonicalForm(null, toCanonicalForm, false),
      container: defaultInCanonicalForm(null, toCanonicalForm, true),
      elements: defaultInCanonicalForm([null, '2026-01-01T00:00:00.000Z'], toCanonicalForm, true),
    }).toEqual({
      scalar: { value: null, refusal: undefined, noLiteralValues: false },
      container: { value: null, refusal: undefined, noLiteralValues: false },
      elements: {
        value: [null, '2026-01-01T00:00:00Z'],
        refusal: undefined,
        noLiteralValues: false,
      },
    });
  });

  it('keeps a value the type refuses as it is, with the refusal message', () => {
    expect({
      scalar: defaultInCanonicalForm('2026-01-01 00:00:00', toCanonicalForm, false),
      list: defaultInCanonicalForm(['2026-01-01T00:00:00Z', 'soon'], toCanonicalForm, true),
    }).toEqual({
      scalar: {
        value: '2026-01-01 00:00:00',
        refusal: '"2026-01-01 00:00:00" is not an instant.',
        noLiteralValues: false,
      },
      list: {
        value: ['2026-01-01T00:00:00Z', 'soon'],
        refusal: '"soon" is not an instant.',
        noLiteralValues: false,
      },
    });
  });

  it('keeps a value as it is when the type has no canonical-form function', () => {
    const date = new Date('2026-01-01T00:00:00.000Z');
    expect(defaultInCanonicalForm(date, undefined, false)).toEqual({
      value: date,
      refusal: undefined,
      noLiteralValues: false,
    });
  });

  it('lets an error other than a refusal through', () => {
    const broken: ToCanonicalForm = () => {
      throw new InternalError('the range bound is not in canonical form');
    };
    expect(() => defaultInCanonicalForm('2026-01-01', broken, false)).toThrow(
      'the range bound is not in canonical form',
    );
  });
});
