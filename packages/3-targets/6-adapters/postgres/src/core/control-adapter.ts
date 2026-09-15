import type {
  ColumnDefault,
  ContractMarkerRecord,
  LedgerEntryRecord,
} from '@internal/contract/types';
import {
  errorMarkerRowCorrupt,
  rethrowMarkerReadError,
  withMarkerReadErrorHandling,
} from '@internal/errors/execution';
import type { SqlControlAdapter } from '@internal/family-sql/control-adapter';
import { parseContractMarkerRow } from '@internal/family-sql/verify';
import type { CodecLookup } from '@internal/framework-components/codec';
import { APP_SPACE_ID, type SchemaNodeRef } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
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
import { isDdlNode } from '@internal/sql-relational-core/ast';
import type { ColumnDescriptor, ExcludedProxy } from '@internal/sql-relational-core/contract-free';
import { namingOfLiveName } from '@internal/sql-schema-ir/naming';
import type {
  PrimaryKeyInput,
  SqlCheckConstraintIRInput,
  SqlColumnIRInput,
  SqlForeignKeyIRInput,
  SqlIndexIRInput,
  SqlReferentialAction,
  SqlUniqueIRInput,
} from '@internal/sql-schema-ir/types';
import { RelationalSchemaNodeKind } from '@internal/sql-schema-ir/types';
import {
  buildControlTableBootstrapQueries,
  buildSignMarkerBootstrapQueries,
} from '@internal/target-postgres/contract-free';
import { parsePostgresListText } from '@internal/target-postgres/control';
import type {
  AddColumnAction,
  AlterTableActionVisitor,
  AnyAlterTableAction,
  DropDefaultAction,
  PostgresAlterIndexRename,
  PostgresAlterPolicyRename,
  PostgresAlterTable,
  PostgresCreateIndex,
  PostgresCreatePolicy,
  PostgresCreateSchema,
  PostgresCreateTable,
  PostgresCreateType,
  PostgresDdlNode,
  PostgresDisableRowLevelSecurity,
  PostgresDropIndex,
  PostgresDropPolicy,
  PostgresDropType,
  RlsPolicyOperation,
} from '@internal/target-postgres/ddl';
import { parsePostgresDefault } from '@internal/target-postgres/default-normalizer';
import { postgresError } from '@internal/target-postgres/errors';
import { normalizeSchemaNativeType } from '@internal/target-postgres/native-type-normalizer';
import { escapeLiteral, quoteIdentifier } from '@internal/target-postgres/sql-utils';
import {
  PostgresDatabaseSchemaNode,
  PostgresNamespaceSchemaNode,
  PostgresNativeEnumSchemaNode,
  PostgresPolicySchemaNode,
  PostgresRoleSchemaNode,
  PostgresSchemaNodeKind,
  PostgresTableSchemaNode,
} from '@internal/target-postgres/types';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { adapterError } from './adapter-errors';
import { encodeControlQueryParams } from './control-codecs';
import {
  execute,
  infoSchemaTables,
  ledger,
  ledgerContract,
  ledgerReadShape,
  marker,
  mergeInvariants,
  NOW,
} from './marker-ledger';
import { renderLoweredSql } from './sql-renderer';
import type { PostgresCodecRegistry, PostgresContract } from './types';

const POSTGRES_MARKER_TABLE = 'prisma_contract.marker';
const POSTGRES_LEDGER_TABLE = 'prisma_contract.ledger';

function markerRowDecodeWhy(detail: string): string {
  return `Invalid contract marker row: ${detail}`;
}

