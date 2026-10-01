import type { ContractMarkerRecord, LedgerEntryRecord } from '@internal/contract/types';
import { parseMarkerRowSafely, withMarkerReadErrorHandling } from '@internal/errors/execution';
import { checkSqlDefaultBody } from '@internal/family-sql/control';
import type { SqlControlAdapter } from '@internal/family-sql/control-adapter';
import { parseContractMarkerRow } from '@internal/family-sql/verify';
import type { CodecLookupWithDescriptors } from '@internal/framework-components/codec';
import { APP_SPACE_ID, type SchemaNodeRef } from '@internal/framework-components/control';
import { ledgerOriginFromStored } from '@internal/migration-tools/ledger-origin';
import { REFERENTIAL_ACTION_SQL } from '@internal/sql-contract/referential-action-sql';
import type { SqlControlDriverInstance } from '@internal/sql-contract/types';
import type {
  AnyQueryAst,
  CodecRef,
  ContractCodecRegistry,
  DdlColumn,
  DdlNode,
  DdlTableConstraint,
  FunctionColumnDefault,
  LiteralColumnDefault,
  LoweredStatement,
  LowererContext,
  MarkerReadResult,
  SqlExecuteRequest,
} from '@internal/sql-relational-core/ast';
import {
  encodeLiteralDefault,
  isDdlNode,
  type LiteralDefaultColumn,
} from '@internal/sql-relational-core/ast';
import type {
  PrimaryKeyInput,
  SqlColumnIRInput,
  SqlForeignKeyIRInput,
  SqlIndexIRInput,
  SqlReferentialAction,
  SqlUniqueIRInput,
} from '@internal/sql-schema-ir/types';
import { RelationalSchemaNodeKind, SqlSchemaIR, SqlTableIR } from '@internal/sql-schema-ir/types';
import type { SqliteCodecRegistry } from '@internal/target-sqlite/codecs';
import {
  buildControlTableBootstrapQueries,
  buildSignMarkerBootstrapQueries,
} from '@internal/target-sqlite/contract-free';
import type { SqliteCreateTable, SqliteDdlNode } from '@internal/target-sqlite/ddl';
import { parseSqliteDefault } from '@internal/target-sqlite/default-normalizer';
import { normalizeSqliteNativeType } from '@internal/target-sqlite/native-type-normalizer';
import { escapeLiteral, quoteIdentifier } from '@internal/target-sqlite/sql-utils';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { structuredError } from '@internal/utils/structured-error';
import { renderLoweredSql } from './adapter';
import { encodeControlQueryParams } from './control-codecs';
import { coerceLedgerAppliedAt, operationCountFromStored } from './ledger-decode';
import {
  decodeSqliteMarkerRow,
  execute,
  ledger,
  ledgerReadShape,
  marker,
  mergeInvariants,
  NOW,
  sqliteCatalog,
} from './marker-ledger';
import type { SqliteContract } from './types';

const SQLITE_MARKER_TABLE = '_prisma_marker';
const SQLITE_LEDGER_TABLE = '_prisma_ledger';

type SqliteLedgerRow = {
  readonly space: string;
  readonly migration_name: string;
  readonly migration_hash: string;
  readonly origin_core_hash: string | null;
  readonly destination_core_hash: string;
  readonly operations: unknown;
  readonly created_at: Date | string;
};

// PRAGMA result row types
type PragmaTableInfoRow = {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
};

type PragmaForeignKeyRow = {
  id: number;
  seq: number;
  table: string;
  from: string;
  to: string;
  on_update: string;
  on_delete: string;
};

type PragmaIndexListRow = {
  seq: number;
  name: string;
  unique: number;
  origin: string;
  partial: number;
};

type PragmaIndexInfoRow = {
  seqno: number;
  cid: number;
  name: string;
};

type FkAccumulator = {
  columns: string[];
  referencedTable: string;
  referencedColumns: string[];
  onDelete: string;
  onUpdate: string;
};

export class SqliteControlAdapter implements SqlControlAdapter<'sqlite'> {
  readonly familyId = 'sql' as const;
  readonly targetId = 'sqlite' as const;

