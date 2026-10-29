import type { ColumnDefault, Contract, JsonValue } from '@internal/contract/types';
import {
  type Codec,
  type CodecRef,
  codecForRef,
  type DataType,
  type DataTypeParams,
  type DataTypeValue,
  dataTypeParams,
  type TypeLookups,
} from '@internal/framework-components/codec';
import type {
  MigrationPlannerConflict,
  SchemaNodeRef,
} from '@internal/framework-components/control';
import {
  nameIsCatalogText,
  renderSqlTypeName,
  type SqlDataType,
  sqlDataTypeOfCodec,
  sqlStorageType,
  unquotedSqlBaseName,
} from '@internal/sql-contract/data-type';
import { printSqlExpressionLiteral, sqlTextsReadBack } from '@internal/sql-contract/sql-expression';
import {
  type CheckConstraint,
  type ForeignKey,
  type Index,
  type SqlStorage,
  type StorageColumn,
  StorageTable,
  type UniqueConstraint,
} from '@internal/sql-contract/types';
import { namingOf } from '@internal/sql-schema-ir/naming';
import {
  RelationalSchemaNodeKind,
  type SqlCheckConstraintIRInput,
  type SqlColumnIRInput,
  type SqlDefaultValue,
  type SqlForeignKeyIRInput,
  type SqlIndexIRInput,
  SqlSchemaIR,
  SqlTableIR,
  type SqlUniqueIRInput,
} from '@internal/sql-schema-ir/types';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { isInternalError } from '@internal/utils/internal-error';
import { isStructuredError, structuredError } from '@internal/utils/structured-error';
import { sqlFamilyError } from '../errors';

/**
 * Target-supplied hook that names a contract's expression default the way the target's introspection names the same database function, such as `now()` for `CURRENT_TIMESTAMP`, so the two compare equal. When omitted, the contract's default is the resolved default unchanged.
 */
export type DefaultResolver = (def: ColumnDefault, column: DefaultResolverColumn) => ColumnDefault;

/** The column a {@link DefaultResolver} names a default for: its type as written, and whether it is a list. */
export interface DefaultResolverColumn {
  readonly typeText: string;
  readonly many: boolean;
}

type DefaultHooks = Pick<ContractToSchemaIROptions, 'resolveDefault'>;

function convertColumn(
  name: string,
  column: StorageColumn,
  types: TypeLookups,
  hooks: DefaultHooks,
): SqlColumnIRInput {
  const dataType = sqlDataTypeOfCodec(column.codecId, types);
  const storage = sqlStorageType(dataType, types.dataTypeLookup);
  const typeText = schemaTypeText(storage, column.typeParams);
  const many = column.many !== undefined && column.many !== false;
  const rawColumnDefault = column.default ?? undefined;
  const resolvedColumnDefault =
    rawColumnDefault !== undefined && hooks.resolveDefault
      ? hooks.resolveDefault(rawColumnDefault, { typeText, many })
      : rawColumnDefault;
  return {
    name,
    typeText,
    nullable: column.nullable,
    ...ifDefined('many', many ? true : undefined),
    // The contract's default after the target's `resolveDefault` hook, so a
    // default the target's introspection names differently compares equal.
    ...ifDefined('resolvedDefault', resolvedColumnDefault),
    ...ifDefined('authoredDefault', rawColumnDefault),
    // The column's codec identity, carried the same way the query AST
    // carries `CodecRef` (TML-2456) — the migration planner's op-builders
    // resolve DDL rendering from this at plan time (Decision 5), instead of
    // reading a derivation-precomputed render payload.
    codecRef: buildColumnCodecRef(column, many ? true : undefined),
    storedType: storage,
    storedTypeParams: storage.sql.normalize(dataTypeParams(storage, column.typeParams)),
    ...ifDefined('catalogText', nameIsCatalogText(storage) ? typeText : undefined),
    ...ifDefined(
      'defaultValue',
      rawColumnDefault?.kind === 'literal' && rawColumnDefault.value instanceof Date
        ? dateDefaultValue(
            rawColumnDefault.value,
            codecForRef(types.codecLookup, buildColumnCodecRef(column, undefined)),
          )
        : contractDefaultValue(
            rawColumnDefault,
            dataType,
            dataTypeParams(dataType, column.typeParams),
            many,
          ),
    ),
    sqlExpressionLiteralFor,
  };
}

