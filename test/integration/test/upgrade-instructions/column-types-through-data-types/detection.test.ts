import { describe, expect, it } from 'vitest';
import { detectionPatterns } from '../guide-detections';

const GUIDE_PATHS = {
  app: 'skills/prisma-8/upgrading/app/upgrades/8.0.0-rc.18-to-8.0.0-rc.19/instructions.md',
  extension:
    'skills/prisma-8/upgrading/extension/upgrades/8.0.0-rc.18-to-8.0.0-rc.19/instructions.md',
} as const;

function detectionOf(audience: 'app' | 'extension', id: string): readonly RegExp[] {
  return detectionPatterns(GUIDE_PATHS[audience], id);
}

function detects(audience: 'app' | 'extension', id: string, content: string): boolean {
  return detectionOf(audience, id).some((pattern) => pattern.test(content));
}

describe('extension detection', () => {
  it.each([
    [
      'type-lookups-one-framework-type',
      'function storageTypeOf(codecId: string, lookups: SqlTypeLookups) {}',
      'const lookups = testSqlTypeLookups();',
    ],
    [
      'type-lookups-one-framework-type',
      'function f(lookups: MongoTypeLookups) {}',
      'const mongoTypeLookups = {};',
    ],
    [
      'type-name-normalisers-removed',
      'normalizeSchemaNativeType(column.type)',
      'normalizeSchemaNativeTypes(column.type)',
    ],
    [
      'type-name-normalisers-removed',
      'normalizeSqliteNativeType(column.type)',
      'readSqliteDefault(raw, type)',
    ],
    [
      'introspected-type-text',
      'const { nativeType, many } = introspectedNativeType(row);',
      'const { typeText, many } = introspectedTypeText(row);',
    ],
    [
      'introspected-type-text',
      'const row: CatalogColumnType = { dataType: "text" };',
      'const row: CatalogColumn = { dataType: "text" };',
    ],
    [
      'schema-ir-column-type-text',
      "new SqlColumnIR({ name: 'id', nativeType: 'int4', nullable: false });",
      "new SqlColumnIR({ name: 'id', typeText: 'int4', nullable: false });",
    ],
    [
      'schema-ir-column-type-text',
      'column.resolvedNativeType === other.resolvedNativeType',
      'column.typeText === other.typeText',
    ],
    [
      'schema-ir-column-type-text',
      "import type { SqlTableIR } from '@prisma/orm-family-sql/schema-ir/types';\nconst types = Object.values(table.columns).map((column) => column.nativeType);",
      "import type { SqlTableIR } from '@prisma/orm-family-sql/schema-ir/types';\nconst types = Object.values(table.columns).map((column) => column.typeText);",
    ],
    [
      'default-resolver-takes-the-column',
      'parsePostgresDefault(raw, "text[]")',
      'readPostgresDefault(raw, true)',
    ],
    [
      'default-resolver-takes-the-column',
      "import { parseSqliteDefault } from '@prisma/orm-sqlite/adapter/control';",
      'readSqliteDefault(raw, column.typeText)',
    ],
    [
      'default-resolver-takes-the-column',
      'class MyAdapter implements SqlControlAdapter {\n  readonly normalizeDefault = parseMyDefault;\n}',
      'class MyAdapter implements SqlControlAdapter {\n  readonly normalizeDefaults = true;\n}',
    ],
    [
      'default-resolver-takes-the-column',
      'const resolve: DefaultResolver = (def, nativeType) => def;',
      'const resolve: DefaultResolver = (def, column) => read(def, column.many);',
    ],
    [
      'alter-type-postcheck-by-data-type',
      "const text = buildExpectedFormatType({ codecId: 'pg/int4@1' }, types);",
      "const check = alterTypeCheck('int4', dataTypes, where);",
    ],
    [
      'alter-type-postcheck-by-data-type',
      "alterTypeCheckText('int4', dataTypes, where)",
      "alterTypeCheck('int4', dataTypes, where)",
    ],
    [
      'resolved-sql-type-carries-the-data-type',
      'const resolved = resolveReportedSqlType(reported, dataTypes);\nlookup.get(resolved.dataType);',
      'const resolved = resolveReportedSqlType(reported, dataTypes);\nlookup.get(resolved.dataType.id);',
    ],
    [
      'resolved-sql-type-carries-the-data-type',
      'const [first] = resolveWrittenSqlTypes(text, dataTypes);\nif (first?.dataType === "pg/int4") {}',
      'const [first] = resolveWrittenSqlTypes(text, dataTypes);\nif (first?.dataType.id === "pg/int4") {}',
    ],
    [
      'control-adapters-take-declared-data-types',
      'new PostgresControlAdapter(createPostgresBuiltinCodecLookup(), createPostgresBuiltinDataTypeLookup())',
      'postgresAdapterDescriptor.create(stack)',
    ],
    [
      'control-adapters-take-declared-data-types',
      'const adapter = new SqliteControlAdapter(codecRegistry);',
      'const adapter = sqliteAdapterDescriptor.create(stack);',
    ],
  ])('%s finds the old use and skips the new one', (id, before, after) => {
    expect({
      before: detects('extension', id, before),
      after: detects('extension', id, after),
    }).toEqual({ before: true, after: false });
  });

  it('skips nativeType in a file that names no schema IR column, such as a Prisma 7 type table', () => {
    expect(
      detects(
        'extension',
        'schema-ir-column-type-text',
        "const map = { nativeTypes: { VarChar: { nativeType: 'varchar' } } };",
      ),
    ).toBe(false);
  });
});

describe('app detection', () => {
  it('finds code that reads nativeType from a CONTRACT.DEFAULT_INVALID error, and skips typeText', () => {
    const reads = (key: string) =>
      detects(
        'app',
        'default-invalid-meta-type-text',
        `if (error.code === 'CONTRACT.DEFAULT_INVALID') console.log(error.meta.${key});`,
      );
    expect({ nativeType: reads('nativeType'), typeText: reads('typeText') }).toEqual({
      nativeType: true,
      typeText: false,
    });
  });

  it('finds a script that reads nativeType from db schema --json', () => {
    expect(
      detects(
        'app',
        'db-schema-json-names-type-text',
        "prisma db schema --json | jq '.schema.tables[].columns[].nativeType'",
      ),
    ).toBe(true);
  });

  it('skips a script that reads typeText, and nativeType unrelated to db schema', () => {
    expect({
      typeText: detects(
        'app',
        'db-schema-json-names-type-text',
        "prisma db schema --json | jq '.schema.tables[].columns[].typeText'",
      ),
      unrelated: detects('app', 'db-schema-json-names-type-text', 'const nativeType = "int4";'),
    }).toEqual({ typeText: false, unrelated: false });
  });
});
