import { errorRuntime } from '@internal/errors/execution';
import type {
  ControlDriverConnectOptions,
  ControlDriverDescriptor,
} from '@internal/framework-components/control';
import type { SqlControlDriverInstance } from '@internal/sql-contract/types';
import { mysqlTargetDescriptorMetaRuntime } from '@internal/target-mysql/descriptor-meta-runtime';
import type { MysqlRuntimeTargetMeta } from '@internal/target-mysql/runtime';
import { blindCast } from '@internal/utils/casts';
import { redactDatabaseUrl } from '@internal/utils/redact-db-url';
import { type Connection, createConnection } from 'mariadb';
import { acquireClientQueryLock } from '../client-query-lock';
import { mysqlConnectionOptions } from '../connection-options';
import { mysqlDriverDescriptorMetaFor } from '../descriptor-meta';
import { connectionFix, connectionLost, isFatal, normalizeMysqlError } from '../normalize-error';
import { applySessionSettings, sessionSettingsStatement } from '../session-settings';
import { statementFor } from '../statement';

/**
 * A connection for the control plane of MySQL, or of a target that extends it, carrying that target's id. It runs every statement as the runtime driver does, a user's `rawSql` migration step included: in one round trip over the text protocol, the package writing its values into it, one at a time in the order sent, under the runtime driver's per-client lock.
 */
class MysqlControlDriverFor<TargetId extends string> implements SqlControlDriverInstance<TargetId> {
  readonly familyId = 'sql' as const;

  #lost: Error | undefined;

  constructor(
    private readonly connection: Connection,
    readonly targetId: TargetId,
    private readonly displayName: string,
  ) {
    connection.on('error', (error: Error) => {
      this.#lost = error;
    });
  }

  /** Runs `sql` and returns its rows, every column as text and a binary column as bytes. */
  async query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ readonly rows: Row[] }> {
    const releaseLock = await acquireClientQueryLock(this.connection);
    try {
      if (this.#lost !== undefined) throw connectionLost(this.#lost);
      const statement = statementFor(this.connection, sql, params ?? [], this.displayName);
      const result: unknown = await this.connection.query(statement.sql, statement.values);
      return {
        rows: Array.isArray(result)
          ? blindCast<Row[], 'the package returns the rows a SELECT produces, shaped by the query'>(
              [...result],
            )
          : [],
      };
    } catch (error) {
      if (error instanceof Error && isFatal(error)) {
        this.#lost = error;
        throw connectionLost(error);
      }
      throw normalizeMysqlError(error, this.displayName);
    } finally {
      releaseLock();
    }
  }

  async databaseName(): Promise<string | undefined> {
    const { rows } = await this.query<{ name: unknown }>('SELECT DATABASE() AS name');
    const name = rows[0]?.name;
    return typeof name === 'string' && name.length > 0 ? name : undefined;
  }

  async close(): Promise<void> {
    await this.connection.end().catch(() => {});
  }
}

/** A MySQL connection for the control plane. */
export class MysqlControlDriver extends MysqlControlDriverFor<'mysql'> {
  constructor(connection: Connection) {
    super(connection, 'mysql', mysqlTargetDescriptorMetaRuntime.displayName);
  }
}

export interface MysqlControlDriverOptions<TargetId extends string> {
  /** The target's runtime metadata: its drivers carry its id and name it by its display name in their errors. */
  readonly target: Pick<MysqlRuntimeTargetMeta<TargetId>, 'targetId' | 'displayName'>;
}

/** The control driver descriptor of MySQL, or of a target that extends it. */
export function createMysqlControlDriverDescriptor<TargetId extends string>(
  options: MysqlControlDriverOptions<TargetId>,
): ControlDriverDescriptor<'sql', TargetId, SqlControlDriverInstance<TargetId>> {
  const { targetId, displayName } = options.target;
  return {
    ...mysqlDriverDescriptorMetaFor(targetId),
    create: (url, options) =>
      connectControlDriver(
        url,
        options,
        displayName,
        (connection) => new MysqlControlDriverFor(connection, targetId, displayName),
      ),
  };
}

async function connectControlDriver<Driver>(
  url: string,
  options: ControlDriverConnectOptions | undefined,
  displayName: string,
  driverFor: (connection: Connection) => Driver,
): Promise<Driver> {
  const connectionOptions = mysqlConnectionOptions(url, {
    connectTimeoutMs: options?.connectTimeoutMs,
    displayName,
  });
  const settings = sessionSettingsStatement(options?.sessionSettings ?? {});
  try {
    const connection = await createConnection(connectionOptions);
    if (settings !== undefined) {
      await applySessionSettings(connection, settings).catch(async (error: unknown) => {
        await connection.end().catch(() => {});
        throw error;
      });
    }
    return driverFor(connection);
  } catch (error) {
    const normalized = normalizeMysqlError(error, displayName);
    throw errorRuntime('DRIVER.CONNECTION_FAILED', 'Database connection failed', {
      why: normalized instanceof Error ? normalized.message : String(normalized),
      fix:
        connectionFix(error) ??
        'Verify the database URL, ensure the database is reachable, and confirm credentials/permissions',
      meta: { ...redactDatabaseUrl(url) },
      cause: error,
    });
  }
}

const mysqlDriverDescriptor: ControlDriverDescriptor<'sql', 'mysql', MysqlControlDriver> = {
  ...mysqlDriverDescriptorMetaFor('mysql'),
  create: (url, options) =>
    connectControlDriver(
      url,
      options,
      mysqlTargetDescriptorMetaRuntime.displayName,
      (connection) => new MysqlControlDriver(connection),
    ),
};

export default mysqlDriverDescriptor;
