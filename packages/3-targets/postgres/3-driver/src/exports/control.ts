import { errorRuntime } from '@internal/errors/execution';
import type {
  ControlDriverConnectOptions,
  ControlDriverDescriptor,
} from '@internal/framework-components/control';
import type { SqlControlDriverInstance } from '@internal/sql-contract/types';
import { SqlQueryError } from '@internal/sql-errors';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { redactDatabaseUrl } from '@internal/utils/redact-db-url';
import { suppressIdleConnectionErrors } from '@internal/utils/suppress-idle-connection-errors';
import type { Client } from 'pg';
import { postgresDriverDescriptorMeta } from '../core/descriptor-meta';
import { normalizePgClientError, normalizePgConnectFailure } from '../normalize-error';
import { watchClientLoss } from '../pg-client-state';
import { controlTextTypes } from '../server-text-types';
import { createPgClient } from '../session-settings';

export class PostgresControlDriver implements SqlControlDriverInstance<'postgres'> {
  readonly familyId = 'sql' as const;
  readonly targetId = 'postgres' as const;

  private readonly client: Client;

  constructor(client: Client) {
    this.client = watchClientLoss(client);
  }

  async query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ readonly rows: Row[] }> {
    try {
      const query =
        params === undefined
          ? { text: sql, types: controlTextTypes }
          : { text: sql, values: [...params], types: controlTextTypes };
      const result = await this.client.query(query);
      return {
        rows: blindCast<Row[], 'pg query rows are shaped by the query result type'>(result.rows),
      };
    } catch (error) {
      throw normalizePgClientError(this.client, error);
    }
  }

  async databaseName(): Promise<string | undefined> {
    const result = await this.query<{ name: unknown }>('select current_database() as name');
    const name = result.rows[0]?.name;
    return typeof name === 'string' && name.length > 0 ? name : undefined;
  }

  async close(): Promise<void> {
    // On a dropped connection end() itself can reject; the caller already has
    // the real failure.
    await this.client.end().catch(() => {});
  }
}

/**
 * Postgres driver descriptor for CLI config.
 */
const postgresDriverDescriptor: ControlDriverDescriptor<'sql', 'postgres', PostgresControlDriver> =
  {
    ...postgresDriverDescriptorMeta,
    async create(
      url: string,
      options?: ControlDriverConnectOptions,
    ): Promise<PostgresControlDriver> {
      const client = watchClientLoss(
        suppressIdleConnectionErrors(
          createPgClient(
            {
              connectionString: url,
              ...ifDefined('connectionTimeoutMillis', options?.connectTimeoutMs),
            },
            options?.sessionSettings ?? {},
          ),
        ),
      );
      try {
        await client.connect();
        return new PostgresControlDriver(client);
      } catch (error) {
        const normalized = normalizePgConnectFailure(error);
        const redacted = redactDatabaseUrl(url);
        try {
          await client.end();
        } catch {
          // ignore
        }

        const codeFromSqlState = SqlQueryError.is(normalized) ? normalized.sqlState : undefined;
        const causeCode =
          'cause' in normalized && normalized.cause && typeof normalized.cause === 'object'
            ? blindCast<
                { readonly code?: unknown },
                'normalized connection cause is object-shaped'
              >(normalized.cause).code
            : undefined;
        const sqlState = codeFromSqlState ?? causeCode;

        throw errorRuntime('DRIVER.CONNECTION_FAILED', 'Database connection failed', {
          why: normalized.message,
          fix: 'Verify the database URL, ensure the database is reachable, and confirm credentials/permissions',
          meta: {
            ...ifDefined('sqlState', sqlState),
            ...redacted,
          },
          cause: error,
        });
      }
    },
  };

export default postgresDriverDescriptor;
