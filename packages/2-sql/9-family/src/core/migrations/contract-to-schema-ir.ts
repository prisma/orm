import type { ColumnDefault, Contract, JsonValue } from '@internal/contract/types';
import type { CodecRef } from '@internal/framework-components/codec';
import type {
  MigrationPlannerConflict,
  SchemaNodeRef,
} from '@internal/framework-components/control';
import {
  type CheckConstraint,
  type ForeignKey,
  type Index,
  isStorageTypeInstance,
  type SqlStorage,
  type StorageColumn,
  StorageTable,
  type StorageTypeInstance,
  type UniqueConstraint,
} from '@internal/sql-contract/types';
import { namingOf } from '@internal/sql-schema-ir/naming';
import {
  RelationalSchemaNodeKind,
  type SqlAnnotations,
  type SqlCheckConstraintIRInput,
  type SqlColumnIRInput,
  type SqlForeignKeyIRInput,
  type SqlIndexIRInput,
  SqlSchemaIR,
  SqlTableIR,
  type SqlUniqueIRInput,
} from '@internal/sql-schema-ir/types';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import { sqlFamilyError } from '../errors';

/**
 * Target-specific callback that expands a column's base `nativeType` and optional
 * `typeParams` into the fully-qualified type string used by the database
 * (e.g. `character` + `{ length: 36 }` → `character(36)`).
 *
 * This lives in the family layer as a callback rather than importing a concrete
 * implementation because each target (Postgres, MySQL, SQLite, …) has its own
 * parameterization syntax. The target wires its expander when calling
 * `contractToSchemaIR`, keeping the family layer target-agnostic.
 */
export type NativeTypeExpander = (input: {
  readonly nativeType: string;
  readonly codecId?: string;
  readonly typeParams?: Record<string, unknown>;
}) => string;

/**
 * Target-specific callback that renders a `ColumnDefault` into the raw SQL literal
 * string stored in `SqlColumnIR.default`.
 *
 * Default value serialization is target-specific (quoting, casting, type syntax vary
 * between Postgres, MySQL, SQLite, …). This callback follows the same IoC pattern as
 * `NativeTypeExpander`: the target provides its renderer when calling
 * `contractToSchemaIR`, keeping the family layer target-agnostic.
 */
export type DefaultRenderer = (def: ColumnDefault, column: StorageColumn) => string;

/**
 * Target-supplied hook (same IoC seam as `NativeTypeExpander`/`DefaultRenderer`)
 * that normalizes a contract-declared `ColumnDefault` into the resolved shape
 * the target's introspection parses from the live database — e.g. a
 * sql`'{}'::jsonb` raw default and the literal Postgres reports
 * are the same value in different shapes, and `resolvedDefaultsEqual`
 * compares `kind` before content. When omitted, the contract's raw default
 * is the resolved default unchanged.
 */
export type DefaultResolver = (def: ColumnDefault, resolvedNativeType: string) => ColumnDefault;

/**
 * Target-supplied callback that resolves a contract namespace to the live
 * database schema its enums are stored under.
 *
 * The projected enum annotations are nested by schema
 * (`storageTypes[schema][nativeType]`) so two namespaces holding an enum with
 * the same native type resolve to distinct live-database types. Mapping a
 * namespace to its DDL schema is target-specific (Postgres schemas;
 * SQLite/MySQL differ), so the target injects it here rather than the family
 * importing a concrete `ddlSchemaName`. This keeps the family layer
 * target-agnostic while the projection nests under the same schema the
 * target's read side (`readExistingEnumValues`) looks up.
 */
export type EnumNamespaceSchemaResolver = (storage: SqlStorage, namespaceId: string) => string;

