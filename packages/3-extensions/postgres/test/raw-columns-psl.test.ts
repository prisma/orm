import postgresAdapter from '@internal/adapter-postgres/control';
import postgresDriver from '@internal/driver-postgres/control';
import sql from '@internal/family-sql/control';
import { createControlStack } from '@internal/framework-components/control';
import { withSeedDiagnostics } from '@internal/psl-parser/interpret';
import { bindPslSchema, contractSourceContextFromControlStack } from '@internal/psl-parser/test';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import { sqlContextInput } from '@internal/sql-contract-psl/test';
import postgres from '@internal/target-postgres/control';
import postgresPackRef from '@internal/target-postgres/pack';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { describe, expect, it } from 'vitest';

const stack = createControlStack({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresDriver,
});

function emit(schema: string) {
  const bound = bindPslSchema(schema, {
    sourceId: 'raw-columns.psl',
    context: contractSourceContextFromControlStack(stack),
  });
  return withSeedDiagnostics(
    interpretPslDocumentToSqlContract({
      documents: bound.documents,
      sources: bound.sources,
      symbolTable: bound.symbolTable,
      binder: bound.binder,
      ...sqlContextInput(bound.context),
      target: postgresPackRef,
      createNamespace: postgresCreateNamespace,
    }),
    bound.seedDiagnostics,
  );
}

function columnsOf(result: ReturnType<typeof emit>): Record<string, unknown> {
  if (!result.ok) throw new Error(JSON.stringify(result.failure, null, 2));
  const storage = JSON.parse(JSON.stringify(result.value)).storage;
  return storage.namespaces.public.entries.table.Category.columns;
}

describe('Raw(...) in a Postgres schema', () => {
  it('declares a raw column with the text as its sql parameter', () => {
    const columns = columnsOf(
      emit(`model Category {
  id     Int @id
  search Raw("tsvector")
  area   Raw("circle") @default(sql\`'<(0,0),1>'::circle\`)
  net    Raw("cidr")?
}
`),
    );
    expect({ search: columns['search'], area: columns['area'], net: columns['net'] }).toEqual({
      search: {
        codecId: 'sql/raw@1',
        dataType: 'sql/raw',
        typeParams: { sql: 'tsvector' },
        many: false,
        nullable: false,
      },
      area: {
        codecId: 'sql/raw@1',
        dataType: 'sql/raw',
        typeParams: { sql: 'circle' },
        many: false,
        nullable: false,
        default: { kind: 'function', expression: "'<(0,0),1>'::circle" },
      },
      net: {
        codecId: 'sql/raw@1',
        dataType: 'sql/raw',
        typeParams: { sql: 'cidr' },
        many: false,
        nullable: true,
      },
    });
  });

  it('refuses a literal default, saying a raw default is a sql expression', () => {
    const result = emit(`model Category {
  id   Int @id
  area Raw("circle") @default("<(0,0),1>")
}
`);
    expect(result.ok ? [] : result.failure.diagnostics).toEqual([
      expect.objectContaining({
        code: 'PSL_VALUE_TYPE_INCOMPATIBLE',
        message: 'Field "Category.area": Expected sql`...`',
      }),
    ]);
  });
});

describe('the text of Raw(...) in a Postgres schema', () => {
  it.each([
    ['a semicolon', 'text; drop table x'],
    ['a line comment', 'text -- x'],
    ['a trailing space', 'tsvector '],
    ['a comma outside parentheses', 'text, y int4'],
  ])('is refused when it has %s', (_name, sql) => {
    const result = emit(`model Category {
  id   Int @id
  area Raw("${sql}")
}
`);
    expect(result.ok ? [] : result.failure.diagnostics.map((d) => d.message)).toEqual([
      expect.stringContaining('A raw type is one type name'),
    ]);
  });
});