  private readonly codecRegistry: SqliteCodecRegistry;

  constructor(codecRegistry: SqliteCodecRegistry) {
    this.codecRegistry = codecRegistry;
  }

  readonly normalizeDefault = parseSqliteDefault;
  readonly normalizeNativeType = normalizeSqliteNativeType;

  bootstrapControlTableQueries(): readonly DdlNode[] {
    return buildControlTableBootstrapQueries();
  }

  bootstrapSignMarkerQueries(): readonly DdlNode[] {
    return buildSignMarkerBootstrapQueries();
  }

  /**
   * Lower a SQL query AST into a SQLite-flavored `{ sql, params }` payload.
   *
   * Delegates to the shared `renderLoweredSql` renderer so the control adapter
   * emits byte-identical SQL to `SqliteAdapterImpl.lower()` for the same AST
   * and contract. Used at migration plan/emit time (e.g. by `dataTransform`)
   * without instantiating the runtime adapter.
   */
  lower(ast: AnyQueryAst | SqliteDdlNode, context: LowererContext<unknown>): LoweredStatement {
    if (isDdlNode(ast)) {
      throw structuredError(
        'RUNTIME.DDL_UNSUPPORTED',
        'lower() cannot lower DDL: DDL default literals require inline codec encoding, which is async. Use lowerToExecuteRequest().',
        { meta: { surface: 'control-adapter' } },
      );
    }
    return renderLoweredSql(
      ast,
      blindCast<SqliteContract, 'caller must supply a matching SqliteContract'>(context.contract),
      this.codecRegistry,
    );
  }

  async renderColumnDefault(column: DdlColumn, table: string): Promise<string> {
    if (column.default === undefined) return '';
    return sqliteRenderDdlColumnDefault(column.default, this.codecRegistry, column.codecRef, {
      table,
      column: column.name,
    });
  }

  /**
   * Lower an AST all the way to a driver-ready statement. For DDL nodes,
   * literal column defaults are formatted as inline SQL with SQLite-specific
   * literal syntax (no cast suffix, boolean as 0/1, blob via X'hex'). For
   * query ASTs, params are kept as `?` placeholders; wire values go in
   * `params`. Does NOT call `this.lower()` — independent implementation.
   */
  async lowerToExecuteRequest(
    ast: AnyQueryAst | SqliteDdlNode,
    context?: LowererContext<unknown>,
  ): Promise<SqlExecuteRequest> {
    if (isDdlNode(ast)) {
      return sqliteRenderDdlExecuteRequest(
        blindCast<SqliteDdlNode, 'isDdlNode guard'>(ast),
        this.codecRegistry,
      );
    }
    const contract = blindCast<SqliteContract, 'Caller must supply matching contract'>(
      context?.contract,
    );
    const lowered = renderLoweredSql(ast, contract, this.codecRegistry);
    const codecRegistry = blindCast<
      ContractCodecRegistry,
      'framework CodecRegistry: its descriptors materialise SQL codecs; the framework Codec type erases to BaseCodec at this boundary'
    >(this.codecRegistry);
    const params = await encodeControlQueryParams(lowered, ast, codecRegistry);
    return { sql: lowered.sql, params };
  }

  /**
   * Reads the contract marker from `_prisma_marker`. Probes `sqlite_master`
   * first so a fresh database (no marker table) returns `null` instead of a
   * "no such table" error.
   */
  async readMarker(
    driver: SqlControlDriverInstance<'sqlite'>,
    space: string,
  ): Promise<ContractMarkerRecord | null> {
    const result = await this.readMarkerDiscriminated(driver, space);
    return result.kind === 'present' ? result.record : null;
  }

  async readMarkerDiscriminated(
    driver: SqlControlDriverInstance<'sqlite'>,
    space: string,
  ): Promise<MarkerReadResult> {
    const markerContext = { space, markerLocation: SQLITE_MARKER_TABLE };
    return withMarkerReadErrorHandling(() => this.readMarkerResult(driver, space), markerContext);
  }

