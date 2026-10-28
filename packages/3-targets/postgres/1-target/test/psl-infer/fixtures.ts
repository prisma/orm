import type { SqlPslBuildContext } from '@internal/family-sql/control';
import sqlFamilyPack from '@internal/family-sql/pack';
import {
  type ColumnTypeOf,
  inferColumnTypes,
  inferredTypeConstructors,
} from '@internal/family-sql/psl-build';
import { createDataTypeLookup } from '@internal/framework-components/codec';
import { EMPTY_GENERATOR_FUNCTIONS } from '@internal/framework-components/components';
import type { PslDocumentAst } from '@internal/framework-components/psl-ast';
import { printPsl } from '@internal/psl-printer';
import { renderSqlCatalogText, resolveWrittenSqlTypes } from '@internal/sql-contract/data-type';
import {
  type ReportedSqlType,
  SqlColumnIR,
  type SqlColumnIRInput,
  type SqlSchemaIR,
  type SqlTableIR,
} from '@internal/sql-schema-ir/types';
import {
  postgresAuthoringPslBlockDescriptors,
  postgresAuthoringTypes,
} from '../../src/core/authoring';
import { createPostgresBuiltinCodecLookup } from '../../src/core/codec-registry';
import { postgresDataTypeEntries } from '../../src/core/data-type-entries';
import { postgresDataTypes } from '../../src/core/data-types';
import { inferPostgresPslContract } from '../../src/core/psl-infer/infer-psl-contract';
import { PostgresDatabaseSchemaNode } from '../../src/core/schema-ir/postgres-database-schema-node';
import { PostgresNamespaceSchemaNode } from '../../src/core/schema-ir/postgres-namespace-schema-node';
import { PostgresNativeEnumSchemaNode } from '../../src/core/schema-ir/postgres-native-enum-schema-node';
import { PostgresTableSchemaNode } from '../../src/core/schema-ir/postgres-table-schema-node';
import { postgresScalarAndNativeTypeConstructors } from '../../src/core/type-constructors';

/** The native enums a fixture declares, by the type name a column is written with: bare or schema-qualified. */
export type FixtureEnums = ReadonlyMap<string, { readonly schema: string; readonly name: string }>;

/** `enums` keyed by bare and schema-qualified name, for enums of `schema`. */
export function fixtureEnums(schema: string, typeNames: Iterable<string>): FixtureEnums {
  return new Map(
    [...typeNames].flatMap((name) => [
      [name, { schema, name }],
      [`${schema}.${name}`, { schema, name }],
    ]),
  );
}

/**
 * The type Postgres reports for a column a fixture writes as a migration would (`int4`,
 * `varchar(255)`): the catalog text of the data type that reads it, or the enum the name declares.
 * A text no data type reads is reported as written.
 */
export function reportedFromWritten(
  typeText: string,
  enums: FixtureEnums = new Map(),
): ReportedSqlType {
  const enumType = enums.get(typeText);
  if (enumType !== undefined) {
    return { text: typeText, kind: 'enum', schema: enumType.schema, name: enumType.name };
  }
  const [resolved] = resolveWrittenSqlTypes(typeText, postgresDataTypes);
  const text =
    resolved !== undefined && resolved.dataType.sql.claimsKind === undefined
      ? renderSqlCatalogText(resolved.dataType, resolved.typeParams)
      : typeText;
  return { text, kind: undefined, schema: 'pg_catalog', name: undefined };
}

/** `column` with the type Postgres would report for it, when the fixture gives none. */
export function withReportedType(
  column: SqlColumnIRInput,
  enums: FixtureEnums = new Map(),
): SqlColumnIR {
  if (column.reportedType !== undefined) {
    return column instanceof SqlColumnIR ? column : new SqlColumnIR(column);
  }
  return new SqlColumnIR({
    ...column,
    ...(column instanceof SqlColumnIR ? nonEnumerableFieldsOf(column) : {}),
    reportedType: reportedFromWritten(column.typeText, enums),
  });
}

function nonEnumerableFieldsOf(column: SqlColumnIR): Partial<SqlColumnIRInput> {
  return Object.fromEntries(
    (['authoredDefault', 'codecRef', 'storedType', 'storedTypeParams'] as const)
      .filter((key) => column[key] !== undefined)
      .map((key) => [key, column[key]]),
  );
}

/** `columns` with the type Postgres would report for each column the fixture gives none. */
export function withReportedTypes(
  columns: Readonly<Record<string, SqlColumnIRInput>>,
  enums: FixtureEnums = new Map(),
): Record<string, SqlColumnIR> {
  return Object.fromEntries(
    Object.entries(columns).map(([name, column]) => [name, withReportedType(column, enums)]),
  );
}

/** `tree` with the type Postgres would report for each column the fixture gives none. */
export function withReportedTypesInTree(
  tree: PostgresDatabaseSchemaNode,
): PostgresDatabaseSchemaNode {
  const enums: FixtureEnums = new Map(
    Object.values(tree.namespaces).flatMap((namespace) => [
      ...fixtureEnums(
        namespace.schemaName,
        namespace.nativeEnums.map(({ typeName }) => typeName),
      ),
    ]),
  );
  return new PostgresDatabaseSchemaNode({
    ...tree,
    namespaces: Object.fromEntries(
      Object.entries(tree.namespaces).map(([id, namespace]) => [
        id,
        new PostgresNamespaceSchemaNode({
          ...namespace,
          tables: Object.fromEntries(
            Object.entries(namespace.tables).map(([name, table]) => [
              name,
              new PostgresTableSchemaNode({
                ...table,
                columns: withReportedTypes(table.columns, enums),
              }),
            ]),
          ),
        }),
      ]),
    ),
  });
}