function decodePostgresMarkerRow(row: unknown, space: string): Record<string, unknown> {
  if (typeof row !== 'object' || row === null) {
    const cause = new TypeError(`expected object marker row, got ${typeof row}`);
    throw errorMarkerRowCorrupt({
      why: markerRowDecodeWhy(cause.message),
      space,
      markerLocation: POSTGRES_MARKER_TABLE,
      cause,
    });
  }
  const record = blindCast<
    { readonly invariants: unknown } & Record<string, unknown>,
    'Postgres marker rows are object-shaped at this boundary'
  >(row);
  try {
    return {
      ...record,
      invariants: parsePostgresListText(record.invariants),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw errorMarkerRowCorrupt({
      why: markerRowDecodeWhy(message),
      space,
      markerLocation: POSTGRES_MARKER_TABLE,
      cause: error,
    });
  }
}

type PostgresLedgerRow = {
  readonly space: string;
  readonly migration_name: string;
  readonly migration_hash: string;
  readonly origin_core_hash: string | null;
  readonly destination_core_hash: string;
  readonly operations: unknown;
  readonly created_at: Date | string;
};

/**
 * Postgres control plane adapter for control-plane operations like introspection.
 * Provides target-specific implementations for control-plane domain actions.
 */
export class PostgresControlAdapter implements SqlControlAdapter<'postgres'> {
  readonly familyId = 'sql' as const;
  readonly targetId = 'postgres' as const;

  constructor(private readonly codecRegistry: PostgresCodecRegistry) {}

  /**
   * Target-specific normalizer for raw Postgres default expressions.
   * Used by schema verification to normalize raw defaults before comparison.
   */
  readonly normalizeDefault = parsePostgresDefault;

  /**
   * Target-specific normalizer for Postgres schema native type names.
   * Used by schema verification to normalize introspected type names
   * before comparison with contract native types.
   */
  readonly normalizeNativeType = normalizeSchemaNativeType;

  bootstrapControlTableQueries(): readonly DdlNode[] {
    return buildControlTableBootstrapQueries();
  }

  bootstrapSignMarkerQueries(): readonly DdlNode[] {
    return buildSignMarkerBootstrapQueries();
  }

  /**
   * Lower a SQL query AST into a Postgres-flavored `{ sql, params }` payload.
   *
   * Delegates to the shared `renderLoweredSql` renderer so the control adapter
   * emits byte-identical SQL to `PostgresAdapterImpl.lower()` for the same AST
   * and contract. Used at migration plan/emit time (e.g. by `dataTransform`)
   * without instantiating the runtime adapter.
   */
  lower(ast: AnyQueryAst | PostgresDdlNode, context: LowererContext<unknown>): LoweredStatement {
    if (isDdlNode(ast)) {
      throw adapterError(
        'RUNTIME.DDL_UNSUPPORTED',
        'lower() cannot lower DDL: DDL default literals require inline codec encoding, which is async. Use lowerToExecuteRequest().',
        { meta: { surface: 'control-adapter' } },
      );
    }
    return renderLoweredSql(
      ast,
      blindCast<PostgresContract, 'caller must supply a matching PostgresContract'>(
        context.contract,
      ),
      this.codecRegistry,
    );
  }

  /**
   * Lower an AST all the way to a driver-ready statement. For DDL nodes,
   * literal column defaults are formatted as inline SQL with proper quoting and
   * `::nativeType` cast suffixes. For query ASTs, params are kept as `$N`
   * placeholders; wire values go in `params`. Does NOT call `this.lower()` —
   * independent implementation.
   */
  async lowerToExecuteRequest(
    ast: AnyQueryAst | PostgresDdlNode,
    context?: LowererContext<unknown>,
  ): Promise<SqlExecuteRequest> {
    if (isDdlNode(ast)) {
      return pgRenderDdlExecuteRequest(
        blindCast<PostgresDdlNode, 'isDdlNode guard'>(ast),
        this.codecRegistry,
      );
    }
    const contract = blindCast<PostgresContract, 'Caller must supply matching contract'>(
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
   * Reads the contract marker from `prisma_contract.marker`. Probes
   * `information_schema.tables` first so a fresh database (where the
   * `prisma_contract` schema doesn't yet exist) returns `null` instead of a
   * "relation does not exist" error — some Postgres wire-protocol clients
   * (e.g. PGlite's TCP proxy) don't fully recover from extended-protocol
   * parse errors, so we probe before reading.
   */
  async readMarker(
    driver: SqlControlDriverInstance<'postgres'>,
    space: string,
  ): Promise<ContractMarkerRecord | null> {
    const result = await this.readMarkerDiscriminated(driver, space);
    return result.kind === 'present' ? result.record : null;
  }

  async readMarkerDiscriminated(
    driver: SqlControlDriverInstance<'postgres'>,
    space: string,
  ): Promise<MarkerReadResult> {
    const markerContext = { space, markerLocation: POSTGRES_MARKER_TABLE };
    return withMarkerReadErrorHandling(() => this.readMarkerResult(driver, space), markerContext);
  }

  /**
   * Reads every row from `prisma_contract.marker` and returns them keyed
   * by `space`. Mirrors the existence probe in {@link readMarker}: a
   * fresh database without the `prisma_contract` schema returns an empty
   * map rather than raising "relation does not exist".
   */
  async readAllMarkers(
    driver: SqlControlDriverInstance<'postgres'>,
  ): Promise<ReadonlyMap<string, ContractMarkerRecord>> {
    const markerContext = { space: APP_SPACE_ID, markerLocation: POSTGRES_MARKER_TABLE };
    return withMarkerReadErrorHandling(() => this.readAllMarkersResult(driver), markerContext);
  }

  private async readAllMarkersResult(
    driver: SqlControlDriverInstance<'postgres'>,
  ): Promise<ReadonlyMap<string, ContractMarkerRecord>> {
    const lower = (query: AnyQueryAst) => this.lower(query, { contract: undefined });
    const probe = infoSchemaTables
      .select(infoSchemaTables.table_schema)
      .where(
        infoSchemaTables.table_schema
          .eq('prisma_contract')
          .and(infoSchemaTables.table_name.eq('marker')),
      )
      .build();
    const exists = await execute(lower, driver, probe);
    if (exists.length === 0) {
      return new Map();
    }

    await this.assertMarkerTableHasSpaceColumn(driver, APP_SPACE_ID);

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
      try {
        const decodedRow = decodePostgresMarkerRow(row, row.space);
        out.set(row.space, parseContractMarkerRow(decodedRow));
      } catch (error) {
        rethrowMarkerReadError(error, {
          space: row.space,
          markerLocation: POSTGRES_MARKER_TABLE,
        });
      }
    }
    return out;
  }

  /**
   * Reads per-migration ledger rows from `prisma_contract.ledger` in apply
   * order. Probes `information_schema.tables` first so a fresh database
   * without the ledger table returns `[]` instead of raising "relation does
   * not exist".
   */
  async readLedger(
    driver: SqlControlDriverInstance<'postgres'>,
    space?: string,
  ): Promise<readonly LedgerEntryRecord[]> {
    const ledgerContext = { space: space ?? '*', markerLocation: POSTGRES_LEDGER_TABLE };
    return withMarkerReadErrorHandling(() => this.readLedgerResult(driver, space), ledgerContext);
  }

  private async readLedgerResult(
    driver: SqlControlDriverInstance<'postgres'>,
    space: string | undefined,
  ): Promise<readonly LedgerEntryRecord[]> {
    const lower = (query: AnyQueryAst) => this.lower(query, { contract: undefined });
    const probe = infoSchemaTables
      .select(infoSchemaTables.table_schema)
      .where(
        infoSchemaTables.table_schema
          .eq('prisma_contract')
          .and(infoSchemaTables.table_name.eq('ledger')),
      )
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
    const rows = blindCast<readonly PostgresLedgerRow[], 'Driver returns rows shaped by SELECT'>(
      rawRows,
    );

    return rows.map((row) => {
      const appliedAt = row.created_at instanceof Date ? row.created_at : new Date(row.created_at);
      return {
        space: row.space,
        migrationName: row.migration_name,
        migrationHash: row.migration_hash,
        from: ledgerOriginFromStored(row.origin_core_hash),
        to: row.destination_core_hash,
        appliedAt,
        operationCount: Array.isArray(row.operations) ? row.operations.length : 0,
      };
    });
  }

  /**
   * Stamps the initial marker row for `space` via the shared contract-free DML
   * builder, lowered through {@link lower} and executed on the driver. See the
   * `SqlControlAdapter.initMarker` contract.
   */
  async insertMarker(
    driver: SqlControlDriverInstance<'postgres'>,
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
    driver: SqlControlDriverInstance<'postgres'>,
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
        .doUpdate((excluded: ExcludedProxy<MarkerUpsertSchema>) => ({
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
    driver: SqlControlDriverInstance<'postgres'>,
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
   * Appends a ledger entry for `space`. When the edge carries a
   * destination contract snapshot, the content-addressed
   * `prisma_contract.contract` store is populated first (keyed by the
   * destination hash, DO NOTHING on revisit) so a reader never sees a
   * ledger row whose stored destination contract is missing. See the
   * `SqlControlAdapter.writeLedgerEntry` contract.
   */
  async writeLedgerEntry(
    driver: SqlControlDriverInstance<'postgres'>,
    space: string,
    entry: {
      readonly edgeId: string;
      readonly from: string;
      readonly to: string;
      readonly migrationName: string;
      readonly migrationHash: string;
      readonly operations: readonly unknown[];
      readonly destinationContractJson?: unknown;
    },
  ): Promise<void> {
    const lower = (query: AnyQueryAst) => this.lower(query, { contract: undefined });
    if (entry.destinationContractJson !== undefined) {
      await execute(
        lower,
        driver,
        ledgerContract
          .upsert({ core_hash: entry.to, contract_json: entry.destinationContractJson })
          .onConflict(ledgerContract.core_hash)
          .doNothing()
          .build(),
      );
    }
    await execute(
      lower,
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

  private async assertMarkerTableHasSpaceColumn(
    driver: SqlControlDriverInstance<'postgres'>,
    space: string,
  ): Promise<void> {
    const result = await driver.query<{ column_name: string }>(
      `select column_name
         from information_schema.columns
        where table_schema = 'prisma_contract'
          and table_name = 'marker'`,
    );
    const rows = result.rows;
    if (rows.length === 0) {
      return;
    }
    if (!rows.every((row) => typeof row.column_name === 'string')) {
      return;
    }
    if (rows.some((row) => row.column_name === 'space')) {
      return;
    }
    rethrowMarkerReadError(new Error('column "space" does not exist'), {
      space,
      markerLocation: POSTGRES_MARKER_TABLE,
    });
  }

  private async readMarkerResult(driver: SqlControlDriverInstance<'postgres'>, space: string) {
    const lower = (query: AnyQueryAst) => this.lower(query, { contract: undefined });
    const probe = infoSchemaTables
      .select(infoSchemaTables.table_schema)
      .where(
        infoSchemaTables.table_schema
          .eq('prisma_contract')
          .and(infoSchemaTables.table_name.eq('marker')),
      )
      .build();
    const exists = await execute(lower, driver, probe);
    if (exists.length === 0) return { kind: 'no-table' as const };

    await this.assertMarkerTableHasSpaceColumn(driver, space);

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
    try {
      const decodedRow = decodePostgresMarkerRow(row, space);
      return { kind: 'present' as const, record: parseContractMarkerRow(decodedRow) };
    } catch (error) {
      rethrowMarkerReadError(error, { space, markerLocation: POSTGRES_MARKER_TABLE });
    }
  }

  /**
   * Introspects a Postgres database schema and returns a raw SqlSchemaIR.
   *
   * This is a pure schema discovery operation that queries the Postgres catalog
   * and returns the schema structure without type mapping or contract enrichment.
   * Type mapping and enrichment are handled separately by enrichment helpers.
   *
   * When `contract` is provided and its storage declares more than one
   * namespace (or any explicit bound namespace), the adapter walks every
   * declared namespace and merges the per-schema introspection results
   * into a single `SqlSchemaIR`. `UNBOUND_NAMESPACE_ID` resolves to the
   * connection's `current_schema()` so late-bound tables follow the
   * runtime `search_path`. When no contract is passed, the adapter falls
   * back to introspecting the single `schema` argument (defaulting to
   * `'public'`).
   *
   * Uses batched queries to minimize database round trips (6 queries per
   * schema walked).
   *
   * @param driver - SqlControlDriverInstance<'postgres'> instance for executing queries
   * @param contract - Optional contract for contract-guided introspection (multi-namespace walk, filtering)
   * @param schema - Schema name to introspect when no contract is provided (defaults to 'public')
   * @returns Promise resolving to SqlSchemaIR representing the live database schema
   */
  async introspect(
    driver: SqlControlDriverInstance<'postgres'>,
    contract?: unknown,
    schema = 'public',
  ): Promise<PostgresDatabaseSchemaNode> {
    const declaredNamespaces = extractContractNamespaceIds(contract);
    const resolvedSchemas =
      declaredNamespaces.length > 0
        ? await this.resolveNamespaceSchemas(driver, declaredNamespaces)
        : [schema];

    // Walk schemas sequentially: every introspectSchema call shares the one
    // control connection, so a parallel walk only serialises behind the wire
    // protocol and trips pg's "already executing a query" deprecation.
    const namespaces: Record<string, PostgresNamespaceSchemaNode> = {};
    let pgVersion = 'unknown';
    for (const resolved of resolvedSchemas) {
      const { namespace, pgVersion: version } = await this.introspectSchema(driver, resolved);
      namespaces[resolved] = namespace;
      pgVersion = version;
    }

    const roles = await this.introspectRoles(driver);
    const existingSchemas = await this.listExistingSchemas(driver);
    return new PostgresDatabaseSchemaNode({
      namespaces,
      roles,
      existingSchemas,
      pgVersion,
    });
  }

  /**
   * Reads cluster-scoped database roles. Roles are not schema-qualified, so
   * this is queried once for the whole database rather than per namespace.
   */
  private async introspectRoles(
    driver: SqlControlDriverInstance<'postgres'>,
  ): Promise<readonly PostgresRoleSchemaNode[]> {
    const rolesResult = await driver.query<{ rolname: string }>(
      `SELECT rolname
       FROM pg_catalog.pg_roles
       WHERE rolname NOT LIKE 'pg_%'
         AND rolname != 'postgres'
       ORDER BY rolname`,
    );
    return rolesResult.rows.map(
      (row) => new PostgresRoleSchemaNode({ name: row.rolname, namespaceId: UNBOUND_NAMESPACE_ID }),
    );
  }

  /**
   * Lists every non-system schema present in the connected database.
   * The introspection consumer (`verifyPostgresNamespacePresence`)
   * treats the result as the authoritative ground truth — declared
   * namespaces whose `ddlSchemaName` is missing from this list become
   * `missing_schema` issues, and the planner emits the matching
   * `CREATE SCHEMA` before table DDL.
   */
  private async listExistingSchemas(
    driver: SqlControlDriverInstance<'postgres'>,
  ): Promise<readonly string[]> {
    const result = await driver.query<{ nspname: string }>(
      `SELECT nspname
       FROM pg_catalog.pg_namespace
       WHERE nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
         AND nspname NOT LIKE 'pg_temp_%'
         AND nspname NOT LIKE 'pg_toast_temp_%'
       ORDER BY nspname`,
    );
    return result.rows.map((row) => row.nspname);
  }

  /**
   * Resolves the declared namespace ids to their live DDL schema names,
   * mapping `UNBOUND_NAMESPACE_ID` to the connection's `current_schema()`
   * and de-duplicating. The caller introspects one namespace node per
   * resolved schema — there is no flat cross-schema merge, so two schemas
   * holding a same-named table no longer collide.
   */
  private async resolveNamespaceSchemas(
    driver: SqlControlDriverInstance<'postgres'>,
    namespaceIds: readonly string[],
  ): Promise<readonly string[]> {
    const resolvedSchemas: string[] = [];
    for (const id of namespaceIds) {
      if (id === UNBOUND_NAMESPACE_ID) {
        const { rows } = await driver.query<{ current_schema: string }>(
          'SELECT current_schema() AS current_schema',
        );
        resolvedSchemas.push(rows[0]?.current_schema ?? 'public');
      } else {
        resolvedSchemas.push(id);
      }
    }
    return Array.from(new Set(resolvedSchemas));
  }

  /**
   * Introspects a single Postgres schema and returns the namespace node for
   * that schema (its tables, their policies, and its native enum type names),
   * alongside the cluster-scoped Postgres version. Used by `introspect` as
   * the per-namespace walk.
   */
  private async introspectSchema(
    driver: SqlControlDriverInstance<'postgres'>,
    schema: string,
  ): Promise<{ readonly namespace: PostgresNamespaceSchemaNode; readonly pgVersion: string }> {
    // Issue the schema-wide queries one at a time. A single control connection
    // serialises queries anyway, so Promise.all buys no parallelism here and
    // makes pg emit a "client is already executing a query" deprecation. One
    // schema-wide query per relation kind keeps this to 7 round-trips, not 6T+1.
    // Query all tables
    const tablesResult = await driver.query<{ table_name: string }>(
      `SELECT table_name
         FROM information_schema.tables
         WHERE table_schema = $1
           AND table_type = 'BASE TABLE'
         ORDER BY table_name`,
      [schema],
    );
    // Query all columns for all tables in schema
    const columnsResult = await driver.query<{
      table_name: string;
      column_name: string;
      data_type: string;
      udt_name: string;
      is_nullable: string;
      character_maximum_length: number | null;
      numeric_precision: number | null;
      numeric_scale: number | null;
      column_default: string | null;
      formatted_type: string | null;
      attidentity: string;
    }>(
      `SELECT
           c.table_name,
           column_name,
           data_type,
           udt_name,
           is_nullable,
           character_maximum_length,
           numeric_precision,
           numeric_scale,
           column_default,
           format_type(a.atttypid, a.atttypmod) AS formatted_type,
           a.attidentity
         FROM information_schema.columns c
         JOIN pg_catalog.pg_class cl
           ON cl.relname = c.table_name
         JOIN pg_catalog.pg_namespace ns
           ON ns.nspname = c.table_schema
           AND ns.oid = cl.relnamespace
         JOIN pg_catalog.pg_attribute a
           ON a.attrelid = cl.oid
           AND a.attname = c.column_name
           AND a.attnum > 0
           AND NOT a.attisdropped
         WHERE c.table_schema = $1
         ORDER BY c.table_name, c.ordinal_position`,
      [schema],
    );
    // Query all primary keys for all tables in schema. Reads pg_catalog, not
    // information_schema: `information_schema.table_constraints` hides
    // constraints on tables where the connecting role's only privilege is
    // SELECT (its filter grants visibility for INSERT/UPDATE/DELETE/TRUNCATE/
    // REFERENCES/TRIGGER — not SELECT), so a SELECT-only table introspects
    // with all its columns but zero constraints and verify reports every
    // declared constraint as missing. pg_catalog is not privilege-filtered.
    const pkResult = await driver.query<{
      table_name: string;
      constraint_name: string;
      column_name: string;
      ordinal_position: number;
    }>(
      `SELECT
           cl.relname AS table_name,
           con.conname AS constraint_name,
           a.attname AS column_name,
           k.ord AS ordinal_position
         FROM pg_catalog.pg_constraint con
         JOIN pg_catalog.pg_class cl ON cl.oid = con.conrelid
         JOIN pg_catalog.pg_namespace ns ON ns.oid = cl.relnamespace
         JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
         JOIN pg_catalog.pg_attribute a
           ON a.attrelid = con.conrelid
           AND a.attnum = k.attnum
         WHERE ns.nspname = $1
           AND con.contype = 'p'
         ORDER BY cl.relname, k.ord`,
      [schema],
    );
    // Query all foreign keys for all tables in schema, including referential
    // actions. Reads pg_catalog only (see the primary-key query above for why
    // information_schema is unusable here); `unnest(conkey) WITH ORDINALITY`
    // pairs source and referenced columns positionally, so composite FKs
    // round-trip in declared order. The referential-action CASEs mirror
    // pg_constraint's confdeltype/confupdtype encoding and produce the same
    // rule strings information_schema.referential_constraints reports.
    const fkResult = await driver.query<{
      table_name: string;
      constraint_name: string;
      column_name: string;
      ordinal_position: number;
      referenced_table_schema: string;
      referenced_table_name: string;
      referenced_column_name: string;
      delete_rule: string;
      update_rule: string;
    }>(
      `SELECT
           cl.relname AS table_name,
           con.conname AS constraint_name,
           a.attname AS column_name,
           k.ord AS ordinal_position,
           ref_ns.nspname AS referenced_table_schema,
           ref_cl.relname AS referenced_table_name,
           ref_att.attname AS referenced_column_name,
           CASE con.confdeltype
             WHEN 'a' THEN 'NO ACTION'
             WHEN 'r' THEN 'RESTRICT'
             WHEN 'c' THEN 'CASCADE'
             WHEN 'n' THEN 'SET NULL'
             WHEN 'd' THEN 'SET DEFAULT'
           END AS delete_rule,
           CASE con.confupdtype
             WHEN 'a' THEN 'NO ACTION'
             WHEN 'r' THEN 'RESTRICT'
             WHEN 'c' THEN 'CASCADE'
             WHEN 'n' THEN 'SET NULL'
             WHEN 'd' THEN 'SET DEFAULT'
           END AS update_rule
         FROM pg_catalog.pg_constraint con
         JOIN pg_catalog.pg_class cl ON cl.oid = con.conrelid
         JOIN pg_catalog.pg_namespace ns ON ns.oid = cl.relnamespace
         JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
         JOIN pg_catalog.pg_attribute a
           ON a.attrelid = con.conrelid
           AND a.attnum = k.attnum
         JOIN pg_catalog.pg_class ref_cl
           ON ref_cl.oid = con.confrelid
         JOIN pg_catalog.pg_namespace ref_ns
           ON ref_ns.oid = ref_cl.relnamespace
         JOIN pg_catalog.pg_attribute ref_att
           ON ref_att.attrelid = con.confrelid
           AND ref_att.attnum = con.confkey[k.ord]
         WHERE ns.nspname = $1
           AND con.contype = 'f'
         ORDER BY cl.relname, con.conname, k.ord`,
      [schema],
    );
    // Query all unique constraints for all tables in schema (excluding PKs).
    // Reads pg_catalog (see the primary-key query above).
    const uniqueResult = await driver.query<{
      table_name: string;
      constraint_name: string;
      column_name: string;
      ordinal_position: number;
    }>(
      `SELECT
           cl.relname AS table_name,
           con.conname AS constraint_name,
           a.attname AS column_name,
           k.ord AS ordinal_position
         FROM pg_catalog.pg_constraint con
         JOIN pg_catalog.pg_class cl ON cl.oid = con.conrelid
         JOIN pg_catalog.pg_namespace ns ON ns.oid = cl.relnamespace
         JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
         JOIN pg_catalog.pg_attribute a
           ON a.attrelid = con.conrelid
           AND a.attnum = k.attnum
         WHERE ns.nspname = $1
           AND con.contype = 'u'
         ORDER BY cl.relname, con.conname, k.ord`,
      [schema],
    );
    // Query all indexes for all tables in schema (excluding constraints).
    // `index_position` is the column's position within the index (1-based),
    // derived from `pg_index.indkey` so composite indexes round-trip with
    // their declared column order intact.
    const indexResult = await driver.query<{
      tablename: string;
      indexname: string;
      indisunique: boolean;
      where_predicate: string | null;
      attname: string | null;
      element_def: string | null;
      index_position: number;
      amname: string | null;
      // `pg_index.reloptions` is raw Postgres array text, not a JS array.
      reloptions: string | null;
    }>(
      // `ix.indkey` is an int2vector of column numbers in the order the
      // columns appear in the index definition. Unnest it WITH ORDINALITY
      // so each (index, column) row carries its position in the index,
      // then ORDER BY that position. Without this the rows come back in
      // table-column order (`a.attnum`), which silently shuffles the
      // columns of any composite index whose index order differs from
      // the table order — verification compares against the contract
      // with order-sensitive equality and reports a spurious
      // `index_mismatch`.
      //
      // `element_def` is the per-position element text as Postgres reprints
      // it (`pg_get_indexdef` with pretty-printing); an expression element
      // has attnum 0 so its `attname` is null and the element text is the
      // only faithful capture. A mixed index (columns + expressions) carries
      // the WHOLE element list as one opaque string, so the reprint must
      // fire for every position of an expression-carrying index — the CASE
      // bounds the per-element catalog reconstruction to those indexes,
      // which keeps pure-column schemas free of the reprint cost.
      // `where_predicate` is the reprinted partial-index predicate, null
      // for total indexes.
      `SELECT
           i.tablename,
           i.indexname,
           ix.indisunique,
           pg_get_expr(ix.indpred, ix.indrelid) AS where_predicate,
           a.attname,
           CASE WHEN 0 = ANY(ix.indkey::int[]) THEN pg_get_indexdef(ix.indexrelid, k.ord::int, true) END AS element_def,
           k.ord AS index_position,
           am.amname,
           ic.reloptions
         FROM pg_indexes i
         JOIN pg_class ic ON ic.relname = i.indexname
         JOIN pg_namespace ins ON ins.oid = ic.relnamespace AND ins.nspname = $1
         JOIN pg_index ix ON ix.indexrelid = ic.oid
         JOIN pg_am am ON am.oid = ic.relam
         JOIN pg_class t ON t.oid = ix.indrelid
         JOIN pg_namespace tn ON tn.oid = t.relnamespace AND tn.nspname = $1
         JOIN LATERAL unnest(ix.indkey::int[]) WITH ORDINALITY AS k(attnum, ord) ON true
         LEFT JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum AND a.attnum > 0
         WHERE i.schemaname = $1
           AND NOT EXISTS (
             SELECT 1
             FROM pg_catalog.pg_constraint con
             WHERE con.conindid = ic.oid
               AND con.contype IN ('p', 'u', 'x')
           )
         ORDER BY i.tablename, i.indexname, k.ord`,
      [schema],
    );
    // Every check constraint on a relation in this schema, captured opaquely.
    //
    // `pg_get_expr(c.conbin, c.conrelid)` yields the bare predicate — no
    // `CHECK (…)` wrapper and no `NOT VALID` / `NO INHERIT` suffix, since those
    // qualify the constraint rather than the expression. The body is stored
    // verbatim and never parsed: Postgres reprints predicates in its own
    // normalized form (a `varchar` membership test comes back as
    // `((col)::text = ANY ((ARRAY[…])::text[]))`), so any structured reading of
    // it would drift against the authored text.
    //
    // `c.conislocal` keeps one row per constraint: a partition or inheriting
    // child carries a non-local copy of its parent's constraint, which would
    // otherwise surface as a second node. `c.conrelid <> 0` excludes domain
    // constraints, which are `contype = 'c'` but belong to a type rather than a
    // relation — previously excluded only as a side effect of the pg_class join.
    const checkResult = await driver.query<{
      table_name: string;
      constraint_name: string;
      check_expression: string;
    }>(
      `SELECT
           cl.relname AS table_name,
           c.conname AS constraint_name,
           pg_get_expr(c.conbin, c.conrelid) AS check_expression
         FROM pg_catalog.pg_constraint c
         JOIN pg_catalog.pg_class cl ON cl.oid = c.conrelid
         JOIN pg_catalog.pg_namespace ns ON ns.oid = cl.relnamespace
         WHERE ns.nspname = $1
           AND c.contype = 'c'
           AND c.conislocal
           AND c.conrelid <> 0
         ORDER BY cl.relname, c.conname`,
      [schema],
    );

    // Group results by table name for efficient lookup
    const columnsByTable = groupBy(columnsResult.rows, 'table_name');
    const pksByTable = groupBy(pkResult.rows, 'table_name');
    const fksByTable = groupBy(fkResult.rows, 'table_name');
    const uniquesByTable = groupBy(uniqueResult.rows, 'table_name');
    const indexesByTable = groupBy(indexResult.rows, 'tablename');
    const checksByTable = groupBy(checkResult.rows, 'table_name');

    // Get set of PK constraint names per table (to exclude from uniques)
    const pkConstraintsByTable = new Map<string, Set<string>>();
    for (const row of pkResult.rows) {
      let constraints = pkConstraintsByTable.get(row.table_name);
      if (!constraints) {
        constraints = new Set();
        pkConstraintsByTable.set(row.table_name, constraints);
      }
      constraints.add(row.constraint_name);
    }

    const tableInputs: Record<
      string,
      {
        name: string;
        columns: Record<string, SqlColumnIRInput>;
        primaryKey?: PrimaryKeyInput;
        foreignKeys: readonly SqlForeignKeyIRInput[];
        uniques: readonly SqlUniqueIRInput[];
        indexes: readonly SqlIndexIRInput[];
        checks?: SqlCheckConstraintIRInput[];
      }
    > = {};

    for (const tableRow of tablesResult.rows) {
      const tableName = tableRow.table_name;

      // Process columns for this table
      const columns: Record<string, SqlColumnIRInput> = {};
      for (const colRow of columnsByTable.get(tableName) ?? []) {
        let nativeType = colRow.udt_name;
        const formattedType = colRow.formatted_type
          ? normalizeFormattedType(colRow.formatted_type, colRow.data_type, colRow.udt_name)
          : null;
        if (formattedType) {
          nativeType = formattedType;
        } else if (colRow.data_type === 'character varying' || colRow.data_type === 'character') {
          if (colRow.character_maximum_length) {
            nativeType = `${colRow.data_type}(${colRow.character_maximum_length})`;
          } else {
            nativeType = colRow.data_type;
          }
        } else if (colRow.data_type === 'numeric' || colRow.data_type === 'decimal') {
          if (colRow.numeric_precision && colRow.numeric_scale !== null) {
            nativeType = `${colRow.data_type}(${colRow.numeric_precision},${colRow.numeric_scale})`;
          } else if (colRow.numeric_precision) {
            nativeType = `${colRow.data_type}(${colRow.numeric_precision})`;
          } else {
            nativeType = colRow.data_type;
          }
        } else {
          nativeType = colRow.udt_name || colRow.data_type;
        }

        // Postgres reports array columns as data_type='ARRAY'; the element type
        // is the `nativeType` string minus the trailing `[]`. Strip the suffix,
        // normalize the element type to the canonical form (e.g. `integer` →
        // `int4`), and record `many: true` so introspection consumers (verifier,
        // psl-contract-infer) can reconstruct the full array type as needed.
        const many = nativeType.endsWith('[]') ? true : undefined;
        if (many) {
          nativeType = normalizeSchemaNativeType(nativeType.slice(0, -2));
        }

        // Resolved values comparable against the contract-derived expected
        // side: the normalized full native type (`[]` appended for arrays)
        // and the structured parse of the raw default. Raw fields stay
        // untouched alongside — the relational walk still reads and
        // normalizes them itself.
        const resolvedNativeType = `${normalizeSchemaNativeType(nativeType)}${many ? '[]' : ''}`;
        const rawDefault = colRow.column_default ?? undefined;
        // `GENERATED ALWAYS AS IDENTITY` ('a') and `GENERATED BY DEFAULT AS
        // IDENTITY` ('d') both report a NULL column_default — Postgres tracks
        // generation via attidentity, not a default expression — so neither
        // variant is visible in `rawDefault` at all. The contract has no
        // syntax to distinguish the two, so both resolve directly to the same
        // `autoincrement()` a `serial` column's `nextval(...)` default
        // already maps to. This is the only place identity is recognized —
        // there is no `SqlColumnIR.identity` field; every consumer compares
        // `resolvedDefault` instead.
        const isIdentityColumn = colRow.attidentity === 'a' || colRow.attidentity === 'd';
        const resolvedDefault: ColumnDefault | undefined = isIdentityColumn
          ? { kind: 'function', expression: 'autoincrement()' }
          : rawDefault !== undefined
            ? parsePostgresDefault(rawDefault, resolvedNativeType)
            : undefined;
        columns[colRow.column_name] = {
          name: colRow.column_name,
          nativeType,
          nullable: colRow.is_nullable === 'YES',
          ...ifDefined('default', rawDefault),
          ...ifDefined('many', many),
          resolvedNativeType,
          ...ifDefined('resolvedDefault', resolvedDefault),
        };
      }

      // Process primary key
      const pkRows = [...(pksByTable.get(tableName) ?? [])];
      const primaryKeyColumns = pkRows
        .sort((a, b) => a.ordinal_position - b.ordinal_position)
        .map((row) => row.column_name);
      const primaryKey: PrimaryKeyInput | undefined =
        primaryKeyColumns.length > 0
          ? {
              columns: primaryKeyColumns,
              ...(pkRows[0]?.constraint_name ? { name: pkRows[0].constraint_name } : {}),
              dependsOn: postgresColumnDependsOn(schema, tableName, primaryKeyColumns),
            }
          : undefined;

      // Process foreign keys
      const foreignKeysMap = new Map<
        string,
        {
          columns: string[];
          referencedTable: string;
          referencedSchema: string;
          referencedColumns: string[];
          name: string;
          deleteRule: string;
          updateRule: string;
        }
      >();
      for (const fkRow of fksByTable.get(tableName) ?? []) {
        const existing = foreignKeysMap.get(fkRow.constraint_name);
        if (existing) {
          existing.columns.push(fkRow.column_name);
          existing.referencedColumns.push(fkRow.referenced_column_name);
        } else {
          foreignKeysMap.set(fkRow.constraint_name, {
            columns: [fkRow.column_name],
            referencedTable: fkRow.referenced_table_name,
            referencedSchema: fkRow.referenced_table_schema,
            referencedColumns: [fkRow.referenced_column_name],
            name: fkRow.constraint_name,
            deleteRule: fkRow.delete_rule,
            updateRule: fkRow.update_rule,
          });
        }
      }
      const foreignKeys: readonly SqlForeignKeyIRInput[] = Array.from(foreignKeysMap.values()).map(
        (fk) => ({
          columns: freezeStringArray(fk.columns),
          referencedTable: fk.referencedTable,
          referencedSchema: fk.referencedSchema,
          referencedColumns: freezeStringArray(fk.referencedColumns),
          name: fk.name,
          ...ifDefined('onDelete', mapReferentialAction(fk.deleteRule)),
          ...ifDefined('onUpdate', mapReferentialAction(fk.updateRule)),
          dependsOn: [
            postgresTableDependsOn(fk.referencedSchema, fk.referencedTable),
            ...postgresColumnDependsOn(schema, tableName, fk.columns),
          ],
        }),
      );

      // Process unique constraints (excluding those that are also PKs)
      const pkConstraints = pkConstraintsByTable.get(tableName) ?? new Set();
      const uniquesMap = new Map<string, { columns: string[]; name: string }>();
      for (const uniqueRow of uniquesByTable.get(tableName) ?? []) {
        // Skip if this constraint is also a primary key
        if (pkConstraints.has(uniqueRow.constraint_name)) {
          continue;
        }
        const existing = uniquesMap.get(uniqueRow.constraint_name);
        if (existing) {
          existing.columns.push(uniqueRow.column_name);
        } else {
          uniquesMap.set(uniqueRow.constraint_name, {
            columns: [uniqueRow.column_name],
            name: uniqueRow.constraint_name,
          });
        }
      }
      const uniques: readonly SqlUniqueIRInput[] = Array.from(uniquesMap.values()).map((uq) => ({
        columns: freezeStringArray(uq.columns),
        name: uq.name,
        dependsOn: postgresColumnDependsOn(schema, tableName, uq.columns),
      }));

      // Process indexes — keyed by catalog-unique index name, so two same-
      // tuple siblings (a unique index beside a redundant plain index) and
      // expression indexes all enter the tree at full fidelity.
      const indexesMap = new Map<
        string,
        {
          name: string;
          elements: { attname: string | null; elementDef: string | null }[];
          unique: boolean;
          where: string | null;
          type: string | undefined;
          options: Record<string, string> | undefined;
        }
      >();
      for (const idxRow of indexesByTable.get(tableName) ?? []) {
        const existing = indexesMap.get(idxRow.indexname);
        if (existing) {
          existing.elements.push({ attname: idxRow.attname, elementDef: idxRow.element_def });
        } else {
          // SqlIndexIR's constructor normalizes the btree default to absent
          // for both derivation paths.
          const indexType = idxRow.amname ?? undefined;
          const indexOptions = parsePgReloptions(idxRow.reloptions, idxRow.indexname);
          indexesMap.set(idxRow.indexname, {
            name: idxRow.indexname,
            elements: [{ attname: idxRow.attname, elementDef: idxRow.element_def }],
            unique: idxRow.indisunique,
            where: idxRow.where_predicate,
            type: indexType,
            options: indexOptions,
          });
        }
      }
      const indexes: readonly SqlIndexIRInput[] = Array.from(indexesMap.values()).map((idx) => {
        // An expression element has attnum 0, which the attribute LEFT JOIN
        // cannot resolve — its attname is null. Any such element makes the
        // whole index an expression node: the entire element list (real
        // columns included) is carried as one opaque reprinted string.
        const isExpression = idx.elements.some((el) => el.attname === null);
        const columnNames = idx.elements.flatMap((el) => (el.attname !== null ? [el.attname] : []));
        const base = {
          naming: namingOfLiveName(idx.name),
          where: idx.where ?? undefined,
          unique: idx.unique,
          partial: idx.where !== null,
          type: idx.type,
          options: idx.options,
          annotations: undefined,
          // Expression indexes stamp chains to every column of the table —
          // the opaque expression is never parsed, so the deterministic
          // over-approximation keeps drops ordered.
          dependsOn: postgresColumnDependsOn(
            schema,
            tableName,
            isExpression ? Object.keys(columns) : columnNames,
          ),
        };
        return isExpression
          ? { ...base, expression: idx.elements.map((el) => el.elementDef ?? '').join(', ') }
          : { ...base, columns: Object.freeze([...columnNames]) };
      });

      // Every check row becomes a node — nothing is skipped. `namingOfLiveName`
      // makes a shape-only claim: a wire-shaped name gets the wire arm so the
      // rename pass can pair it by prefix, but the hash is never recomputed from
      // the introspected body. The differ always lets the contract-derived side
      // choose the comparison, so that claim never suppresses one.
      const checksForTable: SqlCheckConstraintIRInput[] = (checksByTable.get(tableName) ?? []).map(
        (checkRow) => ({
          naming: namingOfLiveName(checkRow.constraint_name),
          expression: checkRow.check_expression,
          // Every column of the table — the predicate is opaque, so which
          // columns it constrains is unknowable here. Postgres drops a check
          // along with any column it covers, so the check must be torn down
          // first.
          dependsOn: postgresColumnDependsOn(schema, tableName, Object.keys(columns)),
        }),
      );

      tableInputs[tableName] = {
        name: tableName,
        columns,
        ...ifDefined('primaryKey', primaryKey),
        foreignKeys,
        uniques,
        indexes,
        ...ifDefined('checks', checksForTable.length > 0 ? checksForTable : undefined),
      };
    }

    const nativeEnumResult = await driver.query<{ typname: string; enumvalues: unknown }>(
      `SELECT t.typname, array_agg(e.enumlabel ORDER BY e.enumsortorder) AS enumvalues
         FROM pg_catalog.pg_type t
         JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
         JOIN pg_catalog.pg_enum e ON e.enumtypid = t.oid
         WHERE t.typtype = 'e'
           AND n.nspname = $1
         GROUP BY t.typname
         ORDER BY t.typname`,
      [schema],
    );
    const enums = nativeEnumResult.rows.map(
      (r) =>
        new PostgresNativeEnumSchemaNode({
          typeName: r.typname,
          namespaceId: schema,
          members: parsePgNameArray(r.enumvalues),
        }),
    );
    const policiesResult = await driver.query<{
      schemaname: string;
      tablename: string;
      policyname: string;
      cmd: string;
      // `pg_policies.roles` is raw Postgres array text, not a JS array.
      roles: string;
      qual: string | null;
      with_check: string | null;
      permissive: string;
    }>(
      `SELECT schemaname, tablename, policyname, cmd, roles, qual, with_check, permissive
       FROM pg_catalog.pg_policies
       WHERE schemaname = $1
       ORDER BY tablename, policyname`,
      [schema],
    );
    const policiesByTable = new Map<string, PostgresPolicySchemaNode[]>();
    for (const row of policiesResult.rows) {
      const operation = mapPgCmd(row.cmd);
      const policyRoles = [
        ...new Set(parsePgNameArray(row.roles).map((r) => r.toLowerCase())),
      ].sort();
      const permissive = row.permissive.toUpperCase() === 'PERMISSIVE';
      const policy = new PostgresPolicySchemaNode({
        naming: namingOfLiveName(row.policyname),
        tableName: row.tablename,
        namespaceId: row.schemaname,
        operation,
        roles: policyRoles,
        using: row.qual ?? undefined,
        withCheck: row.with_check ?? undefined,
        permissive,
        dependsOn: [
          postgresTableDependsOn(row.schemaname, row.tablename),
          ...policyRoles.map(postgresRoleDependsOn),
        ],
      });
      const list = policiesByTable.get(row.tablename) ?? [];
      list.push(policy);
      policiesByTable.set(row.tablename, list);
    }

    // RLS enablement is a table attribute (`pg_class.relrowsecurity`), not a
    // function of the policy set — a table can have RLS on with zero
    // policies (deny-all) or policies present with RLS off. relkind covers
    // both plain ('r') and partitioned ('p') tables: the table listing above
    // (`information_schema.tables`, BASE TABLE) includes partitioned parents,
    // and Postgres supports RLS on them.
    //
    // Kept as a SEPARATE query from the table listing on purpose. Folding
    // relrowsecurity into the listing would mean replacing
    // `information_schema.tables` (which filters by the connection role's
    // grants) with a raw `pg_class` scan (which does not), changing WHICH
    // tables the introspection returns — a real behavior shift, not a
    // cleanup, and one the offline golden-diff can't catch (introspection is
    // live-only). The only cost of two queries is the concurrent-DDL window:
    // a table listed but missed by this scan defaults (`?? false`) to
    // RLS-off. That default is fail-safe — the worst case downstream is a
    // spurious ENABLE (idempotent), never a spurious DISABLE.
    const rlsEnabledResult = await driver.query<{ tablename: string; rls_enabled: boolean }>(
      `SELECT c.relname AS tablename, c.relrowsecurity AS rls_enabled
         FROM pg_catalog.pg_class c
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = $1
           AND c.relkind IN ('r', 'p')
         ORDER BY c.relname`,
      [schema],
    );
    const rlsEnabledByTable = new Map<string, boolean>(
      rlsEnabledResult.rows.map((row) => [row.tablename, row.rls_enabled]),
    );

    const tables: Record<string, PostgresTableSchemaNode> = {};
    for (const [tableName, input] of Object.entries(tableInputs)) {
      tables[tableName] = new PostgresTableSchemaNode({
        ...input,
        policies: policiesByTable.get(tableName) ?? [],
        rlsEnabled: rlsEnabledByTable.get(tableName) ?? false,
      });
    }

    const namespace = new PostgresNamespaceSchemaNode({
      schemaName: schema,
      tables,
      nativeEnums: enums,
    });
    return { namespace, pgVersion: await this.getPostgresVersion(driver) };
  }

  /**
   * Gets the Postgres version from the database.
   */
  private async getPostgresVersion(driver: SqlControlDriverInstance<'postgres'>): Promise<string> {
    const result = await driver.query<{ version: string }>('SELECT version() AS version', []);
    const versionString = result.rows[0]?.version ?? '';
    // Extract version number from "PostgreSQL 15.1 ..." format
    const match = versionString.match(/PostgreSQL (\d+\.\d+)/);
    return match?.[1] ?? 'unknown';
  }
}

/**
 * Normalises a `name[]` column value from Postgres catalog views such as
 * `pg_policies.roles` and aggregate queries over `pg_enum.enumlabel`.
 *
 * Control-plane queries use the Postgres driver's raw-text parser policy for
 * array OIDs, so this helper accepts raw Postgres array literals only. A native
 * JS array at this boundary means the caller bypassed target-owned framing and
 * is rejected rather than normalized as a second representation.
 *
 * The parser honors Postgres array-literal quoting: an element
 * containing a comma, quote, backslash, brace, or significant whitespace is
 * emitted double-quoted with `\"` / `\\` escapes, and unquoted elements are
 * whitespace-trimmed — so a label like `in progress` or `say "hi"` parses to
 * its true value instead of being split or kept escaped.
 */
export function parsePgNameArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    throw new TypeError(`expected raw text for a Postgres array, got ${typeof value}`);
  }
  if (typeof value !== 'string') {
    return [];
  }
  return parsePostgresListText(value).map((entry: unknown) => String(entry));
}

/**
 * Maps `pg_policies.cmd` text values to the `RlsPolicyOperation` union.
 * The `pg_policies` view renders the internal command code as an uppercase
 * English keyword; this function lowercases to match the IR type.
 */
function mapPgCmd(cmd: string): RlsPolicyOperation {
  switch (cmd.toUpperCase()) {
    case 'SELECT':
      return 'select';
    case 'INSERT':
      return 'insert';
    case 'UPDATE':
      return 'update';
    case 'DELETE':
      return 'delete';
    default:
      return 'all';
  }
}

/**
 * Extracts the namespace coordinate ids declared on a contract's storage,
 * or returns an empty array when no contract (or no storage / namespaces)
 * is present. Used by `PostgresControlAdapter.introspect` to decide
 * between the multi-namespace walk and the single-schema fallback.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function freezeStringArray(values: readonly string[]): readonly string[] {
  return Object.freeze([...values]);
}

function extractContractNamespaceIds(contract: unknown): readonly string[] {
  if (!isRecord(contract)) return [];
  const storage = contract['storage'];
  if (!isRecord(storage)) return [];
  const namespaces = storage['namespaces'];
  if (!isRecord(namespaces)) return [];
  return Object.keys(namespaces);
}

function normalizeFormattedType(formattedType: string, dataType: string, udtName: string): string {
  if (formattedType.endsWith('[]')) {
    return `${normalizeFormattedType(formattedType.slice(0, -2), dataType, udtName)}[]`;
  }
  if (formattedType === 'integer') {
    return 'int4';
  }
  if (formattedType === 'smallint') {
    return 'int2';
  }
  if (formattedType === 'bigint') {
    return 'int8';
  }
  if (formattedType === 'real') {
    return 'float4';
  }
  if (formattedType === 'double precision') {
    return 'float8';
  }
  if (formattedType === 'boolean') {
    return 'bool';
  }
  if (formattedType.startsWith('varchar')) {
    return formattedType.replace('varchar', 'character varying');
  }
  if (formattedType.startsWith('bpchar')) {
    return formattedType.replace('bpchar', 'character');
  }
  if (formattedType.startsWith('varbit')) {
    return formattedType.replace('varbit', 'bit varying');
  }
  if (dataType === 'timestamp with time zone' || udtName === 'timestamptz') {
    return formattedType.replace('timestamp', 'timestamptz').replace(' with time zone', '').trim();
  }
  if (dataType === 'timestamp without time zone' || udtName === 'timestamp') {
    return formattedType.replace(' without time zone', '').trim();
  }
  if (dataType === 'time with time zone' || udtName === 'timetz') {
    return formattedType.replace('time', 'timetz').replace(' with time zone', '').trim();
  }
  if (dataType === 'time without time zone' || udtName === 'time') {
    return formattedType.replace(' without time zone', '').trim();
  }
  // Only dataType === 'USER-DEFINED' should ever be quoted, but this should be safe without
  // checking that explicitly either way
  if (formattedType.startsWith('"') && formattedType.endsWith('"')) {
    return formattedType.slice(1, -1);
  }
  return formattedType;
}

/**
 * The five standard PostgreSQL referential action rules as returned by
 * `information_schema.referential_constraints.delete_rule` / `update_rule`.
 */
type PgReferentialActionRule = 'NO ACTION' | 'RESTRICT' | 'CASCADE' | 'SET NULL' | 'SET DEFAULT';

const PG_REFERENTIAL_ACTION_MAP: Record<PgReferentialActionRule, SqlReferentialAction> = {
  'NO ACTION': 'noAction',
  RESTRICT: 'restrict',
  CASCADE: 'cascade',
  'SET NULL': 'setNull',
  'SET DEFAULT': 'setDefault',
};

/**
 * Maps a Postgres referential action rule to the canonical SqlReferentialAction.
 * Returns undefined for 'NO ACTION' (the database default) to keep the IR sparse.
 * Throws for unrecognized rules to prevent silent data loss.
 */
function isPgReferentialActionRule(rule: string): rule is PgReferentialActionRule {
  return Object.hasOwn(PG_REFERENTIAL_ACTION_MAP, rule);
}

function mapReferentialAction(rule: string): SqlReferentialAction | undefined {
  if (!isPgReferentialActionRule(rule)) {
    throw adapterError(
      'CONTRACT.INTROSPECTION_UNSUPPORTED',
      `Unknown PostgreSQL referential action rule: "${rule}". Expected one of: NO ACTION, RESTRICT, CASCADE, SET NULL, SET DEFAULT.`,
      { meta: { rule } },
    );
  }
  const mapped = PG_REFERENTIAL_ACTION_MAP[rule];
  if (mapped === 'noAction') return undefined;
  return mapped;
}

/**
 * A FK/policy dependency chain, mirroring the shape the expected-side
 * derivation stamps (`contractToPostgresDatabaseSchemaNode`): the database
 * root's fixed sentinel id, then the namespace, then the table.
 */
function postgresTableDependsOn(namespaceId: string, tableName: string): SchemaNodeRef {
  return [
    { nodeKind: PostgresSchemaNodeKind.database, id: 'database' },
    { nodeKind: PostgresSchemaNodeKind.namespace, id: namespaceId },
    { nodeKind: PostgresSchemaNodeKind.table, id: tableName },
  ];
}

/** A policy's dependency chain onto one of the roles it grants to. */
function postgresRoleDependsOn(role: string): SchemaNodeRef {
  return [
    { nodeKind: PostgresSchemaNodeKind.database, id: 'database' },
    { nodeKind: PostgresSchemaNodeKind.role, id: role },
  ];
}

/**
 * The chains from a table-child object (foreign key, index, unique, primary
 * key) to each of the own columns it is built on — the introspection-side
 * mirror of `contractToPostgresDatabaseSchemaNode`'s `columnDependsOn`. An
 * object is dropped before the columns it covers.
 */
function postgresColumnDependsOn(
  namespaceId: string,
  tableName: string,
  columns: readonly string[],
): SchemaNodeRef[] {
  return columns.map((column) => [
    ...postgresTableDependsOn(namespaceId, tableName),
    { nodeKind: RelationalSchemaNodeKind.column, id: `column:${column}` },
  ]);
}

/**
 * Groups an array of objects by a specified key.
 * Returns a Map for O(1) lookup by group key.
 */
/**
 * Parses a `pg_class.reloptions` array into a `Record<string, string>`.
 *
 * Postgres returns reloptions as a `text[]` whose entries are `key=value`
 * strings; the value side is always a string regardless of the underlying
 * scalar type. The verifier compares contract options to introspected
 * options after coercing both sides to strings, so keeping the raw text
 * here is correct.
 *
 * Returns `undefined` when the input is null/empty (no WITH clause).
 */
export function parsePgReloptions(
  reloptions: unknown,
  indexName: string,
): Record<string, string> | undefined {
  if (Array.isArray(reloptions)) {
    throw new TypeError(`expected raw text for a Postgres array, got ${typeof reloptions}`);
  }
  if (reloptions === null || reloptions === undefined) {
    return undefined;
  }
  if (typeof reloptions !== 'string') {
    return undefined;
  }
  const entries = parsePostgresListText(reloptions).map((entry: unknown) => String(entry));
  if (entries.length === 0) {
    return undefined;
  }
  const result: Record<string, string> = {};
  for (const entry of entries) {
    const eq = entry.indexOf('=');
    if (eq === -1) {
      throw adapterError(
        'CONTRACT.INTROSPECTION_UNSUPPORTED',
        `Postgres introspection: malformed reloption entry "${entry}" on index "${indexName}" (expected "key=value")`,
        { meta: { entry, indexName } },
      );
    }
    const key = entry.slice(0, eq);
    const value = entry.slice(eq + 1);
    result[key] = value;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function groupBy<T, K extends keyof T>(items: readonly T[], key: K): Map<T[K], T[]> {
  const map = new Map<T[K], T[]>();
  for (const item of items) {
    const groupKey = item[key];
    let group = map.get(groupKey);
    if (!group) {
      group = [];
      map.set(groupKey, group);
    }
    group.push(item);
  }
  return map;
}

// ---------------------------------------------------------------------------
// pgRenderDdlExecuteRequest — independent DDL walker for lowerToExecuteRequest
// ---------------------------------------------------------------------------

function pgIsTextLikeNativeType(nativeType: string): boolean {
  return (
    nativeType === 'text' ||
    nativeType === 'varchar' ||
    nativeType.startsWith('varchar(') ||
    nativeType === 'character varying' ||
    nativeType.startsWith('character varying(') ||
    nativeType === 'char' ||
    nativeType.startsWith('char(') ||
    nativeType === 'character' ||
    nativeType.startsWith('character(')
  );
}

function pgRenderArrayElement(el: unknown): string {
  if (el === null) return 'NULL';
  if (typeof el === 'number' || typeof el === 'boolean') return String(el);
  if (typeof el === 'string') return `'${escapeLiteral(el)}'`;
  return `'${escapeLiteral(JSON.stringify(el))}'`;
}

function pgRenderArrayLiteral(elements: unknown[]): string {
  if (elements.length === 0) return "'{}'";
  return `ARRAY[${elements.map(pgRenderArrayElement).join(', ')}]`;
}

function pgInlineLiteral(wire: unknown, nativeType: string): string {
  if (wire === null) return 'NULL';
  if (typeof wire === 'boolean') return wire ? 'true' : 'false';
  if (typeof wire === 'number') {
    if (!Number.isFinite(wire)) {
      throw adapterError(
        'CONTRACT.DEFAULT_INVALID',
        `pgRenderDdlExecuteRequest: non-finite number wire value ${String(wire)} cannot be emitted as a DEFAULT literal for native type "${nativeType}"`,
        { meta: { nativeType } },
      );
    }
    return String(wire);
  }
  if (typeof wire === 'bigint') return String(wire);
  if (wire instanceof Date) {
    if (Number.isNaN(wire.getTime())) {
      throw adapterError(
        'CONTRACT.DEFAULT_INVALID',
        `pgRenderDdlExecuteRequest: invalid Date value cannot be emitted as a DEFAULT literal for native type "${nativeType}"`,
        { meta: { nativeType } },
      );
    }
    const quoted = `'${escapeLiteral(wire.toISOString())}'`;
    return pgIsTextLikeNativeType(nativeType) ? quoted : `${quoted}::${nativeType}`;
  }
  if (typeof wire === 'string') {
    const quoted = `'${escapeLiteral(wire)}'`;
    return pgIsTextLikeNativeType(nativeType) ? quoted : `${quoted}::${nativeType}`;
  }
  if (wire instanceof Uint8Array) {
    const hex = Array.from(wire)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return `'\\x${hex}'::${nativeType}`;
  }
  if (Array.isArray(wire) && nativeType.endsWith('[]')) {
    return pgRenderArrayLiteral(wire);
  }
  if (typeof wire === 'object') {
    const quoted = `'${escapeLiteral(JSON.stringify(wire))}'`;
    return `${quoted}::${nativeType}`;
  }
  throw adapterError(
    'CONTRACT.PACK_CONTRIBUTION_INVALID',
    `pgRenderDdlExecuteRequest: unexpected wire type "${typeof wire}" for native type "${nativeType}"`,
    { meta: { wireType: typeof wire, nativeType } },
  );
}

const SERIAL_FAMILY_TYPES = new Set([
  'serial',
  'serial4',
  'bigserial',
  'serial8',
  'smallserial',
  'serial2',
]);

async function pgRenderDdlColumnDefault(
  def: LiteralColumnDefault | FunctionColumnDefault,
  nativeType: string,
  codecLookup: CodecLookup,
  codecRef: CodecRef | undefined,
): Promise<string> {
  if (def.kind === 'function') {
    if (def.expression === 'autoincrement()') {
      if (!SERIAL_FAMILY_TYPES.has(nativeType.toLowerCase())) {
        throw postgresError(
          'CONTRACT.DEFAULT_INVALID',
          `Column type "${nativeType}" has an autoincrement() default but is not a SERIAL-family pseudo-type. ` +
            'Autoincrement columns must declare their type as SERIAL (or SERIAL4), BIGSERIAL (or SERIAL8), ' +
            `or SMALLSERIAL (or SERIAL2) — e.g. col(name, "SERIAL", { default: fn("autoincrement()") }).`,
          { meta: { nativeType } },
        );
      }
      return '';
    }
    return `DEFAULT (${def.expression})`;
  }
  if (codecRef !== undefined) {
    const codec = codecLookup.get(codecRef.codecId);
    if (codec !== undefined) {
      // A literal default reaches here either as the canonical JSON a
      // contract stores or as the value an authoring surface built, and only
      // the first needs reading back: `pg/int8@1` stores decimal text for a
      // `bigint`, which `encode` does not take. A `Date` is the one authored
      // value JSON has no notation for, so it is the one that arrives as
      // itself.
      const value = def.value instanceof Date ? def.value : codec.decodeJson(def.value);
      const wire = await codec.encode(value, {});
      return `DEFAULT ${pgInlineLiteral(wire, nativeType)}`;
    }
  }
  // Fallback: codec-less literal defaults follow RawSqlLiteral wire-scalar semantics.
  return `DEFAULT ${pgInlineLiteral(def.value, nativeType)}`;
}

async function pgRenderDdlColumn(column: DdlColumn, codecLookup: CodecLookup): Promise<string> {
  const parts = [quoteIdentifier(column.name), column.type];
  if (column.default) {
    const clause = await pgRenderDdlColumnDefault(
      column.default,
      column.type,
      codecLookup,
      column.codecRef,
    );
    if (clause.length > 0) parts.push(clause);
  }
  if (column.notNull) parts.push('NOT NULL');
  if (column.primaryKey) parts.push('PRIMARY KEY');
  return parts.join(' ');
}

function pgRenderDdlConstraint(constraint: DdlTableConstraint): string {
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
    return `CONSTRAINT ${quoteIdentifier(constraint.name)} CHECK (${constraint.expression})`;
  }
  const cols = constraint.columns.map(quoteIdentifier).join(', ');
  if (constraint.name !== undefined) {
    return `CONSTRAINT ${quoteIdentifier(constraint.name)} UNIQUE (${cols})`;
  }
  return `UNIQUE (${cols})`;
}

async function pgRenderCreateTable(
  node: PostgresCreateTable,
  codecLookup: CodecLookup,
): Promise<SqlExecuteRequest> {
  const ifNotExists = node.ifNotExists ? 'IF NOT EXISTS ' : '';
  const tableRef = node.schema
    ? `${quoteIdentifier(node.schema)}.${quoteIdentifier(node.table)}`
    : quoteIdentifier(node.table);
  const columnDefs = await Promise.all(
    node.columns.map((col: DdlColumn) => pgRenderDdlColumn(col, codecLookup)),
  );
  const constraintDefs =
    node.constraints !== undefined ? node.constraints.map(pgRenderDdlConstraint) : [];
  const allDefs = [...columnDefs, ...constraintDefs].join(',\n  ');
  return {
    sql: `CREATE TABLE ${ifNotExists}${tableRef} (\n  ${allDefs}\n)`,
    params: [],
  };
}

function pgRenderCreateSchema(node: PostgresCreateSchema): SqlExecuteRequest {
  const ifNotExists = node.ifNotExists ? 'IF NOT EXISTS ' : '';
  return {
    sql: `CREATE SCHEMA ${ifNotExists}${quoteIdentifier(node.schema)}`,
    params: [],
  };
}

function pgRenderCreateType(node: PostgresCreateType): SqlExecuteRequest {
  const typeRef = node.schema
    ? `${quoteIdentifier(node.schema)}.${quoteIdentifier(node.name)}`
    : quoteIdentifier(node.name);
  const values = node.values.map((value: string) => `'${escapeLiteral(value)}'`).join(', ');
  return {
    sql: `CREATE TYPE ${typeRef} AS ENUM (${values})`,
    params: [],
  };
}

function pgRenderDropType(node: PostgresDropType): SqlExecuteRequest {
  const typeRef = node.schema
    ? `${quoteIdentifier(node.schema)}.${quoteIdentifier(node.name)}`
    : quoteIdentifier(node.name);
  return {
    sql: `DROP TYPE ${typeRef}`,
    params: [],
  };
}

async function pgRenderAlterTable(
  node: PostgresAlterTable,
  codecLookup: CodecLookup,
): Promise<SqlExecuteRequest> {
  const tableRef = node.schema
    ? `${quoteIdentifier(node.schema)}.${quoteIdentifier(node.table)}`
    : quoteIdentifier(node.table);
  const actionVisitor: AlterTableActionVisitor<Promise<string>> = {
    async addColumn(action: AddColumnAction): Promise<string> {
      const colFragment = await pgRenderDdlColumn(action.column, codecLookup);
      return `ADD COLUMN ${colFragment}`;
    },
    dropDefault(action: DropDefaultAction): Promise<string> {
      return Promise.resolve(`ALTER COLUMN ${quoteIdentifier(action.columnName)} DROP DEFAULT`);
    },
  };
  const actionSqls = await Promise.all(
    node.actions.map((action: AnyAlterTableAction) => action.accept(actionVisitor)),
  );
  return {
    sql: `ALTER TABLE ${tableRef} ${actionSqls.join(', ')}`,
    params: [],
  };
}

type MarkerUpsertSchema = {
  readonly space: ColumnDescriptor;
  readonly core_hash: ColumnDescriptor;
  readonly profile_hash: ColumnDescriptor;
  readonly contract_json: ColumnDescriptor;
  readonly canonical_version: ColumnDescriptor;
  readonly updated_at: ColumnDescriptor;
  readonly app_tag: ColumnDescriptor;
  readonly meta: ColumnDescriptor;
  readonly invariants: ColumnDescriptor;
};

const POLICY_OPERATION_SQL: Record<RlsPolicyOperation, string> = {
  select: 'SELECT',
  insert: 'INSERT',
  update: 'UPDATE',
  delete: 'DELETE',
  all: 'ALL',
};

function pgRenderCreatePolicy(node: PostgresCreatePolicy): SqlExecuteRequest {
  const tableRef = `${quoteIdentifier(node.schema)}.${quoteIdentifier(node.table)}`;
  const permissiveness = node.permissive ? 'PERMISSIVE' : 'RESTRICTIVE';
  const command = POLICY_OPERATION_SQL[node.operation];
  const roles = node.roles.length === 0 ? 'PUBLIC' : node.roles.join(', ');
  let sql = `CREATE POLICY ${quoteIdentifier(node.name)} ON ${tableRef} AS ${permissiveness} FOR ${command} TO ${roles}`;
  if (node.using !== undefined) {
    sql += ` USING (${node.using})`;
  }
  if (node.withCheck !== undefined) {
    sql += ` WITH CHECK (${node.withCheck})`;
  }
  return { sql, params: [] };
}

function pgRenderDropPolicy(node: PostgresDropPolicy): SqlExecuteRequest {
  const tableRef = `${quoteIdentifier(node.schema)}.${quoteIdentifier(node.table)}`;
  return {
    sql: `DROP POLICY ${quoteIdentifier(node.name)} ON ${tableRef}`,
    params: [],
  };
}

function pgRenderAlterPolicyRename(node: PostgresAlterPolicyRename): SqlExecuteRequest {
  const tableRef = `${quoteIdentifier(node.schema)}.${quoteIdentifier(node.table)}`;
  return {
    sql: `ALTER POLICY ${quoteIdentifier(node.name)} ON ${tableRef} RENAME TO ${quoteIdentifier(node.newName)}`,
    params: [],
  };
}

/**
 * Renders one index reloption value: strings single-quote-escaped, finite
 * numbers verbatim, booleans in the `on`/`off` catalog spelling (the
 * canonical form the wire hash and the option equality commit to).
 */
function pgRenderIndexOptionValue(key: string, value: unknown): string {
  if (typeof value === 'string') return `'${escapeLiteral(value)}'`;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  throw postgresError(
    'CONTRACT.INDEX_INVALID',
    `Index option "${key}" must be a string, finite number, or boolean; got ${typeof value}`,
    { meta: { key, valueType: typeof value } },
  );
}

/** Qualifies an object name; an absent schema renders it unqualified (unbound namespace). */
function pgQualify(schema: string | undefined, name: string): string {
  return schema === undefined
    ? quoteIdentifier(name)
    : `${quoteIdentifier(schema)}.${quoteIdentifier(name)}`;
}

function pgRenderCreateIndex(node: PostgresCreateIndex): SqlExecuteRequest {
  const elementList =
    'columns' in node.elements
      ? node.elements.columns.map(quoteIdentifier).join(', ')
      : node.elements.expression;
  const unique = node.unique ? 'UNIQUE ' : '';
  const using = node.type !== undefined ? ` USING ${quoteIdentifier(node.type)}` : '';
  const withClause =
    node.options !== undefined && Object.keys(node.options).length > 0
      ? ` WITH (${Object.entries(node.options)
          .map(
            ([key, value]) => `${quoteIdentifier(key)} = ${pgRenderIndexOptionValue(key, value)}`,
          )
          .join(', ')})`
      : '';
  const whereClause = node.where !== undefined ? ` WHERE (${node.where})` : '';
  return {
    sql: `CREATE ${unique}INDEX ${quoteIdentifier(node.name)} ON ${pgQualify(node.schema, node.table)}${using} (${elementList})${withClause}${whereClause}`,
    params: [],
  };
}

function pgRenderDropIndex(node: PostgresDropIndex): SqlExecuteRequest {
  return {
    sql: `DROP INDEX ${pgQualify(node.schema, node.name)}`,
    params: [],
  };
}

function pgRenderAlterIndexRename(node: PostgresAlterIndexRename): SqlExecuteRequest {
  return {
    sql: `ALTER INDEX ${pgQualify(node.schema, node.from)} RENAME TO ${quoteIdentifier(node.to)}`,
    params: [],
  };
}

function pgRenderDisableRowLevelSecurity(node: PostgresDisableRowLevelSecurity): SqlExecuteRequest {
  const tableRef = `${quoteIdentifier(node.schema)}.${quoteIdentifier(node.table)}`;
  return {
    sql: `ALTER TABLE ${tableRef} DISABLE ROW LEVEL SECURITY`,
    params: [],
  };
}

async function pgRenderDdlExecuteRequest(
  ast: PostgresDdlNode,
  codecLookup: CodecLookup,
): Promise<SqlExecuteRequest> {
  const visitor = {
    createTable: (node: PostgresCreateTable) => pgRenderCreateTable(node, codecLookup),
    createSchema: (node: PostgresCreateSchema) => Promise.resolve(pgRenderCreateSchema(node)),
    createType: (node: PostgresCreateType) => Promise.resolve(pgRenderCreateType(node)),
    dropType: (node: PostgresDropType) => Promise.resolve(pgRenderDropType(node)),
    alterTable: (node: PostgresAlterTable) => pgRenderAlterTable(node, codecLookup),
    createPolicy: (node: PostgresCreatePolicy) => Promise.resolve(pgRenderCreatePolicy(node)),
    dropPolicy: (node: PostgresDropPolicy) => Promise.resolve(pgRenderDropPolicy(node)),
    alterPolicyRename: (node: PostgresAlterPolicyRename) =>
      Promise.resolve(pgRenderAlterPolicyRename(node)),
    createIndex: (node: PostgresCreateIndex) => Promise.resolve(pgRenderCreateIndex(node)),
    dropIndex: (node: PostgresDropIndex) => Promise.resolve(pgRenderDropIndex(node)),
    alterIndexRename: (node: PostgresAlterIndexRename) =>
      Promise.resolve(pgRenderAlterIndexRename(node)),
    disableRowLevelSecurity: (node: PostgresDisableRowLevelSecurity) =>
      Promise.resolve(pgRenderDisableRowLevelSecurity(node)),
  };
  return ast.accept(visitor);
}
