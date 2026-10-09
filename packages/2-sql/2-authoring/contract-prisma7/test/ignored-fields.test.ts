import { afterEach, describe, expect, it, vi } from 'vitest';
import { interpretSchemaText, loadFixtureSchema, loadFixtureTable } from './support';

const sourceColumns = (fk: Record<string, unknown>) =>
  (fk['source'] as { columns: unknown }).columns;

async function domainModels(caseName: string) {
  const result = await loadFixtureSchema(caseName);
  if (!result.ok) throw new Error(JSON.stringify(result.failure.diagnostics));
  return result.value.domain.namespaces['public']?.models ?? {};
}

describe('an @ignore scalar field', () => {
  it('keeps its column with its column default, and leaves the model without the field', async () => {
    const table = await loadFixtureTable('ignored-field-defaults', 'Account');
    const defaults = Object.fromEntries(
      Object.entries(table.columns).map(([name, column]) => [name, column['default'] ?? null]),
    );
    expect(defaults).toEqual({
      id: null,
      status: { kind: 'literal', value: 'active' },
      createdAt: { kind: 'function', expression: 'now()' },
      token: null,
      ref: null,
      touchedAt: null,
      seenAt: null,
      labels: null,
      day: null,
      stamp: { kind: 'function', expression: 'now()' },
    });
    expect(
      Object.keys((await domainModels('ignored-field-defaults'))['Account']?.fields ?? {}),
    ).toEqual(['id']);
  });

  it('gives the column no execution default', async () => {
    const result = await loadFixtureSchema('ignored-field-defaults');
    if (!result.ok) throw new Error(JSON.stringify(result.failure.diagnostics));
    expect(result.value.execution).toBeUndefined();
  });

  it('keeps a unique and an index over its column', async () => {
    const table = (await loadFixtureTable('ignored-field-in-index', 'Indexed')) as unknown as {
      indexes: readonly { name: string; unique?: boolean; columns: readonly string[] }[];
    };
    expect(table.indexes).toEqual([
      { name: 'Indexed_a_b_key', unique: true, columns: ['a', 'b'] },
      { name: 'Indexed_c_column_key', unique: true, columns: ['c_column'] },
      { name: 'Indexed_b_idx', unique: false, columns: ['b'] },
    ]);
  });

  it('is refused when a relation that is not @ignore joins on it', async () => {
    const codes = async (caseName: string) => {
      const result = await loadFixtureSchema(caseName);
      return result.ok ? [] : result.failure.diagnostics.map((diagnostic) => diagnostic.code);
    };
    expect({
      fields: await codes('ignored-field-in-relation'),
      references: await codes('ignored-field-in-references'),
    }).toEqual({
      fields: ['PSL.PRISMA7_IGNORED_FIELD_REFERENCED'],
      references: ['PSL.PRISMA7_IGNORED_FIELD_REFERENCED'],
    });
  });
});

describe('an @ignore relation field', () => {
  it('keeps its foreign key on the model table, and leaves the relation out of the domain', async () => {
    const table = await loadFixtureTable('ignored-relation-field', 'Post');
    const models = await domainModels('ignored-relation-field');
    expect({
      foreignKeys: table.foreignKeys.map((fk) => ({
        columns: sourceColumns(fk),
        onDelete: fk['onDelete'],
      })),
      postRelations: Object.keys(models['Post']?.relations ?? {}),
      userRelations: Object.keys(models['User']?.relations ?? {}),
    }).toEqual({
      foreignKeys: [{ columns: ['authorId'], onDelete: 'cascade' }],
      postRelations: [],
      userRelations: [],
    });
  });
});

describe('an @ignore field whose type has no Prisma 8 codec', () => {
  it('is refused', async () => {
    const result = await loadFixtureSchema('ignored-field-no-codec');
    expect(
      result.ok ? [] : result.failure.diagnostics.map((diagnostic) => diagnostic.code),
    ).toEqual(['PSL.PRISMA7_NATIVE_TYPE_UNSUPPORTED', 'PSL.PRISMA7_NATIVE_TYPE_UNSUPPORTED']);
  });
});

describe('an @@ignore model', () => {
  it('collides with another model on its table', () => {
    const schema = `datasource db {
  provider = "postgresql"
}

model Live {
  id Int @id

  @@map("shared")
}

model Legacy {
  id Int @id

  @@map("shared")
  @@ignore
}
`;
    expect(() => interpretSchemaText(schema)).toThrow(/PSL\.PRISMA7_TABLE_COLLISION/);
  });
});

describe('a required @ignore column with no database default', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('warns that every insert the ORM makes into its table fails', async () => {
    const emitWarning = vi.spyOn(process, 'emitWarning').mockImplementation(() => {});
    await loadFixtureSchema('ignored-field-defaults');
    expect(
      emitWarning.mock.calls
        .filter(
          ([, options]) => (options as { code?: string })?.code === 'PN_COLUMN_REQUIRED_UNMAPPED',
        )
        .map(([message]) => String(message).match(/^Column "(\w+)"/)?.[1]),
    ).toEqual(['token', 'touchedAt', 'day']);
  });
});