  /**
   * Reads every row from `_prisma_marker` and returns them keyed by
   * `space`. Mirrors the existence probe in {@link readMarker}: a
   * fresh database without the marker table returns an empty map.
   */
  async readAllMarkers(
    driver: SqlControlDriverInstance<'sqlite'>,
  ): Promise<ReadonlyMap<string, ContractMarkerRecord>> {
    const markerContext = { space: APP_SPACE_ID, markerLocation: SQLITE_MARKER_TABLE };
    return withMarkerReadErrorHandling(() => this.readAllMarkersResult(driver), markerContext);
  }

  private async readAllMarkersResult(
    driver: SqlControlDriverInstance<'sqlite'>,
  ): Promise<ReadonlyMap<string, ContractMarkerRecord>> {
    const lower = (query: AnyQueryAst) => this.lower(query, { contract: undefined });
    const probe = sqliteCatalog
      .select(sqliteCatalog.name)
      .where(sqliteCatalog.type.eq('table').and(sqliteCatalog.name.eq('_prisma_marker')))
      .build();
    const exists = await execute(lower, driver, probe);
    if (exists.length === 0) {
      return new Map();
    }

    const fetch = marker
      .select(
        marker.space,
        marker.core_hash,
        marker.profile_hash,
        marker.contract_json,
        marker.canonical_version,
        marker.updated_at,
        marker.app_tag,
        marker.meta,
        marker.invariants,
      )
      .build();
    const rawRows = await execute(lower, driver, fetch);
    const rows = blindCast<
      ReadonlyArray<{ space: string } & Record<string, unknown>>,
      'Driver returns rows shaped by SELECT'
    >(rawRows);

    const out = new Map<string, ContractMarkerRecord>();
    for (const row of rows) {
      out.set(
        row.space,
        parseMarkerRowSafely(row, (raw) => parseContractMarkerRow(decodeSqliteMarkerRow(raw)), {
          space: row.space,
          markerLocation: SQLITE_MARKER_TABLE,
        }),
      );
    }
    return out;
  }

  /**
   * Reads per-migration ledger rows from `_prisma_ledger` in apply order.
   * Probes `sqlite_master` first so a fresh database without the ledger
   * table returns `[]` instead of raising "no such table".
   */
  async readLedger(
    driver: SqlControlDriverInstance<'sqlite'>,
    space?: string,
  ): Promise<readonly LedgerEntryRecord[]> {
    const ledgerContext = { space: space ?? '*', markerLocation: SQLITE_LEDGER_TABLE };
    return withMarkerReadErrorHandling(() => this.readLedgerResult(driver, space), ledgerContext);
  }

  private async readLedgerResult(
    driver: SqlControlDriverInstance<'sqlite'>,
    space: string | undefined,
  ): Promise<readonly LedgerEntryRecord[]> {
    const lower = (query: AnyQueryAst) => this.lower(query, { contract: undefined });
    const probe = sqliteCatalog
      .select(sqliteCatalog.name)
      .where(sqliteCatalog.type.eq('table').and(sqliteCatalog.name.eq('_prisma_ledger')))
      .build();
    const exists = await execute(lower, driver, probe);
    if (exists.length === 0) {
      return [];
    }

    const base = ledgerReadShape.select(
      ledgerReadShape.space,
      ledgerReadShape.migration_name,
      ledgerReadShape.migration_hash,
      ledgerReadShape.origin_core_hash,
      ledgerReadShape.destination_core_hash,
      ledgerReadShape.operations,
      ledgerReadShape.created_at,
    );
    const filtered = space !== undefined ? base.where(ledgerReadShape.space.eq(space)) : base;
    const rawRows = await execute(lower, driver, filtered.orderBy(ledgerReadShape.id).build());
    const rows = blindCast<readonly SqliteLedgerRow[], 'Driver returns rows shaped by SELECT'>(
      rawRows,
    );

    return rows.map((row) => ({
      space: row.space,
      migrationName: row.migration_name,
      migrationHash: row.migration_hash,
      from: ledgerOriginFromStored(row.origin_core_hash),
      to: row.destination_core_hash,
      appliedAt: coerceLedgerAppliedAt(row.created_at),
      operationCount: operationCountFromStored(row.operations),
    }));
  }