function convertColumn(
  name: string,
  column: StorageColumn,
  storageTypes: ResolvedStorageTypes,
  expandNativeType: NativeTypeExpander | undefined,
  renderDefault: DefaultRenderer | undefined,
  resolveDefault: DefaultResolver | undefined,
): SqlColumnIRInput {
  // Resolve `typeRef` so columns that delegate their `nativeType`/`codecId`/
  // `typeParams` to a named `storage.types` entry expand the same way as
  // columns that inline those fields. Without this resolution, a
  // `typeRef`-based column like `post.embedding → Embedding1536` would
  // render as the bare `"vector"` (dropping the `length` parameter), while
  // `verify-sql-schema.ts`'s `renderExpectedNativeType` resolves the
  // typeRef and produces `"vector(1536)"` — making diffs on the same
  // contract falsely report a `type_mismatch`.
  const resolved = resolveColumnTypeMetadata(column, storageTypes);
  const baseNativeType = expandNativeType
    ? expandNativeType({
        nativeType: resolved.nativeType,
        codecId: resolved.codecId,
        ...ifDefined('typeParams', resolved.typeParams),
      })
    : resolved.nativeType;
  // `many: true` columns keep `nativeType` as the bare element type (matching
  // how the introspected/"actual" side reports it — see the postgres control
  // adapter's own `many`-stripping normalization) and carry the array-ness in
  // the separate `many` field instead of baking `[]` into `nativeType`.
  // Baking it in here (`"text[]"`) made every `@@` list-typed column
  // permanently mismatch against a live introspected column reporting
  // `{ nativeType: "text", many: true }`, regardless of whether the two are
  // otherwise identical — `db verify` reported every such column
  // `not-equal`. `resolvedNativeType` still carries the full `"text[]"`
  // form: it is the side both this and the introspected column already
  // agree on as the comparable "expanded" type.
  const nativeType = baseNativeType;
  const resolvedNativeType = column.many ? `${baseNativeType}[]` : baseNativeType;
  const rawColumnDefault = column.default ?? undefined;
  const resolvedColumnDefault =
    rawColumnDefault !== undefined && resolveDefault
      ? resolveDefault(rawColumnDefault, resolvedNativeType)
      : rawColumnDefault;
  return {
    name,
    nativeType,
    nullable: column.nullable,
    ...ifDefined('many', column.many),
    ...ifDefined(
      'default',
      column.default != null && renderDefault ? renderDefault(column.default, column) : undefined,
    ),
    // Contract-derived columns are resolved by construction: the computed
    // full native type doubles as the resolved value. The contract's raw
    // structured default becomes the resolved default after passing through
    // the target's `resolveDefault` hook (when supplied), so a default the
    // target's introspection side would normalize differently (e.g. a
    // raw sql`...` default whose body is a literal) compares
    // equal instead of drifting on `kind` alone.
    resolvedNativeType,
    ...ifDefined('resolvedDefault', resolvedColumnDefault),
    ...ifDefined('authoredDefault', rawColumnDefault),
    // The column's codec identity, carried the same way the query AST
    // carries `CodecRef` (TML-2456) — the migration planner's op-builders
    // resolve DDL rendering from this at plan time (Decision 5), instead of
    // reading a derivation-precomputed render payload.
    codecRef: buildColumnCodecRef(resolved, column.many),
    codecBaseNativeType: resolved.nativeType,
    ...(column.typeRef !== undefined ? { codecNamedType: true } : {}),
  };
}

/**
 * Builds the column's `CodecRef` from its resolved (post-`typeRef`) codec
 * identity — the same construction the query AST and the migration DDL
 * renderer already use (TML-2456, TML-2918).
 */
function buildColumnCodecRef(
  resolved: Pick<StorageColumn, 'codecId' | 'nativeType' | 'typeParams'>,
  many: boolean | undefined,
): CodecRef {
  return {
    codecId: resolved.codecId,
    ...ifDefined(
      'typeParams',
      resolved.typeParams !== undefined
        ? blindCast<
            JsonValue,
            'resolved.typeParams is JsonValue-shaped storage metadata; the narrowed (non-undefined) value lands in CodecRef.typeParams which is JsonValue'
          >(resolved.typeParams)
        : undefined,
    ),
    ...ifDefined('many', many),
  };
}

type ResolvedStorageTypes = Readonly<Record<string, StorageTypeInstance>>;

