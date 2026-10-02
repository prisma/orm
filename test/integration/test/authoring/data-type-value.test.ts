import postgresAdapter from '@internal/adapter-postgres/control';
import sqliteAdapter from '@internal/adapter-sqlite/control';
import sql from '@internal/family-sql/control';
import { dataTypeId } from '@internal/framework-components/codec';
import {
  assembleAuthoringContributions,
  createControlStack,
} from '@internal/framework-components/control';
import {
  buildSymbolTable,
  createBinder,
  dataTypeValue,
  EMPTY_DATA_TYPES,
} from '@internal/psl-parser';
import { FieldAttributeAst, parse, SyntaxNode } from '@internal/psl-parser/syntax';
import postgres from '@internal/target-postgres/control';
import sqlite from '@internal/target-sqlite/control';
import { notOk, ok } from '@internal/utils/result';
import { describe, expect, it } from 'vitest';

const PREFIX = '  id Int @id @x(';

function parseArgument(source: string) {
  const { document, sources } = parse(`model M {\n${PREFIX}${source})\n}\n`, 'schema.prisma');
  const { symbolTable } = buildSymbolTable({ documents: [document], sources });
  const binder = createBinder({
    sources,
    symbolTable,
    context: {
      authoringContributions: assembleAuthoringContributions([]),
      controlMutationDefaults: { defaultFunctionRegistry: new Map() },
      dataTypes: EMPTY_DATA_TYPES,
    },
  }).binder;
  const attribute = [...document.syntax.descendants()]
    .map((element) => (element instanceof SyntaxNode ? FieldAttributeAst.cast(element) : undefined))
    .find((found) => found?.name()?.isSimpleName('x'));
  const argument = [...(attribute?.argList()?.args() ?? [])][0]?.value();
  if (argument === undefined) throw new Error(`expected an argument in ${source}`);
  return { argument, ctx: { sources, symbols: symbolTable, binder } };
}

function span(source: string) {
  return {
    start: { offset: 10 + PREFIX.length, line: 2, column: PREFIX.length + 1 },
    end: {
      offset: 10 + PREFIX.length + source.length,
      line: 2,
      column: PREFIX.length + 1 + source.length,
    },
  };
}

function refusal(source: string, code: string, message: string) {
  return notOk([
    {
      code,
      message,
      filename: 'schema.prisma',
      range: {
        start: { line: 1, character: PREFIX.length },
        end: { line: 1, character: PREFIX.length + source.length },
      },
    },
  ]);
}

describe.each([
  {
    name: 'Postgres',
    stack: createControlStack({ family: sql, target: postgres, adapter: postgresAdapter }),
    integer: 'pg/int4',
    small: 'pg/int2',
    text: 'pg/text',
  },
  {
    name: 'SQLite',
    stack: createControlStack({ family: sql, target: sqlite, adapter: sqliteAdapter }),
    integer: 'sqlite/integer',
    small: 'sqlite/integer',
    text: 'sqlite/text',
  },
])('dataTypeValue on the assembled $name stack', ({ stack, integer, small, text }) => {
  const read = (type: string, source: string) => {
    const { argument, ctx } = parseArgument(source);
    return dataTypeValue(dataTypeId(type), stack.dataTypes).parse(argument, ctx);
  };

  it('takes a number for the integer type', () => {
    expect(read(integer, '8')).toEqual(ok({ type: integer, value: 8, span: span('8') }));
  });

  it('refuses a quoted string for the integer type', () => {
    expect(read(integer, '"8"')).toEqual(
      refusal(
        '"8"',
        'PSL_VALUE_TYPE_INCOMPATIBLE',
        `${integer} has no cast from ${text}; write a number`,
      ),
    );
  });

  it('refuses a sql literal for the integer type', () => {
    expect(read(integer, 'sql`x`')).toEqual(
      refusal(
        'sql`x`',
        'PSL_VALUE_TYPE_INCOMPATIBLE',
        `${integer} has no cast from sql/expression; write a number`,
      ),
    );
  });

  it('refuses a number for sql/expression', () => {
    expect(read('sql/expression', '8')).toEqual(
      refusal(
        '8',
        'PSL_VALUE_TYPE_INCOMPATIBLE',
        `sql/expression has no cast from ${small}; write sql\`...\``,
      ),
    );
  });

  it('refuses a quoted string for sql/expression with the rewrite', () => {
    expect(read('sql/expression', '"8"')).toEqual(
      refusal(
        '"8"',
        'PSL_VALUE_TYPE_INCOMPATIBLE',
        `sql/expression has no cast from ${text}; write it as sql\`8\``,
      ),
    );
  });

  it('takes a sql literal for sql/expression', () => {
    expect(read('sql/expression', 'sql`x`')).toEqual(
      ok({ type: 'sql/expression', value: 'x', span: span('sql`x`') }),
    );
  });
});