  /**
   * Stamps the initial marker row for `space` via the shared contract-free DML
   * builder, lowered through {@link lower} and executed on the driver. See the
   * `SqlControlAdapter.initMarker` contract.
   */
  async insertMarker(
    driver: SqlControlDriverInstance<'sqlite'>,
    space: string,
    destination: {
      readonly storageHash: string;
      readonly profileHash: string;
      readonly invariants?: readonly string[];
    },
  ): Promise<void> {
    await execute(
      (query) => this.lower(query, { contract: undefined }),
      driver,
      marker
        .insert({
          space,
          core_hash: destination.storageHash,
          profile_hash: destination.profileHash,
          contract_json: null,
          canonical_version: null,
          updated_at: NOW,
          app_tag: null,
          meta: {},
          invariants: destination.invariants ?? [],
        })
        .build(),
    );
  }

  async initMarker(
    driver: SqlControlDriverInstance<'sqlite'>,
    space: string,
    destination: {
      readonly storageHash: string;
      readonly profileHash: string;
      readonly invariants?: readonly string[];
    },
  ): Promise<void> {
    await execute(
      (query) => this.lower(query, { contract: undefined }),
      driver,
      marker
        .upsert({
          space,
          core_hash: destination.storageHash,
          profile_hash: destination.profileHash,
          contract_json: null,
          canonical_version: null,
          updated_at: NOW,
          app_tag: null,
          meta: {},
          invariants: destination.invariants ?? [],
        })
        .onConflict(marker.space)
        .doUpdate((excluded) => ({
          core_hash: excluded.core_hash,
          profile_hash: excluded.profile_hash,
          contract_json: excluded.contract_json,
          canonical_version: excluded.canonical_version,
          updated_at: NOW,
          app_tag: excluded.app_tag,
          meta: excluded.meta,
          invariants: excluded.invariants,
        }))
        .build(),
    );
  }

  /**
   * Compare-and-swap advance of the marker row for `space`. See the
   * `SqlControlAdapter.updateMarker` contract.
   */
  async updateMarker(
    driver: SqlControlDriverInstance<'sqlite'>,
    space: string,
    expectedFrom: string,
    destination: {
      readonly storageHash: string;
      readonly profileHash: string;
      readonly invariants?: readonly string[];
    },
  ): Promise<boolean> {
    const currentInvariants =
      destination.invariants === undefined
        ? []
        : ((await this.readMarker(driver, space))?.invariants ?? []);
    const mergedInvariants =
      destination.invariants === undefined
        ? undefined
        : mergeInvariants(currentInvariants, destination.invariants);

    const query = marker
      .update()
      .set({
        core_hash: destination.storageHash,
        profile_hash: destination.profileHash,
        updated_at: NOW,
        ...(mergedInvariants !== undefined ? { invariants: mergedInvariants } : {}),
      })
      .where(marker.space.eq(space).and(marker.core_hash.eq(expectedFrom)))
      .returning(marker.space)
      .build();

    const rows = await execute((q) => this.lower(q, { contract: undefined }), driver, query);
    return rows.length > 0;
  }

  /**
   * Appends a ledger entry for `space`. See the
   * `SqlControlAdapter.writeLedgerEntry` contract.
   */
  async writeLedgerEntry(
    driver: SqlControlDriverInstance<'sqlite'>,
    space: string,
    entry: {
      readonly edgeId: string;
      readonly from: string;
      readonly to: string;
      readonly migrationName: string;
      readonly migrationHash: string;
      readonly operations: readonly unknown[];
    },
  ): Promise<void> {
    await execute(
      (query) => this.lower(query, { contract: undefined }),
      driver,
      ledger
        .insert({
          space,
          migration_name: entry.migrationName,
          migration_hash: entry.migrationHash,
          origin_core_hash: entry.from,
          destination_core_hash: entry.to,
          operations: entry.operations,
        })
        .build(),
    );
  }

