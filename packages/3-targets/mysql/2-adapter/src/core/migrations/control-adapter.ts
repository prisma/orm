import type { ContractMarkerRecord, LedgerEntryRecord } from '@internal/contract/types';
import { parseMarkerRowSafely, withMarkerReadErrorHandling } from '@internal/errors/execution';
import { contractColumns, readColumnDefault } from '@internal/family-sql/control';
import type { SqlControlAdapter } from '@internal/family-sql/control-adapter';
import { codecForRef, type DataType } from '@internal/framework-components/codec';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import type { SqlControlDriverInstance } from '@internal/sql-contract/types';
import {
  type AnyQueryAst,
  type DdlColumn,
  type DdlNode,
  isDdlNode,
  type LoweredStatement,
  type SqlExecuteRequest,
} from '@internal/sql-relational-core/ast';
import type { SqlSchemaIR } from '@internal/sql-schema-ir/types';
import type { MysqlCodecRegistry } from '@internal/target-mysql/codecs';
import {
  buildControlTableBootstrapQueries,
  buildSignMarkerBootstrapQueries,
} from '@internal/target-mysql/contract-free';
import { LEDGER_TABLE_NAME, MARKER_TABLE_NAME } from '@internal/target-mysql/control-tables';
import type { MysqlCreateTable, MysqlDdlNode, MysqlDdlVisitor } from '@internal/target-mysql/ddl';
import { mysqlQueryNotYetSupported } from '@internal/target-mysql/errors';
import { withMarkerLock } from '@internal/target-mysql/marker-lock';
import { structuredError } from '@internal/utils/structured-error';
import { decodeMysqlMarkerRow, readMarkerResult, readMarkerRows } from '../marker-read';
import { renderMysqlColumnDefault, renderMysqlCreateTable } from './ddl-renderer';
import { declaredIndexes } from './declared-indexes';
import { buildMysqlSchemaIR } from './introspection';
import { readMysqlCatalog } from './introspection-queries';
import {
  compareAndSwapMarkerRow,
  insertLedgerRow,
  insertMarkerRow,
  type MarkerDestination,
  readLedgerEntries,
  upsertMarkerRow,
} from './marker-ledger';

type Driver = SqlControlDriverInstance<'mysql'>;

/** A DDL node MySQL does not build, such as one another target's visitor accepts. */
function unsupportedDdl(ast: DdlNode): Error {
  return structuredError(
    'RUNTIME.DDL_UNSUPPORTED',
    `The MySQL control adapter cannot lower the DDL node "${ast.kind}".`,
    { meta: { surface: 'control-adapter', kind: ast.kind } },
  );
}

/**
 * The MySQL control adapter. It introspects the connection's database from `information_schema`, creates, reads and writes the marker and ledger tables, takes the marker lock, and runs work in a transaction. Query lowering refuses with `RUNTIME.AST_UNSUPPORTED`.
 */
export class MysqlControlAdapter implements SqlControlAdapter<'mysql'> {
  readonly familyId = 'sql' as const;
  readonly targetId = 'mysql' as const;
  readonly markerLocation = MARKER_TABLE_NAME;

  /** `declaredDataTypes` are the stack's data types, which introspection resolves each column's reported type over. */
  constructor(
    private readonly codecRegistry: MysqlCodecRegistry,
    private readonly declaredDataTypes: readonly DataType[],
  ) {}

  bootstrapControlTableQueries(): readonly MysqlDdlNode[] {
    return buildControlTableBootstrapQueries();
  }

  bootstrapSignMarkerQueries(): readonly MysqlDdlNode[] {
    return buildSignMarkerBootstrapQueries();
  }

  lower(ast: AnyQueryAst | DdlNode): LoweredStatement {
    if (isDdlNode(ast)) {
      throw structuredError(
        'RUNTIME.DDL_UNSUPPORTED',
        'lower() cannot lower DDL: DDL default literals require inline codec encoding, which is async. Use lowerToExecuteRequest().',
        { meta: { surface: 'control-adapter' } },
      );
    }
    throw mysqlQueryNotYetSupported('Lowering queries');
  }