function sqlExpressionLiteralFor(text: string): string | undefined {
  return sqlTextsReadBack([text]) ? printSqlExpressionLiteral(text) : undefined;
}

/**
 * A `Date` default, which an in-memory contract can hold, as the value of the column's type the column's codec reads it as. `undefined` when the codec refuses it or no codec is registered, and the default then compares unequal to any other.
 */
function dateDefaultValue(value: Date, codec: Codec | undefined): DataTypeValue | undefined {
  if (codec === undefined) return undefined;
  try {
    return codec.toDataTypeValue(value);
  } catch (error) {
    if (isInternalError(error)) throw error;
    return undefined;
  }
}

/**
 * A literal default as a value of the column's type, read from the JSON the contract stores, element by element for a list column. A `null` is a value of a type that stores one, such as a JSON type, and SQL NULL otherwise, as DDL writes it. Loading a contract refuses a value its type does not hold, so a refusal here only means no value, and the comparison falls back to the stored JSON.
 */
function contractDefaultValue(
  columnDefault: ColumnDefault | undefined,
  type: DataType,
  params: DataTypeParams,
  many: boolean,
): SqlDefaultValue | undefined {
  if (columnDefault?.kind !== 'literal' || columnDefault.value instanceof Date) return undefined;
  const stored = columnDefault.value;
  const read = (json: JsonValue): DataTypeValue | null => {
    try {
      return type.fromContract(json, params);
    } catch (error) {
      if (isStructuredError(error) && json === null) return null;
      throw error;
    }
  };
  try {
    if (many && Array.isArray(stored)) return stored.map(read);
    return read(stored) ?? undefined;
  } catch (error) {
    if (isStructuredError(error)) return undefined;
    throw error;
  }
}

/**
 * The column's type as the database reports it, from the type it is stored as: the written name with the parameters the catalog prints for those written (`character(1)` for a bare `character`, `timestamptz` for a bare `timestamptz`), or for a type that claims a kind (an enum), its type name as stored.
 */
function schemaTypeText(
  type: SqlDataType,
  typeParams: Record<string, unknown> | undefined,
): string {
  const params = dataTypeParams(type, typeParams);
  return type.sql.claimsKind === undefined
    ? renderSqlTypeName(type, type.sql.catalogParams(params))
    : unquotedSqlBaseName(type, params);
}

/**
 * Builds the column's `CodecRef` from its codec identity — the same construction the query AST and the migration DDL renderer already use (TML-2456, TML-2918).
 */
export function buildColumnCodecRef(
  column: Pick<StorageColumn, 'codecId' | 'typeParams'>,
  many: boolean | undefined,
): CodecRef {
  return {
    codecId: column.codecId,
    ...ifDefined(
      'typeParams',
      column.typeParams !== undefined
        ? blindCast<
            JsonValue,
            'column.typeParams is JsonValue-shaped storage metadata; the narrowed (non-undefined) value lands in CodecRef.typeParams which is JsonValue'
          >(column.typeParams)
        : undefined,
    ),
    ...ifDefined('many', many),
  };
}

function convertCheck(
  check: CheckConstraint,
  tableName: string,
  tableColumns: readonly string[],
): SqlCheckConstraintIRInput {
  return {
    naming: namingOf(check.name, check.prefix),
    expression: check.expression,
    // Every column of the table: the predicate is opaque, so which columns it
    // actually names is unknowable here — the same deterministic
    // over-approximation an expression index makes.
    dependsOn: flatColumnDependsOn(tableName, tableColumns),
  };
}

function convertUnique(unique: UniqueConstraint, tableName: string): SqlUniqueIRInput {
  return {
    columns: unique.columns,
    ...ifDefined('name', unique.name),
    dependsOn: flatColumnDependsOn(tableName, unique.columns),
  };
}