  private async readMarkerResult(driver: SqlControlDriverInstance<'sqlite'>, space: string) {
    const lower = (query: AnyQueryAst) => this.lower(query, { contract: undefined });
    const probe = sqliteCatalog
      .select(sqliteCatalog.name)
      .where(sqliteCatalog.type.eq('table').and(sqliteCatalog.name.eq('_prisma_marker')))
      .build();
    const exists = await execute(lower, driver, probe);
    if (exists.length === 0) return { kind: 'no-table' as const };

    const fetch = marker
      .select(
        marker.core_hash,
        marker.profile_hash,
        marker.contract_json,
        marker.canonical_version,
        marker.updated_at,
        marker.app_tag,
        marker.meta,
        marker.invariants,
      )
      .where(marker.space.eq(space))
      .build();
    const result = await execute(lower, driver, fetch);
    const row = result[0];
    if (!row) return { kind: 'absent' as const };
    return {
      kind: 'present' as const,
      record: parseContractMarkerRow(decodeSqliteMarkerRow(row)),
    };
  }

  async introspect(
    driver: SqlControlDriverInstance<'sqlite'>,
    _contract?: unknown,
  ): Promise<SqlSchemaIR> {
    // Filter out runner-managed control tables (`_prisma_marker`,
    // `_prisma_ledger`) — they're an implementation detail of the migration
    // runner, not part of the user-authored contract, so they must not
    // appear in introspection output (otherwise strict schema verification
    // flags them as `extra_table`).
    const tablesResult = await driver.query<{ name: string }>(
      `SELECT name FROM sqlite_master
       WHERE type = 'table'
         AND name NOT LIKE 'sqlite_%'
         AND name NOT IN ('_prisma_marker', '_prisma_ledger')
       ORDER BY name`,
    );

    const tables: Record<string, SqlTableIR> = {};

    for (const tableRow of tablesResult.rows) {
      const tableName = tableRow.name;

      // SQLite's synchronous driver serializes reads — no benefit from Promise.all
      const columnsResult = await driver.query<PragmaTableInfoRow>(
        `PRAGMA table_info("${escapePragmaArg(tableName)}")`,
      );
      const fkResult = await driver.query<PragmaForeignKeyRow>(
        `PRAGMA foreign_key_list("${escapePragmaArg(tableName)}")`,
      );
      const indexListResult = await driver.query<PragmaIndexListRow>(
        `PRAGMA index_list("${escapePragmaArg(tableName)}")`,
      );

      const columns: Record<string, SqlColumnIRInput> = {};
      const pkColumns: Array<{ name: string; pk: number }> = [];

      for (const col of columnsResult.rows) {
        // Resolved values comparable against the contract-derived expected
        // side: the normalized native type and the structured parse of the
        // raw default. Raw fields stay untouched alongside — the relational
        // walk still reads and normalizes them itself.
        const resolvedNativeType = normalizeSqliteNativeType(col.type);
        const rawDefault = col.dflt_value ?? undefined;
        columns[col.name] = {
          name: col.name,
          nativeType: col.type.toLowerCase(),
          nullable: col.notnull === 0 && col.pk === 0,
          ...ifDefined('default', rawDefault),
          resolvedNativeType,
          ...ifDefined(
            'resolvedDefault',
            rawDefault !== undefined
              ? parseSqliteDefault(rawDefault, resolvedNativeType)
              : undefined,
          ),
        };
        if (col.pk > 0) {
          pkColumns.push({ name: col.name, pk: col.pk });
        }
      }

      pkColumns.sort((a, b) => a.pk - b.pk);
      const primaryKey: PrimaryKeyInput | undefined =
        pkColumns.length > 0
          ? {
              columns: pkColumns.map((c) => c.name),
              dependsOn: flatColumnDependsOn(
                tableName,
                pkColumns.map((c) => c.name),
              ),
            }
          : undefined;

      const fkMap = new Map<number, FkAccumulator>();
      for (const fk of fkResult.rows) {
        const existing = fkMap.get(fk.id);
        if (existing) {
          existing.columns.push(fk.from);
          existing.referencedColumns.push(fk.to);
        } else {
          fkMap.set(fk.id, {
            columns: [fk.from],
            referencedTable: fk.table,
            referencedColumns: [fk.to],
            onDelete: fk.on_delete,
            onUpdate: fk.on_update,
          });
        }
      }
      const foreignKeys: readonly SqlForeignKeyIRInput[] = Array.from(fkMap.values()).map((fk) => ({
        columns: Object.freeze([...fk.columns]) as readonly string[],
        referencedTable: fk.referencedTable,
        referencedColumns: Object.freeze([...fk.referencedColumns]) as readonly string[],
        ...ifDefined('onDelete', mapSqliteReferentialAction(fk.onDelete)),
        ...ifDefined('onUpdate', mapSqliteReferentialAction(fk.onUpdate)),
        dependsOn: [
          flatTableDependsOn(fk.referencedTable),
          ...flatColumnDependsOn(tableName, fk.columns),
        ],
      }));

      const uniques: SqlUniqueIRInput[] = [];
      const indexes: SqlIndexIRInput[] = [];

      for (const idx of indexListResult.rows) {
        // origin: 'c' = CREATE INDEX, 'u' = UNIQUE constraint, 'pk' = PRIMARY KEY
        const idxInfoResult = await driver.query<PragmaIndexInfoRow>(
          `PRAGMA index_info("${escapePragmaArg(idx.name)}")`,
        );

        const idxColumns = idxInfoResult.rows.sort((a, b) => a.seqno - b.seqno).map((r) => r.name);

        if (idx.origin === 'u') {
          uniques.push({
            columns: Object.freeze([...idxColumns]) as readonly string[],
            name: idx.name,
            dependsOn: flatColumnDependsOn(tableName, idxColumns),
          });
        } else if (idx.origin === 'c') {
          indexes.push({
            naming: { kind: 'exact', name: idx.name },
            columns: Object.freeze([...idxColumns]) as readonly string[],
            where: undefined,
            unique: idx.unique === 1,
            partial: idx.partial === 1,
            type: undefined,
            options: undefined,
            annotations: undefined,
            dependsOn: flatColumnDependsOn(tableName, idxColumns),
          });
        }
        // Skip 'pk' origin — already captured in primaryKey
      }

      tables[tableName] = new SqlTableIR({
        name: tableName,
        columns,
        ...ifDefined('primaryKey', primaryKey),
        foreignKeys,
        uniques,
        indexes,
      });
    }

    return new SqlSchemaIR({
      tables,
    });
  }
}

