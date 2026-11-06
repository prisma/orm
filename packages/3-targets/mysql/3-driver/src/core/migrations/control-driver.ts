import { errorRuntime } from '@internal/errors/execution';
import type {
  ControlDriverConnectOptions,
  ControlDriverDescriptor,
} from '@internal/framework-components/control';
import type { SqlControlDriverInstance } from '@internal/sql-contract/types';
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
 * A MySQL connection for the control plane. It runs every statement as the runtime driver does, a user's `rawSql` migration step included: in one round trip over the text protocol, the package writing its values into it, one at a time in the order sent, under the runtime driver's per-client lock.
 */
export class MysqlControlDriver<TargetId extends string = 'mysql'>
  implements SqlControlDriverInstance<TargetId>
{
  readonly familyId = 'sql' as const;
  readonly targetId: TargetId;

  #lost: Error | undefined;

  constructor(
    private readonly connection: Connection,
    targetId: TargetId = blindCast<
      TargetId,
      'without a target id the driver is MySQL, the default of TargetId'
    >('mysql'),
  ) {
    this.targetId = targetId;
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
      const statement = statementFor(this.connection, sql, params ?? []);
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
      throw normalizeMysqlError(error);
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

/** The control driver descriptor of MySQL, or of a target that extends it, whose drivers carry `targetId`. */
export function createMysqlControlDriverDescriptor<TargetId extends string>(
  targetId: TargetId,
): ControlDriverDescriptor<'sql', TargetId, MysqlControlDriver<TargetId>> {
  return {
    ...mysqlDriverDescriptorMetaFor(targetId),
    create: (url, options) => connectControlDriver(url, options, targetId),
  };
}

async function connectControlDriver<TargetId extends string>(
  url: string,
  options: ControlDriverConnectOptions | undefined,
  targetId: TargetId,
): Promise<MysqlControlDriver<TargetId>> {
  const connectionOptions = mysqlConnectionOptions(url, {
    connectTimeoutMs: options?.connectTimeoutMs,
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
    return new MysqlControlDriver(connection, targetId);
  } catch (error) {
    const normalized = normalizeMysqlError(error);
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

const mysqlDriverDescriptor = createMysqlControlDriverDescriptor('mysql');

export default mysqlDriverDescriptor;
