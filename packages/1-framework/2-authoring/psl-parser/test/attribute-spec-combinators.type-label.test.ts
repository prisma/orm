import type { DataTypeSupport } from '@internal/framework-components/authoring';
import { createDataTypeLookup, dataType } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import { bool } from '../src/attribute-spec/combinators/bool';
import { dataTypeValue } from '../src/attribute-spec/combinators/data-type-value';
import { jsonValue } from '../src/attribute-spec/combinators/json-value';
import { list } from '../src/attribute-spec/combinators/list';
import { oneOf } from '../src/attribute-spec/combinators/one-of';
import { str } from '../src/attribute-spec/combinators/str';
import { groupedTypeLabel } from '../src/attribute-spec/type-label';

const int4 = dataType('pg/int4', { read: (json) => json });
const support: DataTypeSupport = {
  entries: {},
  lookup: createDataTypeLookup([int4]),
  dataTypeOfCodec: () => undefined,
};

describe('groupedTypeLabel', () => {
  it('wraps a union of several alternatives', () => {
    expect(groupedTypeLabel(oneOf(str(), bool()))).toBe('(string | boolean)');
  });

  it('leaves a single type alone', () => {
    expect(groupedTypeLabel(str())).toBe('string');
  });

  it('leaves a union with its own label alone', () => {
    expect(groupedTypeLabel(jsonValue())).toBe('JSON value');
  });

  it('leaves a list of a union alone', () => {
    expect(groupedTypeLabel(list(oneOf(str(), bool())))).toBe('(string | boolean)[]');
  });

  it('wraps a data type value whose label lists several suggestions', () => {
    const type = dataTypeValue(int4.id, support, {
      suggestions: ['4', '7'],
      labelIsUnion: true,
    });

    expect(groupedTypeLabel(type)).toBe('(4 | 7)');
  });

  it('leaves a data type value that lists one suggestion alone', () => {
    const type = dataTypeValue(int4.id, support, {
      suggestions: ['2'],
      labelIsUnion: true,
    });

    expect(groupedTypeLabel(type)).toBe('2');
  });

  it('leaves a data type value with its own label alone', () => {
    const type = dataTypeValue(int4.id, support, { label: 'a | b' });

    expect(groupedTypeLabel(type)).toBe('a | b');
  });

  it('wraps a one-alternative union around a union', () => {
    expect(groupedTypeLabel(oneOf(oneOf(str(), bool())))).toBe('(string | boolean)');
  });
});

describe('list label', () => {
  it('wraps a union element once', () => {
    expect(list(oneOf(str(), bool())).label).toBe('(string | boolean)[]');
  });

  it('wraps a union element once inside a nested list', () => {
    expect(list(list(oneOf(str(), bool()))).label).toBe('(string | boolean)[][]');
  });

  it('does not wrap a labelled union element', () => {
    expect(list(jsonValue()).label).toBe('JSON value[]');
  });
});
