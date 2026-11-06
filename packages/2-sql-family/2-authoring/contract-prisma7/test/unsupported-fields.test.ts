import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  interpretSchemaText,
  interpretSchemaTextResult,
  loadFixtureSchema,
  loadFixtureTable,
} from './support';

const raw = (sql: string) => ({ dataType: 'sql/raw', codecId: 'sql/raw@1', typeParams: { sql } });

describe('an Unsupported field', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('becomes a raw column with the text as written', async () => {
    const table = await loadFixtureTable('unsupported-type', 'Post');
    expect(table.columns).toEqual({
      id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false, many: false },
      title: { dataType: 'pg/text', codecId: 'pg/text@1', nullable: false, many: false },
      search: { ...raw('tsvector'), nullable: true, many: false },
      area: {
        ...raw('circle'),
        nullable: false,
        many: false,
        default: { kind: 'function', expression: "'<(0,0),1>'::circle" },
      },
      net: { ...raw('cidr'), nullable: false, many: false },
      tags: { ...raw('text'), nullable: true, many: { elementNullable: true } },
      labels: { ...raw('text[]'), nullable: true, many: false },
      loc: { ...raw('point'), nullable: false, many: false },
    });
  });

  it('gives the model no field', async () => {
    const result = await loadFixtureSchema('unsupported-type');
    if (!result.ok) throw new Error(JSON.stringify(result.failure.diagnostics));
    const models = result.value.domain.namespaces['public']?.models ?? {};
    expect(
      Object.fromEntries(
        Object.entries(models).map(([name, model]) => [name, Object.keys(model.fields)]),
      ),
    ).toEqual({ Post: ['id', 'title'], Host: ['id'], Network: ['id'] });
  });

  it('warns for each required column with no default', async () => {
    const emitWarning = vi.spyOn(process, 'emitWarning').mockImplementation(() => {});
    await loadFixtureSchema('unsupported-type');
    expect(
      emitWarning.mock.calls
        .filter(
          ([, options]) => (options as { code?: string })?.code === 'PN_COLUMN_REQUIRED_UNMAPPED',
        )
        .map(([message]) =>
          String(message)
            .match(/^Column "(\w+)" of table "(\w+)"/)
            ?.slice(1),
        ),
    ).toEqual([
      ['net', 'Post'],
      ['loc', 'Post'],
      ['address', 'Host'],
      ['net', 'Host'],
      ['prefix', 'Network'],
    ]);
  });

  it('reads the text with its string escapes undone', () => {
    const contract = interpretSchemaText(`datasource db {
  provider = "postgresql"
}

model Post {
  id  Int                        @id
  tag Unsupported("\\"My Type\\"")?
}
`);
    expect(
      contract.storage.namespaces['public']?.entries.table?.['Post']?.columns['tag']?.typeParams,
    ).toEqual({ sql: '"My Type"' });
  });

  it('refuses text a sql literal cannot hold, through the sql/expression canonical form', () => {
    const result = interpretSchemaTextResult(`datasource db {
  provider = "postgresql"
}

model Post {
  id  Int                        @id
  tag Unsupported("tsv\\u0000ector")?
}
`);
    expect(
      result.ok ? [] : result.failure.diagnostics.map(({ code, message }) => ({ code, message })),
    ).toEqual([
      {
        code: 'PSL.PRISMA7_UNSUPPORTED_TYPE',
        message:
          'Field "Post.tag": Unsupported("tsv\\u0000ector") is not one type name: a sql literal cannot hold it, because it has a NUL character or is too large.',
      },
    ]);
  });
});