  async lowerToExecuteRequest(ast: AnyQueryAst | MysqlDdlNode): Promise<SqlExecuteRequest> {
    if (!isDdlNode(ast)) throw mysqlQueryNotYetSupported('Lowering queries');
    if (typeof ast.accept !== 'function') throw unsupportedDdl(ast);
    const visitor: MysqlDdlVisitor<Promise<SqlExecuteRequest>> = {
      createTable: (node: MysqlCreateTable) => renderMysqlCreateTable(node, this.codecRegistry),
    };
    return ast.accept(
      new Proxy(visitor, {
        get: (target, method) =>
          Reflect.get(target, method) ?? (() => Promise.reject(unsupportedDdl(ast))),
      }),
    );
  }

  async renderColumnDefault(column: DdlColumn, table: string): Promise<string> {
    if (column.default === undefined) return '';
    return renderMysqlColumnDefault(
      column.default,
      column.type,
      this.codecRegistry,
      column.codecRef,
      {
        table,
        column: column.name,
      },
    );
  }

  async readMarker(driver: Driver, space: string): Promise<ContractMarkerRecord | null> {
    const result = await readMarkerResult(driver, space);
    return result.kind === 'present' ? result.record : null;
  }

  async readAllMarkers(driver: Driver): Promise<ReadonlyMap<string, ContractMarkerRecord>> {
    return withMarkerReadErrorHandling(
      async () => {
        const markers = new Map<string, ContractMarkerRecord>();
        for (const row of (await readMarkerRows(driver, undefined)) ?? []) {
          const space = String(row['space']);
          markers.set(
            space,
            parseMarkerRowSafely(row, () => decodeMysqlMarkerRow(row), {
              space,
              markerLocation: MARKER_TABLE_NAME,
            }),
          );
        }
        return markers;
      },
      { space: APP_SPACE_ID, markerLocation: MARKER_TABLE_NAME },
    );
  }

  async readLedger(driver: Driver, space?: string): Promise<readonly LedgerEntryRecord[]> {
    return withMarkerReadErrorHandling(() => readLedgerEntries(driver, space), {
      space: space ?? '*',
      markerLocation: LEDGER_TABLE_NAME,
    });
  }

  async insertMarker(driver: Driver, space: string, destination: MarkerDestination): Promise<void> {
    await insertMarkerRow(driver, space, destination);
  }

  async initMarker(driver: Driver, space: string, destination: MarkerDestination): Promise<void> {
    await upsertMarkerRow(driver, space, destination);
  }

  async updateMarker(
    driver: Driver,
    space: string,
    expectedFrom: string,
    destination: MarkerDestination,
  ): Promise<boolean> {
    return compareAndSwapMarkerRow(driver, space, expectedFrom, destination);
  }

  async writeLedgerEntry(
    driver: Driver,
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
    await insertLedgerRow(driver, space, entry);
  }

  /** Takes no lock: MySQL's `GET_LOCK` lives for the session, not the transaction, so {@link holdMarkerLock} takes it around the transaction instead. */
  async lockMarker(_driver: Driver): Promise<void> {}

  /** Takes `GET_LOCK` before `work` runs and releases it when `work` ends, so `db sign` creates the marker table, whose DDL would end a transaction, under the lock. */
  async holdMarkerLock<T>(driver: Driver, work: () => Promise<T>): Promise<T> {
    return withMarkerLock(driver, work);
  }

  async withTransaction<T>(driver: Driver, fn: () => Promise<T>): Promise<T> {
    return this.#inTransaction(driver, fn);
  }

  async #inTransaction<T>(driver: Driver, fn: () => Promise<T>): Promise<T> {
    await driver.query('START TRANSACTION');
    let result: T;
    try {
      result = await fn();
    } catch (error) {
      try {
        await driver.query('ROLLBACK');
      } catch (rollbackError) {
        if (error instanceof Error && error.cause === undefined) error.cause = rollbackError;
      }
      throw error;
    }
    await driver.query('COMMIT');
    return result;
  }

  async introspect(driver: Driver, contract?: unknown): Promise<SqlSchemaIR> {
    const columns = contractColumns(contract);
    return buildMysqlSchemaIR(
      await readMysqlCatalog(driver),
      this.declaredDataTypes,
      async (tableName, columnName, rawDefault) => {
        const column = columns.columnOf(undefined, tableName, columnName);
        const codec =
          column === undefined ? undefined : codecForRef(this.codecRegistry, column.codecRef);
        if (codec === undefined) return {};
        return readColumnDefault(
          codec,
          { literal: { kind: 'value', body: rawDefault }, raw: rawDefault },
          undefined,
        );
      },
      declaredIndexes(contract),
    );
  }
}
