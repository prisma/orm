import { errorRuntime } from '@internal/errors/execution';
import type {
  ControlDriverConnectOptions,
  ControlDriverDescriptor,
} from '@internal/framework-components/control';
import type { SqlControlDriverInstance } from '@internal/sql-contract/types';
import { blindCast } from '@internal/utils/casts';
import { redactDatabaseUrl } from '@internal/utils/redact-db-url';
import { type Connection, createConnection } from 'mariadb';
import { mysqlConnectionOptions } from '../connection-options';
import { mysqlDriverDescriptorMeta } from '../descriptor-meta';
import { connectionFix, connectionLost, isFatal, normalizeMysqlError } from '../normalize-error';
import { positionalParams } from '../positional-params';
import { assertPreparedCount } from '../prepared-count';
import { serverText } from '../server-text';

/**
 * A MySQL connection for the control plane. A statement with values runs as a server-side prepared statement, so a value never travels inside the SQL. Any statement without values, a user's `rawSql` migration step included, runs through the text protocol, `query()`, because MySQL does not prepare some statements, such as `START TRANSACTION` and `LOCK TABLES`; with no values there is nothing written into the SQL to inject, and `multipleStatements` stays off. Either way every column reads as the text MySQL sends.
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

  /** Runs `sql` and returns its rows, every column as the text MySQL sends and a binary column as bytes. */
  async query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ readonly rows: Row[] }> {
    if (this.#lost !== undefined) throw connectionLost(this.#lost);
    try {
      const statement = positionalParams(sql, params ?? []);
      const result: unknown =
        statement.values.length === 0
          ? await this.connection.query(statement.sql)
          : await this.#executeChecked(statement.sql, statement.values);
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
    }
  }

  async #executeChecked(sql: string, values: unknown[]): Promise<unknown> {
    const statement = await this.connection.prepare(sql);
    try {
      assertPreparedCount(statement, values.length);
      return await statement.execute(values);
    } finally {
      statement.close();
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

const mysqlDriverDescriptor: ControlDriverDescriptor<'sql', 'mysql', MysqlControlDriver> = {
  ...mysqlDriverDescriptorMeta,
  async create(url: string, options?: ControlDriverConnectOptions): Promise<MysqlControlDriver> {
    const connectionOptions = {
      ...mysqlConnectionOptions(url, options?.connectTimeoutMs),
      typeCast: serverText,
    };
    try {
      return new MysqlControlDriver(await createConnection(connectionOptions));
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
  },
};

export default mysqlDriverDescriptor;