function convertIndex(
  index: Index,
  tableName: string,
  tableColumns: readonly string[],
): SqlIndexIRInput {
  const base = {
    naming: namingOf(index.name, index.prefix),
    where: index.where,
    unique: index.unique,
    partial: index.where !== undefined,
    // Carried so the derived index node compares type/options against the
    // introspected side (the legacy walk read them from the contract).
    type: index.type,
    options: index.options,
    annotations: undefined,
    // An expression index's chains cover every column of its table — the
    // opaque expression is never parsed, so this deterministic
    // over-approximation keeps drops ordered without a SQL parser.
    dependsOn: flatColumnDependsOn(tableName, index.columns ?? tableColumns),
  };
  return index.expression !== undefined
    ? { ...base, expression: index.expression }
    : { ...base, columns: index.columns ?? [] };
}

/**
 * The referenced table's chain in the flat (single-schema) tree
 * `contractToSchemaIR`/`contractNamespaceToSchemaIR` build: the root
 * (`SqlSchemaIR`, fixed `'database'` id) followed by the table's own id.
 * Postgres discards this when it re-derives the FK against its own
 * multi-schema tree shape (`contractToPostgresDatabaseSchemaNode`); SQLite's
 * flat tree uses it as-is.
 */
function flatSchemaDependsOn(tableName: string): SchemaNodeRef {
  return [
    { nodeKind: RelationalSchemaNodeKind.schema, id: 'database' },
    { nodeKind: RelationalSchemaNodeKind.table, id: tableName },
  ];
}

/**
 * The chains from a table-child object (foreign key, index, unique, primary
 * key) to each of the own columns it is built on, in the flat tree. Dropping
 * a covered column auto-drops the object, so the object's drop must precede
 * the column's; the graph derives that direction from these edges.
 */
function flatColumnDependsOn(
  tableName: string,
  columns: readonly string[],
): readonly SchemaNodeRef[] {
  return columns.map((column) => [
    { nodeKind: RelationalSchemaNodeKind.schema, id: 'database' },
    { nodeKind: RelationalSchemaNodeKind.table, id: tableName },
    { nodeKind: RelationalSchemaNodeKind.column, id: `column:${column}` },
  ]);
}

/**
 * The FK's referenced-namespace identity comes from the target's namespace
 * node, not the raw namespace-id string. An unbound target namespace stamps
 * no `referencedSchema` at all — the FK node's id renders the absence as the
 * empty segment, which is what flat (single-schema) introspection produces,
 * so both diff sides' FK ids meet by construction. A bound namespace (or a
 * cross-space target whose namespace lives in another contract's storage)
 * stamps its coordinate verbatim; namespaced targets (Postgres) resolve the
 * real DDL schema downstream.
 *
 * `dependsOn` carries the referenced table (created before the FK, dropped
 * after it) plus the FK's own columns (dropped after the FK, since dropping a
 * column auto-drops the FK built on it).
 */
function convertForeignKey(fk: ForeignKey, storage: SqlStorage): SqlForeignKeyIRInput {
  const targetNamespace = storage.namespaces[fk.target.namespaceId];
  const targetIsUnbound = targetNamespace?.isUnbound === true;
  return {
    columns: fk.source.columns,
    referencedTable: fk.target.tableName,
    ...(targetIsUnbound ? {} : { referencedSchema: fk.target.namespaceId }),
    referencedColumns: fk.target.columns,
    ...ifDefined('name', fk.name),
    ...ifDefined('onDelete', fk.onDelete),
    ...ifDefined('onUpdate', fk.onUpdate),
    dependsOn: [
      flatSchemaDependsOn(fk.target.tableName),
      ...flatColumnDependsOn(fk.source.tableName, fk.source.columns),
    ],
  };
}

const COLUMN_TYPE_ERROR_CODES: ReadonlySet<string> = new Set([
  'CONTRACT.CODEC_DESCRIPTOR_MISSING',
  'CONTRACT.DATA_TYPE_UNREGISTERED',
]);