// PRAGMA queries use the function-argument form (`PRAGMA table_info("name")`)
// which doesn't support `?` placeholders — the argument is part of the
// statement name, not a bound parameter. We quote-escape the table name instead.
function escapePragmaArg(name: string): string {
  return name.replace(/"/g, '""');
}

const SQLITE_REFERENTIAL_ACTION_MAP: Record<string, SqlReferentialAction> = {
  'NO ACTION': 'noAction',
  RESTRICT: 'restrict',
  CASCADE: 'cascade',
  'SET NULL': 'setNull',
  'SET DEFAULT': 'setDefault',
};

function mapSqliteReferentialAction(rule: string): SqlReferentialAction | undefined {
  const normalized = rule.toUpperCase();
  const mapped = SQLITE_REFERENTIAL_ACTION_MAP[normalized];
  if (mapped === undefined) {
    throw structuredError(
      'CONTRACT.INTROSPECTION_UNSUPPORTED',
      `Unknown SQLite referential action rule: "${rule}". ` +
        'Expected one of: NO ACTION, RESTRICT, CASCADE, SET NULL, SET DEFAULT.',
      { meta: { rule } },
    );
  }
  if (mapped === 'noAction') return undefined;
  return mapped;
}

/**
 * The referenced table's chain in the flat (single-schema) tree this
 * introspection builds: the root (`SqlSchemaIR`, fixed `'database'` id)
 * followed by the table's own id. Mirrors the expected-side derivation
 * (`contractToSchemaIR`'s `convertForeignKey`).
 */
function flatTableDependsOn(tableName: string): SchemaNodeRef {
  return [
    { nodeKind: RelationalSchemaNodeKind.schema, id: 'database' },
    { nodeKind: RelationalSchemaNodeKind.table, id: tableName },
  ];
}

/**
 * The chains from a table-child object (foreign key, index, unique, primary
 * key) to each of the own columns it is built on — the introspection-side
 * mirror of `contractToSchemaIR`'s `flatColumnDependsOn`. An object is dropped
 * before the columns it covers.
 */
function flatColumnDependsOn(tableName: string, columns: readonly string[]): SchemaNodeRef[] {
  return columns.map((column) => [
    ...flatTableDependsOn(tableName),
    { nodeKind: RelationalSchemaNodeKind.column, id: `column:${column}` },
  ]);
}

// ---------------------------------------------------------------------------
// sqliteRenderDdlExecuteRequest — independent DDL walker for lowerToExecuteRequest
// ---------------------------------------------------------------------------

function sqliteInlineLiteral(wire: unknown, where: LiteralDefaultColumn): string {
  if (wire === null) return 'NULL';
  if (typeof wire === 'boolean') return wire ? '1' : '0';
  if (typeof wire === 'number') {
    if (Number.isNaN(wire)) {
      throw structuredError(
        'CONTRACT.DEFAULT_INVALID',
        `Column "${where.table}"."${where.column}" has a NaN default, which SQLite stores as NULL`,
        { meta: { table: where.table, column: where.column, value: 'NaN', reason: 'nan-default' } },
      );
    }
    if (!Number.isFinite(wire)) return wire > 0 ? '9e999' : '-9e999';
    return String(wire);
  }
  if (typeof wire === 'bigint') return String(wire);
  if (wire instanceof Date) {
    if (Number.isNaN(wire.getTime())) {
      throw structuredError(
        'CONTRACT.DEFAULT_INVALID',
        `Column "${where.table}"."${where.column}" has an invalid Date default`,
        { meta: { table: where.table, column: where.column, reason: 'invalid-date-default' } },
      );
    }
    return `'${escapeLiteral(wire.toISOString())}'`;
  }
  if (typeof wire === 'string') return `'${escapeLiteral(wire)}'`;
  if (wire instanceof Uint8Array) {
    const hex = Array.from(wire)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return `X'${hex}'`;
  }
  if (typeof wire === 'object') return `'${escapeLiteral(JSON.stringify(wire))}'`;
  throw structuredError(
    'CONTRACT.PACK_CONTRIBUTION_INVALID',
    `sqliteRenderDdlExecuteRequest: unexpected wire type "${typeof wire}"`,
    { meta: { wireType: typeof wire } },
  );
}

async function sqliteRenderDdlColumnDefault(
  def: LiteralColumnDefault | FunctionColumnDefault,
  codecLookup: CodecLookupWithDescriptors,
  codecRef: CodecRef | undefined,
  where: LiteralDefaultColumn,
): Promise<string> {
  if (def.kind === 'function') {
    if (def.expression === 'autoincrement()') return '';
    // SQLite has no `now()` function; the contract canonicalizes
    // `CURRENT_TIMESTAMP` / `datetime('now')` to `now()`, so map it back to a
    // valid SQLite expression on the way out.
    if (def.expression === 'now()') return "DEFAULT (datetime('now'))";
    if (checkSqlDefaultBody(def.expression) !== undefined) {
      throw structuredError(
        'CONTRACT.DEFAULT_INVALID',
        `Unsafe default expression in contract: "${def.expression}". ` +
          'Default expressions must not contain semicolons, SQL comment tokens, dollar-quoting, or subqueries.',
        { meta: { expression: def.expression } },
      );
    }
    return `DEFAULT (${def.expression})`;
  }
  const encoded =
    codecRef === undefined
      ? undefined
      : await encodeLiteralDefault(codecLookup, codecRef, def.value, where);
  if (encoded?.kind === 'sql-null') return 'DEFAULT NULL';
  if (encoded !== undefined) return `DEFAULT ${sqliteInlineLiteral(encoded.wire, where)}`;
  // Fallback: codec-less literal defaults follow RawSqlLiteral wire-scalar semantics.
  return `DEFAULT ${sqliteInlineLiteral(def.value, where)}`;
}

async function sqliteRenderDdlColumn(
  column: DdlColumn,
  codecLookup: CodecLookupWithDescriptors,
  table: string,
): Promise<string> {
  if (column.type.includes('AUTOINCREMENT')) {
    return `${quoteIdentifier(column.name)} ${column.type}`;
  }
  const parts = [quoteIdentifier(column.name), column.type];
  if (column.notNull) parts.push('NOT NULL');
  if (column.primaryKey) parts.push('PRIMARY KEY');
  if (column.default) {
    const clause = await sqliteRenderDdlColumnDefault(
      column.default,
      codecLookup,
      column.codecRef,
      {
        table,
        column: column.name,
      },
    );
    if (clause.length > 0) parts.push(clause);
  }
  return parts.join(' ');
}

function sqliteRenderDdlConstraint(constraint: DdlTableConstraint): string {
  if (constraint.kind === 'primary-key') {
    const cols = constraint.columns.map(quoteIdentifier).join(', ');
    if (constraint.name !== undefined) {
      return `CONSTRAINT ${quoteIdentifier(constraint.name)} PRIMARY KEY (${cols})`;
    }
    return `PRIMARY KEY (${cols})`;
  }
  if (constraint.kind === 'foreign-key') {
    const cols = constraint.columns.map(quoteIdentifier).join(', ');
    const refTable = constraint.refTable.split('.').map(quoteIdentifier).join('.');
    const refCols = constraint.refColumns.map(quoteIdentifier).join(', ');
    let sql = `FOREIGN KEY (${cols}) REFERENCES ${refTable} (${refCols})`;
    if (constraint.onDelete !== undefined) {
      sql += ` ON DELETE ${REFERENTIAL_ACTION_SQL[constraint.onDelete]}`;
    }
    if (constraint.onUpdate !== undefined) {
      sql += ` ON UPDATE ${REFERENTIAL_ACTION_SQL[constraint.onUpdate]}`;
    }
    if (constraint.name !== undefined) {
      sql = `CONSTRAINT ${quoteIdentifier(constraint.name)} ${sql}`;
    }
    return sql;
  }
  if (constraint.kind === 'check-expression') {
    throw structuredError(
      'CONTRACT.CONSTRAINT_INVALID',
      `The SQLite target does not support CHECK constraints (constraint "${constraint.name}"). The "checkConstraint" capability is Postgres-only — remove the "@@check" / "check()" declaration, or target Postgres.`,
      { meta: { constraintName: constraint.name } },
    );
  }
  const cols = constraint.columns.map(quoteIdentifier).join(', ');
  if (constraint.name !== undefined) {
    return `CONSTRAINT ${quoteIdentifier(constraint.name)} UNIQUE (${cols})`;
  }
  return `UNIQUE (${cols})`;
}

async function sqliteRenderDdlExecuteRequest(
  ast: SqliteDdlNode,
  codecLookup: CodecLookupWithDescriptors,
): Promise<SqlExecuteRequest> {
  const node = blindCast<SqliteCreateTable, 'SQLite DDL only has create-table'>(ast);
  const ifNotExists = node.ifNotExists ? 'IF NOT EXISTS ' : '';
  const tableRef = quoteIdentifier(node.table);
  const columnDefs = await Promise.all(
    node.columns.map((col) => sqliteRenderDdlColumn(col, codecLookup, node.table)),
  );
  const constraintDefs =
    node.constraints !== undefined ? node.constraints.map(sqliteRenderDdlConstraint) : [];
  const allDefs = [...columnDefs, ...constraintDefs].join(',\n  ');
  return {
    sql: `CREATE TABLE ${ifNotExists}${tableRef} (\n  ${allDefs}\n)`,
    params: [],
  };
}