/** {@link inferPostgresPslContract} over `tree`, each column given the type Postgres would report. */
export function inferFromFixtureTree(
  tree: PostgresDatabaseSchemaNode,
  context: SqlPslBuildContext,
  describedContracts?: Parameters<typeof inferPostgresPslContract>[2],
): Promise<PslDocumentAst> {
  return inferPostgresPslContract(withReportedTypesInTree(tree), context, describedContracts);
}

/** The types `contract infer` writes for the columns of `tables`, all read from schema `public`. */
export function inferredColumnTypesOf(
  tables: Readonly<Record<string, SqlTableIR>>,
  enums: FixtureEnums = new Map(),
): ColumnTypeOf {
  return inferColumnTypes({
    tables: Object.values(tables).map((table) => ({
      schemaName: 'public',
      tableName: table.name,
      columns: Object.values(withReportedTypes(table.columns, enums)),
    })),
    constructors: inferredTypeConstructors({
      authoringTypes: inferBuildContext.authoringContributions.type,
      codecLookup: inferBuildContext.codecLookup,
      dataTypeLookup: inferBuildContext.dataTypes.lookup,
    }),
    dataTypes: inferBuildContext.dataTypes,
    isEnumColumn: (column) => column.reportedType?.kind === 'enum',
  });
}

/**
 * Wraps a flat `{ tables, annotations? }` introspection fixture into the
 * `PostgresDatabaseSchemaNode` tree the target's inference walks. The flat
 * `annotations.pg.nativeEnums` (`{ typeName, values }` entries) becomes the
 * namespace's `nativeEnums` (one `PostgresNativeEnumSchemaNode` per entry).
 * All fixture tables live under the single `public` namespace (`contract
 * infer` introspects one live schema).
 */
export function treeFromFlat(schemaIR: SqlSchemaIR): PostgresDatabaseSchemaNode {
  const enums = readNativeEnums(schemaIR.annotations).map(
    (entry) =>
      new PostgresNativeEnumSchemaNode({
        typeName: entry.typeName,
        namespaceId: 'public',
        members: entry.values,
      }),
  );
  const tables: Record<string, PostgresTableSchemaNode> = {};
  for (const [name, table] of Object.entries(schemaIR.tables)) {
    tables[name] = new PostgresTableSchemaNode({
      name: table.name,
      columns: withReportedTypes(
        table.columns,
        fixtureEnums(
          'public',
          readNativeEnums(schemaIR.annotations).map(({ typeName }) => typeName),
        ),
      ),
      foreignKeys: table.foreignKeys,
      uniques: table.uniques,
      indexes: table.indexes,
      ...(table.primaryKey !== undefined ? { primaryKey: table.primaryKey } : {}),
      ...(table.annotations !== undefined ? { annotations: table.annotations } : {}),
      ...(table.checks !== undefined ? { checks: table.checks } : {}),
      rlsEnabled: false,
    });
  }
  return new PostgresDatabaseSchemaNode({
    namespaces: {
      public: new PostgresNamespaceSchemaNode({
        schemaName: 'public',
        tables,
        nativeEnums: enums,
      }),
    },
    roles: [],
    existingSchemas: ['public'],
    pgVersion: '',
  });
}

/**
 * The stack `contract emit` reads an inferred schema with: the type constructors the family and the
 * adapter contribute, the target's own, and the target's codecs and data types.
 */
export const inferBuildContext: SqlPslBuildContext = {
  authoringContributions: {
    type: {
      ...sqlFamilyPack.authoring.type,
      ...postgresAuthoringTypes,
      ...postgresScalarAndNativeTypeConstructors,
    },
  },
  generatorFunctions: EMPTY_GENERATOR_FUNCTIONS,
  componentIdsByGenerator: new Map(),
  codecLookup: createPostgresBuiltinCodecLookup(),
  dataTypes: {
    entries: postgresDataTypeEntries(),
    lookup: createDataTypeLookup(postgresDataTypes),
    dataTypeOfCodec: () => undefined,
  },
};

/** Infers and prints PSL from a flat introspection fixture, with the header `contract infer` writes. */
export async function printPslFromFlat(schemaIR: SqlSchemaIR): Promise<string> {
  return printPsl(await inferPostgresPslContract(treeFromFlat(schemaIR), inferBuildContext), {
    pslBlockDescriptors: postgresAuthoringPslBlockDescriptors,
    description:
      'Contract inferred from the live database schema. Edit as needed, then run `prisma contract emit`.',
  });
}

/** Infers a PSL AST from a flat introspection fixture. */
export function inferPslAstFromFlat(schemaIR: SqlSchemaIR): Promise<PslDocumentAst> {
  return inferPostgresPslContract(treeFromFlat(schemaIR), inferBuildContext);
}

function readPgAnnotationArray(
  annotations: SqlSchemaIR['annotations'],
  key: string,
): unknown[] | undefined {
  const pg = annotations?.['pg'];
  const value = pg && typeof pg === 'object' ? (pg as Record<string, unknown>)[key] : undefined;
  return Array.isArray(value) ? value : undefined;
}

interface FlatNativeEnumEntry {
  readonly typeName: string;
  readonly values: readonly string[];
}

function readNativeEnums(annotations: SqlSchemaIR['annotations']): readonly FlatNativeEnumEntry[] {
  const entries = readPgAnnotationArray(annotations, 'nativeEnums') ?? [];
  return entries.filter((entry): entry is FlatNativeEnumEntry => {
    if (typeof entry !== 'object' || entry === null) return false;
    const { typeName, values } = entry as { typeName?: unknown; values?: unknown };
    return (
      typeof typeName === 'string' &&
      Array.isArray(values) &&
      values.every((v): v is string => typeof v === 'string')
    );
  });
}
