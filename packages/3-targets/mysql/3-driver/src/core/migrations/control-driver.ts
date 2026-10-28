import { errorRuntime } from '@internal/errors/execution';
import type {
  ControlDriverConnectOptions,
  ControlDriverDescriptor,
} from '@internal/framework-components/control';
import type { SqlControlDriverInstance } from '@internal/sql-contract/types';
import { blindCast } from '@internal/utils/casts';
import { redactDatabaseUrl } from '@internal/utils/redact-db-url';
import { type Connection, type ConnectionOptions, createConnection } from 'mysql2/promise';
import { mysqlConnectionOptions, mysqlPoolSettings } from '../connection-options';
import { mysqlDriverDescriptorMeta } from '../descriptor-meta';
import { connectionLost, isFatal, normalizeMysqlError, statementError } from '../normalize-error';
import { positionalParams } from '../positional-params';
import { assertPreparedCount } from '../prepared-count';
import { serverText } from '../server-text';
import { SESSION_SETUP } from '../session-setup';

/**
 * A MySQL connection for the control plane. A statement with values runs as a server-side prepared statement, `execute()`, so a value never travels inside the SQL; SQL with no values, which the control plane writes itself, runs through the text protocol, `query()`, and reads every column as the text MySQL sends. `multipleStatements` stays off whatever the URL says.
 */
export class MysqlControlDriver implements SqlControlDriverInstance<'mysql'> {
  readonly familyId = 'sql' as const;
  readonly targetId = 'mysql' as const;

  #lost: Error | undefined;

  constructor(private readonly connection: Connection) {
    connection.on('error', (error: Error) => {
      this.#lost = error;
    });
  }

  /**
   * Runs `sql` and returns its rows. A statement without values runs over the text protocol and reads every column as the text MySQL sends. A statement with values runs as a prepared statement over the binary protocol, so an integer reads as a number and a date as the text MySQL prints: the same query returns rows of a different shape depending on whether it has values.
   */
  async query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ readonly rows: Row[] }> {
    if (this.#lost !== undefined) throw connectionLost(this.#lost);
    try {
      const statement = positionalParams(sql, params ?? []);
      const [result] =
        statement.values.length === 0
          ? await this.connection.query({ sql: statement.sql, typeCast: serverText })
          : await this.#executeChecked(statement.sql, statement.values);
      return {
        rows: Array.isArray(result)
          ? blindCast<Row[], 'mysql2 returns the rows a SELECT produces, shaped by the query'>(
              result,
            )
          : [],
      };
    } catch (error) {
      if (isFatal(error)) {
        this.#lost = error;
        throw connectionLost(error);
      }
      throw statementError(error, sql);
    }
  }

  async #executeChecked(sql: string, values: unknown[]) {
    assertPreparedCount(await this.connection.prepare(sql), values.length);
    return this.connection.execute({ sql, values });
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

async function connect(connectionOptions: ConnectionOptions): Promise<Connection> {
  const connection = await createConnection(connectionOptions);
  try {
    for (const statement of SESSION_SETUP) await connection.query(statement);
    return connection;
  } catch (error) {
    await connection.end().catch(() => {});
    throw error;
  }
}

const mysqlDriverDescriptor: ControlDriverDescriptor<'sql', 'mysql', MysqlControlDriver> = {
  ...mysqlDriverDescriptorMeta,
  async create(url: string, options?: ControlDriverConnectOptions): Promise<MysqlControlDriver> {
    const connectionOptions = {
      ...mysqlConnectionOptions(url, options?.connectTimeoutMs),
      maxPreparedStatements: mysqlPoolSettings(url).statementCacheSize,
    };
    try {
      return new MysqlControlDriver(await connect(connectionOptions));
    } catch (error) {
      const normalized = normalizeMysqlError(error);
      throw errorRuntime('DRIVER.CONNECTION_FAILED', 'Database connection failed', {
        why: normalized instanceof Error ? normalized.message : String(normalized),
        fix: 'Verify the database URL, ensure the database is reachable, and confirm credentials/permissions',
        meta: { ...redactDatabaseUrl(url) },
        cause: error,
      });
    }
  },
};

export default mysqlDriverDescriptor;
