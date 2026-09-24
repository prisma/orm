import type { AuthoringDataTypeEntry } from '@internal/framework-components/authoring';
import { structuredError } from '@internal/utils/structured-error';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { interpretPslDocumentToSqlContract as interpretPslDocumentToSqlContractInternal } from '../src/interpreter';
import { fixtureDataTypeSupport } from './fixture-data-types';
import {
  createBuiltinLikeControlMutationDefaults,
  postgresCodecLookup,
  postgresNativeScalarTypeDescriptors,
  postgresTarget,
  symbolTableInputFromParseArgs,
} from './fixtures';
import { sqlStorageFromSuccessfulSqlInterpretation } from './interpret-sql-contract-storage';

describe('interpretPslDocumentToSqlContract tagged literal defaults', () => {
  const builtinControlMutationDefaults = createBuiltinLikeControlMutationDefaults();
  /** A tag naming a data type that is not the JSON one, to exercise the other bodies a tag holds. */
  const withBoolTag: Readonly<Record<string, AuthoringDataTypeEntry>> = {
    ...fixtureDataTypeSupport.entries,
    'pg/bool': {
      written: {
        kind: 'tag',
        tag: 'bool',
        parse: (text: string) => {
          if (text === 'true' || text === 'false') return text === 'true';
          throw structuredError('CONTRACT.CAST_REFUSED', `"${text}" is not a boolean.`, {
            why: 'A boolean is written as true or false.',
            fix: 'Write true or false.',
          });
        },
      },
      print: (value) => String(value),
      documentation: 'Reads the body as a boolean.',
    },
  };
  const interpret = (fieldLine: string, entries = fixtureDataTypeSupport.entries) => {
    const document = symbolTableInputFromParseArgs({
      schema: `model Lit {\n  id Int @id\n  ${fieldLine}\n}\n`,
      sourceId: 'schema.prisma',
    });
    return interpretPslDocumentToSqlContractInternal({
      target: postgresTarget,
      codecLookup: postgresCodecLookup,
      scalarColumnDescriptors: postgresNativeScalarTypeDescriptors,
      composedExtensionContracts: new Map(),
      createNamespace: createTestSqlNamespace,
      capabilities: { sql: { scalarList: true } },
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
      authoringContributions: { dataTypes: entries },
      dataTypeLookup: fixtureDataTypeSupport.lookup,
    });
  };
  const columnDefault = (
    fieldLine: string,
    column: string,
    entries = fixtureDataTypeSupport.entries,
  ) => {
    const result = interpret(fieldLine, entries);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.failure.diagnostics));
    return sqlStorageFromSuccessfulSqlInterpretation(result.value).namespaces['public']?.entries
      .table?.['Lit']?.columns[column]?.default;
  };
  const diagnostics = (fieldLine: string, entries = fixtureDataTypeSupport.entries) => {
    const result = interpret(fieldLine, entries);
    expect(result.ok).toBe(false);
    return result.ok ? [] : result.failure.diagnostics;
  };

  const lineThreeSpan = (startColumn: number, length: number) => ({
    start: { offset: 24 + startColumn, line: 3, column: startColumn },
    end: { offset: 24 + startColumn + length, line: 3, column: startColumn + length },
  });

  it.each([
    ['backtick string', 'v String @default(sql`md5(random()::text)`)'],
    ['double-quoted string', 'v String @default(sql"md5(random()::text)")'],
    ['pg.sql tag', 'v String @default(pg.sql`md5(random()::text)`)'],
  ])('lowers the %s to a function default with the canonical body', (_name, fieldLine) => {
    expect(columnDefault(fieldLine, 'v')).toEqual({
      kind: 'function',
      expression: 'md5(random()::text)',
    });
  });

  it.each([
    [
      'a dollar-brace sequence, which PSL needs no escape for',
      `v String @default(sql\`'Home | $${'{user}'}'\`)`,
      `'Home | $${'{user}'}'`,
    ],
    [
      'a backslash before a dollar, kept as both characters',
      'v String @default(sql`\\$1`)',
      '\\$1',
    ],
  ])('lowers %s', (_name, fieldLine, expression) => {
    expect(columnDefault(fieldLine, 'v')).toEqual({ kind: 'function', expression });
  });

  it('lowers a multi-line body dedented', () => {
    expect(
      columnDefault(
        "v DateTime @default(sql`\n      (now()\n        + '00:03:00'::interval)\n    `)",
        'v',
      ),
    ).toEqual({ kind: 'function', expression: "(now()\n  + '00:03:00'::interval)" });
  });

  it('lowers an empty body with no diagnostic', () => {
    expect(columnDefault('v String @default(sql``)', 'v')).toEqual({
      kind: 'function',
      expression: '',
    });
  });

  it('lowers a tagged literal on a list column', () => {
    expect(columnDefault("tags String[] @default(sql`'{}'::text[]`)", 'tags')).toEqual({
      kind: 'function',
      expression: "'{}'::text[]",
    });
  });

  it('refuses gen_random_uuid() as a named default function; it is written sql`gen_random_uuid()`', () => {
    expect(diagnostics('v String @default(gen_random_uuid())')).toEqual([
      {
        code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
        message:
          'Expected one of: string | number | boolean | autoincrement() | now() | uuid() | cuid() | ulid() | nanoid() | json`...` | sql`...` | list of (string | number | boolean | json`...` | sql`...`)',
        sourceId: 'schema.prisma',
        span: lineThreeSpan(21, 'gen_random_uuid()'.length),
      },
    ]);
  });

  it('rejects an unregistered tag at the literal and lists the known tags', () => {
    expect(diagnostics('v String @default(sqlite.sql`x`)')).toEqual([
      {
        code: 'PSL_UNKNOWN_DEFAULT_LITERAL_TAG',
        message: 'Unknown literal tag "sqlite.sql". Known tags: json, sql, pg.sql.',
        sourceId: 'schema.prisma',
        span: lineThreeSpan(21, 'sqlite.sql`x`'.length),
      },
    ]);
  });

  it('rejects a NUL character at the literal', () => {
    expect(diagnostics('v String @default(sql`a\0b`)')).toEqual([
      {
        code: 'PSL_TAGGED_LITERAL_NUL',
        message: 'Tagged literals must not contain NUL characters.',
        sourceId: 'schema.prisma',
        span: lineThreeSpan(21, 'sql`a\0b`'.length),
      },
    ]);
  });

  it('rejects a body over 65536 bytes at the literal', () => {
    const literal = `sql\`${'a'.repeat(65537)}\``;
    expect(diagnostics(`v String @default(${literal})`)).toEqual([
      {
        code: 'PSL_TAGGED_LITERAL_TOO_LARGE',
        message: 'Tagged literal exceeds 65536 bytes.',
        sourceId: 'schema.prisma',
        span: lineThreeSpan(21, literal.length),
      },
    ]);
  });

  it('allows whitespace between the tag and the string', () => {
    expect(columnDefault('v String @default(sql `md5(random()::text)`)', 'v')).toEqual({
      kind: 'function',
      expression: 'md5(random()::text)',
    });
  });

  it('rejects a body the SQL check refuses', () => {
    expect(diagnostics('v String @default(sql`x; drop table t`)')).toEqual([
      expect.objectContaining({
        code: 'PSL_INVALID_DEFAULT_SQL',
        message:
          'Default SQL must not contain semicolons, SQL comment tokens, dollar-quoting, or subqueries.',
        sourceId: 'schema.prisma',
      }),
    ]);
  });

  it.each([
    ['sql', 'now', 'v DateTime @default(sql`now()`)'],
    ['sql', 'autoincrement', 'v Int @default(sql`autoincrement()`)'],
    ['pg.sql', 'now', 'v DateTime @default(pg.sql`now()`)'],
  ])('refuses %s`%s()`, naming the tag and the form to write', (tag, name, fieldLine) => {
    expect(diagnostics(fieldLine)).toEqual([
      expect.objectContaining({
        code: 'PSL_INVALID_DEFAULT_SQL',
        message: `Write @default(${name}()) instead of ${tag}\`${name}()\`; ${name}() is a Prisma default function, not raw SQL.`,
      }),
    ]);
  });

  it.each([
    ['NOW()', 'v DateTime @default(sql`NOW()`)'],
    ['gen_random_uuid()', 'v String @default(sql`gen_random_uuid()`)'],
    ['uuid()', 'v String @default(sql`uuid()`)'],
  ])('lowers sql`%s` verbatim', (expression, fieldLine) => {
    expect(columnDefault(fieldLine, 'v')).toEqual({ kind: 'function', expression });
  });

  it('still rejects a client-side generator on a list column', () => {
    expect(diagnostics('tags String[] @default(uuid())')).toEqual([
      expect.objectContaining({ code: 'PSL_LIST_EXECUTION_DEFAULT_UNSUPPORTED' }),
    ]);
  });

  describe('the json tag', () => {
    it('reads a JSON document as the column default', () => {
      expect(columnDefault('v Jsonb @default(json`{ "plan": "free" }`)', 'v')).toEqual({
        kind: 'literal',
        value: { plan: 'free' },
      });
    });

    it('reads json`null` as JSON null', () => {
      expect(columnDefault('v Jsonb @default(json`null`)', 'v')).toEqual({
        kind: 'literal',
        value: null,
      });
    });

    it('reads a json tag inside a list on a jsonb list column', () => {
      expect(columnDefault('v Jsonb[] @default([json`{}`, json`[1]`])', 'v')).toEqual({
        kind: 'literal',
        value: [{}, [1]],
      });
    });

    it('refuses a body that is not a JSON document', () => {
      expect(diagnostics('v Jsonb @default(json`{ plan }`)')).toEqual([
        expect.objectContaining({ code: 'PSL_INVALID_JSON_LITERAL' }),
      ]);
    });

    it('refuses a JSON document on a column whose type does not cast from one', () => {
      expect(diagnostics('v Int @default(json`1`)')).toEqual([
        expect.objectContaining({
          code: 'PSL_DEFAULT_TYPE_INCOMPATIBLE',
          message: expect.stringContaining('pg/int4 has no cast from pg/json'),
        }),
      ]);
    });
  });

  it('refuses a lowering tag as an element of a list literal, at the element', () => {
    expect(diagnostics('v Jsonb[] @default([json`{}`, sql`md5(x)`])')).toEqual([
      expect.objectContaining({
        code: 'PSL_INVALID_DEFAULT_LITERAL',
        message:
          'Literal tag "sql" produces a default of its own and cannot be an element of a list literal.',
        sourceId: 'schema.prisma',
        span: lineThreeSpan(33, 11),
      }),
    ]);
  });

  describe('a tag naming the boolean data type', () => {
    it.each([
      ['true', true],
      ['false', false],
    ])('reads the body %s', (body, value) => {
      expect(columnDefault(`v Boolean @default(bool\`${body}\`)`, 'v', withBoolTag)).toEqual({
        kind: 'literal',
        value,
      });
    });

    it.each(['TRUE', 'True', 'yes', '1', ''])('refuses the body %o', (body) => {
      expect(diagnostics(`v Boolean @default(bool\`${body}\`)`, withBoolTag)).toEqual([
        expect.objectContaining({
          code: 'PSL_INVALID_DEFAULT_LITERAL',
          message: expect.stringContaining(`"${body}" is not a boolean.`),
        }),
      ]);
    });
  });
});
