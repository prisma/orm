import type { JsonValue } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import { canonicalFormOf } from '../src/shared/codec-descriptor';
import { createDataTypeLookup, dataType, dataTypeId } from '../src/shared/data-type';

const upperCase = (value: JsonValue): JsonValue => String(value).toUpperCase();
const trimmed = (value: JsonValue): JsonValue => String(value).trim();

const text = dataType('demo/text', {});
const code = dataType('demo/code', { toCanonicalForm: trimmed });
const dataTypes = createDataTypeLookup([text, code]);

describe('canonicalFormOf', () => {
  it("takes the codec's own canonical form before its data type's", () => {
    const form = canonicalFormOf({ dataType: code.id, toCanonicalForm: upperCase }, dataTypes);
    expect(form?.(' ab ')).toBe(' AB ');
  });

  it("takes the data type's canonical form for a codec that declares none", () => {
    const form = canonicalFormOf({ dataType: code.id }, dataTypes);
    expect(form?.(' ab ')).toBe('ab');
  });

  it('has none when neither the codec nor its data type declares one', () => {
    expect({
      declaredByNeither: canonicalFormOf({ dataType: text.id }, dataTypes),
      unregisteredType: canonicalFormOf({ dataType: dataTypeId('demo/gone') }, dataTypes),
    }).toEqual({ declaredByNeither: undefined, unregisteredType: undefined });
  });
});