function resolveColumnTypeMetadata(
  column: StorageColumn,
  storageTypes: ResolvedStorageTypes,
): Pick<StorageColumn, 'codecId' | 'nativeType' | 'typeParams'> {
  if (!column.typeRef) {
    return column;
  }
  const referenced = storageTypes[column.typeRef];
  if (!referenced) {
    throw sqlFamilyError(
      'CONTRACT.TYPE_UNKNOWN',
      `Column references storage type "${column.typeRef}" but it is not defined in storage.types.`,
      {
        why: 'The column typeRef does not resolve to any entry in the contract storage.types map.',
        fix: 'Regenerate the contract from its authoring source; do not hand-edit contract JSON.',
        meta: { typeRef: column.typeRef },
      },
    );
  }
  if (isStorageTypeInstance(referenced)) {
    return {
      codecId: referenced.codecId,
      nativeType: referenced.nativeType,
      typeParams: referenced.typeParams,
    };
  }
  throw new InternalError(
    `Storage type "${column.typeRef}" has an unknown polymorphic kind; expected a codec-typed StorageTypeInstance.`,
  );
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

function convertTable(
  name: string,
  table: StorageTable,
  storageTypes: ResolvedStorageTypes,
  expandNativeType: NativeTypeExpander | undefined,
  renderDefault: DefaultRenderer | undefined,
  resolveDefault: DefaultResolver | undefined,
  storage: SqlStorage,
): SqlTableIR {
  const columns: Record<string, SqlColumnIRInput> = {};
  for (const [colName, colDef] of Object.entries(table.columns)) {
    columns[colName] = convertColumn(
      colName,
      colDef,
      storageTypes,
      expandNativeType,
      renderDefault,
      resolveDefault,
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

export interface ContractToSchemaIROptions {
  readonly annotationNamespace: string;
  readonly expandNativeType?: NativeTypeExpander;
  readonly renderDefault?: DefaultRenderer;
  readonly resolveDefault?: DefaultResolver;
  /**
   * Target-supplied resolver mapping a namespace to the live database schema
   * its enums are stored under. When provided (Postgres), namespace-scoped
   * enums are nested by that schema in `enumTypes` so the projection matches
   * the target's `readExistingEnumValues` lookup. Targets without
   * schema-scoped enum storage (SQLite) omit it; enums are absent there.
   */
  readonly resolveEnumNamespaceSchema?: EnumNamespaceSchemaResolver;
}

/**
 * Converts a `Contract` to `SqlSchemaIR`.
 *
 * Reads `contract.storage` for tables and `contract.storage.types` for type
 * annotations. Storage-type annotations are written under
 * `options.annotationNamespace`.
 *
 * Drops codec metadata (`codecId`, `typeRef`) since the schema IR only represents
 * structural information. When `expandNativeType` is provided, parameterized types
 * are expanded (e.g. `character` + `{ length: 36 }` → `character(36)`) so the
 * resulting IR compares correctly against the "to" contract during planning.
 *
 * Returns an empty schema IR when `contract` is `null` (new project).
 */
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
  const storageTypes: ResolvedStorageTypes = { ...(storage.types ?? {}) };
  const tables: Record<string, SqlTableIR> = {};
  for (const [tableName, tableDefRaw] of Object.entries(namespace.entries.table ?? {})) {
    StorageTable.assert(tableDefRaw, `namespaces.${namespaceId}.entries.table.${tableName}`);
    tables[tableName] = convertTable(
      tableName,
      tableDefRaw,
      storageTypes,
      options.expandNativeType,
      options.renderDefault,
      options.resolveDefault,
      storage,
    );
  }
  return new SqlSchemaIR({ tables });
}

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
  const storageTypes: ResolvedStorageTypes = { ...(storage.types ?? {}) };
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
      tables[tableName] = convertTable(
        tableName,
        tableDef,
        storageTypes,
        options.expandNativeType,
        options.renderDefault,
        options.resolveDefault,
        storage,
      );
    }
  }

  const annotations = deriveAnnotations(
    storage,
    options.annotationNamespace,
    options.resolveEnumNamespaceSchema,
  );

  return new SqlSchemaIR({
    tables,
    ...ifDefined('annotations', annotations),
  });
}

function deriveAnnotations(
  storage: SqlStorage,
  annotationNamespace: string,
  _resolveEnumNamespaceSchema: EnumNamespaceSchemaResolver | undefined,
): SqlAnnotations | undefined {
  const storageTypes: Record<string, StorageTypeInstance> = {};

  for (const typeInstance of Object.values(storage.types ?? {})) {
    if (isStorageTypeInstance(typeInstance)) {
      storageTypes[typeInstance.nativeType] = typeInstance;
    }
  }

  const envelope = {
    ...(Object.keys(storageTypes).length > 0 ? { storageTypes } : {}),
  };
  if (Object.keys(envelope).length === 0) return undefined;
  return { [annotationNamespace]: envelope };
}
