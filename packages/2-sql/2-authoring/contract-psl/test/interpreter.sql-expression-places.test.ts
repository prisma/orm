import type { SqlStorage } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { fixtureDataTypeSupport } from './fixture-data-types';
import {
  createBuiltinLikeControlMutationDefaults,
  interpretSqlContract,
  postgresScalarTypeDescriptors,
  postgresTarget,
} from './fixtures';

function interpret(schema: string) {
  return interpretSqlContract(schema, {
    target: postgresTarget,
    scalarColumnDescriptors: postgresScalarTypeDescriptors,
    composedExtensionContracts: new Map(),
    controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
    createNamespace: createTestSqlNamespace,
    dataTypes: fixtureDataTypeSupport,
    capabilities: { sql: { scalarList: true, checkConstraint: true } },
  });
}

function schemaWith(attribute: string): string {
  return `model Post {\n  id    Int     @id\n  title String\n  ${attribute}\n}\n`;
}

function positionAt(text: string, offset: number) {
  const before = text.slice(0, offset);
  const line = before.split('\n').length;
  return { offset, line, column: offset - before.lastIndexOf('\n') };
}

function spanOf(text: string, needle: string) {
  const start = text.indexOf(needle);
  if (start === -1) throw new Error(`"${needle}" is not in the schema`);
  return { start: positionAt(text, start), end: positionAt(text, start + needle.length) };
}

function postTable(schema: string) {
  const result = interpret(schema);
  if (!result.ok) throw new Error(JSON.stringify(result.failure.diagnostics));
  const storage = result.value.storage as unknown as SqlStorage;
  const table = storage.namespaces['public']?.entries.table?.['Post'];
  if (table === undefined) throw new Error('expected the Post table');
  return table;
}

function diagnosticsOf(schema: string) {
  const result = interpret(schema);
  if (result.ok) throw new Error('expected diagnostics');
  return result.failure.diagnostics;
}

const MULTI_LINE = 'sql`\n    lower(title)\n      AND id > 0\n  `';

const places = [
  {
    place: '@@index(where:)',
    attribute: (value: string) => `@@index([title], where: ${value})`,
    read: (schema: string) => postTable(schema).indexes?.[0]?.where,
  },
  {
    place: '@@index(expression:)',
    attribute: (value: string) => `@@index(expression: ${value}, name: "post_title_expr")`,
    read: (schema: string) => postTable(schema).indexes?.[0]?.expression,
  },
  {
    place: '@@check(expression:)',
    attribute: (value: string) => `@@check(expression: ${value}, name: "post_title_check")`,
    read: (schema: string) => postTable(schema).checks?.[0]?.expression,
  },
] as const;

describe.each(places)('$place', ({ attribute, read }) => {
  it('lowers a single-line sql literal to its text', () => {
    expect(read(schemaWith(attribute('sql`"title" <> \'\'`')))).toBe(`"title" <> ''`);
  });

  it('lowers a multi-line sql literal to its canonical text', () => {
    expect(read(schemaWith(attribute(MULTI_LINE)))).toBe('lower(title)\n  AND id > 0');
  });

  it.each([
    [
      '"(title IS NULL)"',
      'PSL_VALUE_TYPE_INCOMPATIBLE',
      'sql/expression has no cast from pg/text; write it as sql`(title IS NULL)`',
    ],
    [
      '42',
      'PSL_VALUE_TYPE_INCOMPATIBLE',
      'sql/expression has no cast from pg/int2; write sql`...`',
    ],
    [
      'true',
      'PSL_VALUE_TYPE_INCOMPATIBLE',
      'sql/expression has no cast from pg/bool; write sql`...`',
    ],
    ['archived', 'PSL_INVALID_ATTRIBUTE_SYNTAX', 'Expected sql`...`, got an identifier'],
    [
      'pg.sql`x`',
      'PSL_UNKNOWN_LITERAL_TAG',
      'Unknown literal tag "pg.sql". Known tags: sql, json.',
    ],
  ])('refuses %s at the value', (value, code, message) => {
    const schema = schemaWith(attribute(value));
    expect(diagnosticsOf(schema)).toEqual([
      { code, message, sourceId: 'schema.prisma', span: spanOf(schema, value) },
    ]);
  });
});

describe('@@check(expression:) with an empty sql literal', () => {
  it('reports PSL_CHECK_EXPRESSION_EMPTY', () => {
    const attribute = '@@check(expression: sql``, name: "post_empty")';
    const schema = schemaWith(attribute);
    expect(diagnosticsOf(schema)).toEqual([
      {
        code: 'PSL_CHECK_EXPRESSION_EMPTY',
        message: '`@@check` expression must not be empty — an empty predicate is not a constraint',
        sourceId: 'schema.prisma',
        span: spanOf(schema, attribute),
      },
    ]);
  });
});
