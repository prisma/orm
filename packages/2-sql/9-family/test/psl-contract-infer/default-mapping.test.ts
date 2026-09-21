import type { JsonValue } from '@internal/contract/types';
import type { AuthoringDataTypeEntry } from '@internal/framework-components/authoring';
import type { Cast, DataType } from '@internal/framework-components/codec';
import { createDataTypeLookup, dataType } from '@internal/framework-components/codec';
import {
  createNumberClassifier,
  isNonFiniteText,
  numeralText,
  parseJsonBody,
  printJsonBody,
  signedRange,
} from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import {
  type DefaultMappingOptions,
  mapDefault,
} from '../../src/core/psl-contract-infer/default-mapping';

// Inline dialect-mapping fixture (the Postgres maps now live in the target);
// these cases exercise the neutral `mapDefault` with an injected mapping.
const injectedMapping: DefaultMappingOptions = {
  functionAttributes: { 'gen_random_uuid()': '@default(dbgenerated("gen_random_uuid()"))' },
  fallbackFunctionAttribute: (expression) => `@default(dbgenerated(${JSON.stringify(expression)}))`,
};

const unchanged: Cast = (value) => value;
const toNumeralText: Cast = (value) => (typeof value === 'number' ? numeralText(value) : value);
const toFloat: Cast = (value) => {
  if (typeof value !== 'string') return value;
  return isNonFiniteText(value) ? value : Number(value);
};

const text = dataType('pg/text', {});
const bool = dataType('pg/bool', {});
const int2 = dataType('pg/int2', {});
const int4 = dataType('pg/int4', { casts: { [int2.id]: unchanged } });
const int8 = dataType('pg/int8', {
  casts: { [int2.id]: toNumeralText, [int4.id]: toNumeralText },
});
const numeric = dataType('pg/numeric', {
  casts: { [int2.id]: toNumeralText, [int4.id]: toNumeralText, [int8.id]: unchanged },
});
const float8 = dataType('pg/float8', {
  casts: { [int2.id]: toFloat, [int4.id]: toFloat, [int8.id]: toFloat, [numeric.id]: toFloat },
});
const json = dataType('pg/json', {});
const jsonb = dataType('pg/jsonb', { casts: { [json.id]: unchanged } });
const vector = dataType('pg/vector', {
  listCast: {
    of: [int2.id, int4.id, int8.id, numeric.id],
    cast: (elements) => elements.map(Number),
  },
});
const blob = dataType('pg/bytea', {});

const types: readonly DataType[] = [
  text,
  bool,
  int2,
  int4,
  int8,
  numeric,
  float8,
  json,
  jsonb,
  vector,
  blob,
];

const classify = createNumberClassifier({
  integers: [
    { type: int2.id, form: 'number', ...signedRange(16) },
    { type: int4.id, form: 'number', ...signedRange(32) },
    { type: int8.id, form: 'text', ...signedRange(64) },
  ],
  largerWhole: { type: numeric.id, form: 'text' },
  fraction: { type: numeric.id, form: 'text' },
  words: { type: numeric.id, form: 'text' },
});

function printNumber(value: JsonValue): string {
  return typeof value === 'number' ? numeralText(value) : String(value);
}

const entries: Readonly<Record<string, AuthoringDataTypeEntry>> = {
  [text.id]: {
    written: { kind: 'plain', syntax: 'string', parse: (body) => body },
    print: (value) => String(value),
    documentation: 'Text.',
  },
  [bool.id]: {
    written: { kind: 'plain', syntax: 'boolean', parse: (body) => body === 'true' },
    print: (value) => String(value),
    documentation: 'A boolean.',
  },
  [numeric.id]: {
    written: {
      kind: 'plain',
      syntax: 'number',
      types: [int2.id, int4.id, int8.id, numeric.id],
      classify,
    },
    print: printNumber,
    documentation: 'A number.',
  },
  [json.id]: {
    written: { kind: 'tag', tag: 'json', parse: parseJsonBody },
    print: printJsonBody,
    documentation: 'A JSON document.',
  },
};

function forColumn(
  columnDataType: DataType,
  shape: { readonly list?: true } = {},
): DefaultMappingOptions {
  return {
    dataTypeEntries: entries,
    dataTypes: createDataTypeLookup(types),
    columnDataType: columnDataType.id,
    ...(shape.list === true ? { list: true } : {}),
  };
}