function withColumnInErrors<T>(table: string, column: string, build: () => T): T {
  try {
    return build();
  } catch (cause) {
    if (!isStructuredError(cause) || !COLUMN_TYPE_ERROR_CODES.has(cause.code)) throw cause;
    throw structuredError(cause.code, cause.message, {
      cause,
      ...ifDefined('why', cause.why),
      ...ifDefined('fix', cause.fix),
      meta: { ...cause.meta, table, column },
    });
  }
}

function convertTable(
  name: string,
  table: StorageTable,
  types: TypeLookups,
  hooks: DefaultHooks,
  storage: SqlStorage,
): SqlTableIR {
  const columns: Record<string, SqlColumnIRInput> = {};
  for (const [colName, colDef] of Object.entries(table.columns)) {
    columns[colName] = withColumnInErrors(name, colName, () =>
      convertColumn(colName, colDef, types, hooks),
    );
  }

  const checks: SqlCheckConstraintIRInput[] | undefined =
    table.checks && table.checks.length > 0
      ? table.checks.map((c) => convertCheck(c, name, Object.keys(table.columns)))
      : undefined;

  const primaryKey =
    table.primaryKey !== undefined
      ? {
          columns: table.primaryKey.columns,
          ...ifDefined('name', table.primaryKey.name),
          dependsOn: flatColumnDependsOn(name, table.primaryKey.columns),
        }
      : undefined;

  return new SqlTableIR({
    name,
    columns,
    ...ifDefined('primaryKey', primaryKey),
    // #989 persists a `constraint: false` FK's absence and its backing index as
    // discrete entities at contract construction, so every `foreignKeys[]` entry
    // is now constraint-bearing (no filter) and each FK-backing index is already
    // a `table.indexes[]` entry — it flows through `convertIndex` below, carrying
    // the object→own-column `dependsOn` edge like any other index.
    foreignKeys: table.foreignKeys.map((fk) => convertForeignKey(fk, storage)),
    uniques: table.uniques.map((u) => convertUnique(u, name)),
    indexes: table.indexes.map((i) => convertIndex(i, name, Object.keys(table.columns))),
    ...ifDefined('checks', checks),
  });
}

/**
 * Detects destructive changes between two contract storages.
 *
 * The additive-only planner silently ignores removals (tables, columns).
 * This function detects those removals so callers can report them as conflicts
 * rather than silently producing an empty plan.
 *
 * Returns an empty array if no destructive changes are found.
 */
export function detectDestructiveChanges(
  from: SqlStorage | null,
  to: SqlStorage,
): readonly MigrationPlannerConflict[] {
  if (!from) return [];

  const hasOwn = (value: object, key: string): boolean => Object.hasOwn(value, key);

  const conflicts: MigrationPlannerConflict[] = [];

  const namespaceIds = [
    ...new Set([...Object.keys(from.namespaces), ...Object.keys(to.namespaces)]),
  ].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  for (const namespaceId of namespaceIds) {
    const fromNs = from.namespaces[namespaceId];
    const toNs = to.namespaces[namespaceId];
    const fromTables = fromNs?.entries.table;
    if (!fromTables) continue;

    for (const tableName of Object.keys(fromTables)) {
      const toTableRaw = toNs?.entries.table?.[tableName];
      if (!StorageTable.is(toTableRaw)) {
        conflicts.push({
          kind: 'tableRemoved',
          summary: `Table "${tableName}" was removed`,
        });
        continue;
      }
      const toTable = toTableRaw;

      const fromTableRaw = fromTables[tableName];
      if (!StorageTable.is(fromTableRaw)) continue;
      const fromTable = fromTableRaw;

      for (const columnName of Object.keys(fromTable.columns)) {
        if (!hasOwn(toTable.columns, columnName)) {
          conflicts.push({
            kind: 'columnRemoved',
            summary: `Column "${tableName}"."${columnName}" was removed`,
          });
        }
      }
    }
  }

  return conflicts;
}

/** Each column's type is written from the data type its codec represents, found through the lookups. */
export interface ContractToSchemaIROptions extends TypeLookups {
  readonly annotationNamespace: string;
  readonly resolveDefault?: DefaultResolver;
}

