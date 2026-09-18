import { integerLiteralTypesUpTo } from '@internal/framework-components/codec';
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

const wholeNumbers = integerLiteralTypesUpTo('i64');
type Declarations = NonNullable<DefaultMappingOptions['literalTypes']>;

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

describe('mapDefault literal defaults', () => {
  it.each([
    ['a string', 'anonymous', ['string'], '@default("anonymous")'],
    ['a string with quotes', 'he said "hi"', ['string'], '@default("he said \\"hi\\"")'],
    ['a string with a newline', 'line 1\nline 2', ['string'], '@default("line 1\\nline 2")'],
    ['true', true, ['boolean'], '@default(true)'],
    ['false', false, ['boolean'], '@default(false)'],
    ['a small whole number', 100, wholeNumbers, '@default(100)'],
    ['digit text past 2^53', '100000000000000099', wholeNumbers, '@default(100000000000000099)'],
    ['decimal text keeping its trailing zero', '1.50', ['decimal'], '@default(1.50)'],
    ['NaN unquoted', 'NaN', ['float'], '@default(NaN)'],
    [
      'a JSON document as a json tag',
      { plan: 'free', seats: 1 },
      ['json'],
      '@default(json`{"plan":"free","seats":1}`)',
    ],
    ['a JSON array as a json tag', [1, 2], ['json'], '@default(json`[1,2]`)'],
    [
      'a list against a list declaration',
      [0.1, 0.2, 0.3],
      [{ list: ['decimal'] }],
      '@default([0.1, 0.2, 0.3])',
    ],
  ] as [string, never, Declarations, string][])(
    'writes %s',
    (_name, value, literalTypes, attribute) => {
      expect(mapDefault({ kind: 'literal', value }, { literalTypes })).toEqual({ attribute });
    },
  );

  it('writes a list column element by element against the scalar declarations', () => {
    expect(
      mapDefault({ kind: 'literal', value: [1, 2] }, { literalTypes: wholeNumbers, list: true }),
    ).toEqual({ attribute: '@default([1, 2])' });
  });

  it('writes an empty list column default', () => {
    expect(
      mapDefault({ kind: 'literal', value: [] }, { literalTypes: ['string'], list: true }),
    ).toEqual({ attribute: '@default([])' });
  });

  it('writes a list of json tags on a json list column', () => {
    expect(
      mapDefault({ kind: 'literal', value: [{}, []] }, { literalTypes: ['json'], list: true }),
    ).toEqual({ attribute: '@default([json`{}`, json`[]`])' });
  });

  it.each([
    ['a codec that names no literal type', 'anonymous', []],
    ['a value no named type writes', { a: 1 }, ['string']],
    ['a list element no named type writes', ['a', 1], ['string']],
    ['a list value on a codec naming only scalars', [1, 2], wholeNumbers],
  ] as [string, never, Declarations][])(
    'describes %s in a comment, so the caller falls back',
    (_name, value, literalTypes) => {
      const isList = _name.includes('list element');
      expect(mapDefault({ kind: 'literal', value }, { literalTypes, list: isList })).toEqual({
        comment: `// Literal default: ${JSON.stringify(value)}`,
      });
    },
  );

  it('describes a literal in a comment when no literal types are given at all', () => {
    expect(mapDefault({ kind: 'literal', value: 'hello' })).toEqual({
      comment: '// Literal default: "hello"',
    });
  });
});