describe('mapDefault function defaults', () => {
  it('maps autoincrement()', () => {
    expect(mapDefault({ kind: 'function', expression: 'autoincrement()' })).toEqual({
      attribute: '@default(autoincrement())',
    });
  });

  it('maps now()', () => {
    expect(mapDefault({ kind: 'function', expression: 'now()' })).toEqual({
      attribute: '@default(now())',
    });
  });

  it('maps gen_random_uuid() when Postgres mapping is injected', () => {
    expect(
      mapDefault({ kind: 'function', expression: 'gen_random_uuid()' }, injectedMapping),
    ).toEqual({
      attribute: '@default(dbgenerated("gen_random_uuid()"))',
    });
  });

  it('maps unmapped Postgres defaults to dbgenerated when Postgres mapping is injected', () => {
    expect(mapDefault({ kind: 'function', expression: "'{}'::jsonb" }, injectedMapping)).toEqual({
      attribute: `@default(dbgenerated(${JSON.stringify("'{}'::jsonb")}))`,
    });
  });

  it('unrecognized function becomes comment', () => {
    expect(mapDefault({ kind: 'function', expression: 'custom_func()' })).toEqual({
      comment: '// Raw default: custom_func()',
    });
  });

  it('treats Postgres-specific functions as raw defaults without injected mapping', () => {
    expect(mapDefault({ kind: 'function', expression: 'gen_random_uuid()' })).toEqual({
      comment: '// Raw default: gen_random_uuid()',
    });
  });
});

describe('mapDefault prints a stored value as the literal its column takes', () => {
  it.each([
    ['text', 'anonymous', text, '@default("anonymous")'],
    ['text carrying a quote', 'he said "hi"', text, '@default("he said \\"hi\\"")'],
    ['text carrying a newline', 'line 1\nline 2', text, '@default("line 1\\nline 2")'],
    ['text a number would classify', '100', text, '@default("100")'],
    ['true', true, bool, '@default(true)'],
    ['false', false, bool, '@default(false)'],
    ['a small whole number on its own type', 100, int2, '@default(100)'],
    ['a whole number cast up to the column type', 100, int4, '@default(100)'],
    [
      'digit text past the safe integer range',
      '100000000000000099',
      int8,
      '@default(100000000000000099)',
    ],
    [
      'digit text a narrower type classifies, cast up to the column type',
      '42',
      int8,
      '@default(42)',
    ],
    ['decimal text keeping its trailing zero', '1.50', numeric, '@default(1.50)'],
    ['a float as a number', 1.5, float8, '@default(1.5)'],
    ['a float written as one of the three words', 'NaN', float8, '@default(NaN)'],
    ['Infinity on a float column', 'Infinity', float8, '@default(Infinity)'],
    ['-Infinity on a float column', '-Infinity', float8, '@default(-Infinity)'],
    [
      'a JSON document through the cast the column type declares',
      { plan: 'free', seats: 1 },
      jsonb,
      '@default(json`{"plan":"free","seats":1}`)',
    ],
    ['a JSON array', [1, 2], jsonb, '@default(json`[1,2]`)'],
    ['a JSON document on its own type', { a: 1 }, json, '@default(json`{"a":1}`)'],
  ] as [string, JsonValue, DataType, string][])('prints %s', (_name, value, column, attribute) => {
    expect(mapDefault({ kind: 'literal', value }, forColumn(column))).toEqual({ attribute });
  });

  it('prints a written list on a scalar column through the type list cast', () => {
    expect(mapDefault({ kind: 'literal', value: [0.1, 0.2, 0.3] }, forColumn(vector))).toEqual({
      attribute: '@default([0.1, 0.2, 0.3])',
    });
  });

  it('prints a list column element by element against the column type', () => {
    expect(mapDefault({ kind: 'literal', value: [1, 2] }, forColumn(int4, { list: true }))).toEqual(
      { attribute: '@default([1, 2])' },
    );
  });

  it('prints an empty list column default', () => {
    expect(mapDefault({ kind: 'literal', value: [] }, forColumn(text, { list: true }))).toEqual({
      attribute: '@default([])',
    });
  });

  it('prints a list of JSON documents on a JSON list column', () => {
    expect(
      mapDefault({ kind: 'literal', value: [{}, []] }, forColumn(jsonb, { list: true })),
    ).toEqual({ attribute: '@default([json`{}`, json`[]`])' });
  });

  it.each([
    ['a column type that casts from nothing the value classifies as', { a: 1 }, text],
    ['a number on a text column', 100, text],
    ['text on a number column', 'anonymous', numeric],
    ['a value on a column type with no authoring entry anywhere', 'AA==', blob],
    ['a whole number too wide for the column type', '100000000000000099', int4],
  ] as [string, JsonValue, DataType][])(
    'describes %s in a comment, so the caller falls back',
    (_name, value, column) => {
      expect(mapDefault({ kind: 'literal', value }, forColumn(column))).toEqual({
        comment: `// Literal default: ${JSON.stringify(value)}`,
      });
    },
  );

  it('describes a list element the column type does not take in a comment', () => {
    expect(
      mapDefault({ kind: 'literal', value: [1, 'x'] }, forColumn(int4, { list: true })),
    ).toEqual({ comment: '// Literal default: [1,"x"]' });
  });

  it('describes a literal in a comment when no data types are given at all', () => {
    expect(mapDefault({ kind: 'literal', value: 'hello' })).toEqual({
      comment: '// Literal default: "hello"',
    });
  });
});