/**
 * Converts the tables of a single namespace into a `SqlSchemaIR`, keyed by
 * table name within that namespace. Unlike {@link contractToSchemaIR}, which
 * flattens every namespace's tables into one bare-keyed record (and throws on a
 * cross-namespace name collision), this scopes the table iteration to one
 * namespace so the same table name can exist in two schemas.
 *
 * The full `storage` is still passed to `convertTable`, so value-set / enum /
 * type resolution that legitimately spans namespaces is unaffected. Foreign
 * keys are built purely from the FK descriptor (`fk.target`), so cross-namespace
 * FKs survive per-namespace conversion. The `annotations` block (storage-type
 * derived) is omitted here — the per-namespace tree consumer reads only the
 * per-table fields.
 */
export function contractNamespaceToSchemaIR(
  storage: SqlStorage,
  namespaceId: string,
  options: ContractToSchemaIROptions,
): SqlSchemaIR {
  if (options.annotationNamespace.length === 0) {
    throw sqlFamilyError(
      'CONTRACT.PACK_CONTRIBUTION_INVALID',
      'annotationNamespace must be a non-empty string',
      {
        why: 'The calling target pack passed an empty annotationNamespace to the contract-to-schema-IR projection.',
        fix: 'Fix the target pack to pass its non-empty annotation namespace (e.g. "pg").',
        meta: { option: 'annotationNamespace' },
      },
    );
  }
  const namespace = storage.namespaces[namespaceId];
  if (!namespace) {
    return new SqlSchemaIR({ tables: {} });
  }
  const tables: Record<string, SqlTableIR> = {};
  for (const [tableName, tableDefRaw] of Object.entries(namespace.entries.table ?? {})) {
    StorageTable.assert(tableDefRaw, `namespaces.${namespaceId}.entries.table.${tableName}`);
    tables[tableName] = convertTable(tableName, tableDefRaw, options, options, storage);
  }
  return new SqlSchemaIR({ tables });
}

/**
 * Converts a `Contract` to `SqlSchemaIR`.
 *
 * Reads `contract.storage` for tables.
 *
 * Drops codec metadata (`codecId`) since the schema IR only represents
 * structural information. Each column's type is written from the data type its codec
 * represents, with its parameters (e.g. `character` + `{ length: 36 }` → `character(36)`),
 * so the resulting IR compares correctly against the "to" contract during planning.
 *
 * Returns an empty schema IR when `contract` is `null` (new project).
 */
export function contractToSchemaIR(
  contract: Contract<SqlStorage> | null,
  options: ContractToSchemaIROptions,
): SqlSchemaIR {
  if (options.annotationNamespace.length === 0) {
    throw sqlFamilyError(
      'CONTRACT.PACK_CONTRIBUTION_INVALID',
      'annotationNamespace must be a non-empty string',
      {
        why: 'The calling target pack passed an empty annotationNamespace to the contract-to-schema-IR projection.',
        fix: 'Fix the target pack to pass its non-empty annotation namespace (e.g. "pg").',
        meta: { option: 'annotationNamespace' },
      },
    );
  }

  if (!contract) {
    return new SqlSchemaIR({ tables: {} });
  }

  const storage = contract.storage;
  const tables: Record<string, SqlTableIR> = {};
  for (const ns of Object.values(storage.namespaces)) {
    for (const [tableName, tableDefRaw] of Object.entries(ns.entries.table ?? {})) {
      StorageTable.assert(tableDefRaw, `namespaces.${ns.id}.entries.table.${tableName}`);
      const tableDef = tableDefRaw;
      if (tables[tableName] !== undefined) {
        throw sqlFamilyError(
          'CONTRACT.TABLE_AMBIGUOUS',
          `contractToSchemaIR: duplicate SQL table name "${tableName}" across namespaces (ambiguous for flat SqlSchemaIR.tables).`,
          {
            why: 'Two namespaces declare a table with the same name, which is ambiguous for the flat schema-IR table map.',
            fix: 'Rename one of the tables so every table name is unique across namespaces.',
            meta: { table: tableName },
          },
        );
      }
      tables[tableName] = convertTable(tableName, tableDef, options, options, storage);
    }
  }

  return new SqlSchemaIR({ tables });
}
