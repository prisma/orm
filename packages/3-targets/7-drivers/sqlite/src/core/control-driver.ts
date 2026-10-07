import { DatabaseSync } from 'node:sqlite';
import { errorRuntime } from '@internal/errors/execution';
import type { ControlDriverDescriptor } from '@internal/framework-components/control';
import type { SqlControlDriverInstance } from '@internal/sql-contract/types';
import { basename } from 'pathe';
import { normalizeSqliteError } from '../normalize-error';
import { sqliteParams } from '../sqlite-params';
import { sqliteDriverDescriptorMeta } from './descriptor-meta';

export class SqliteControlDriver implements SqlControlDriverInstance<'sqlite'> {
  readonly familyId = 'sql' as const;
  readonly targetId = 'sqlite' as const;

  constructor(
    private readonly db: DatabaseSync,
    private readonly location: string,
  ) {}

  async query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ readonly rows: Row[] }> {
    try {
      const stmt = this.db.prepare(sql);
      const rows = stmt.all(...sqliteParams(params)) as Row[];
      return { rows };
    } catch (error) {
      throw normalizeSqliteError(error);
    }
  }

  async databaseName(): Promise<string | undefined> {
    if (this.location === ':memory:' || this.location.length === 0) {
      return undefined;
    }
    const name = basename(this.location);
    return name.length > 0 ? name : undefined;
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

const sqliteDriverDescriptor: ControlDriverDescriptor<'sql', 'sqlite', SqliteControlDriver> = {
  ...sqliteDriverDescriptorMeta,
  async create(pathOrMemory: string): Promise<SqliteControlDriver> {
    try {
      const db = new DatabaseSync(pathOrMemory);
      db.exec('PRAGMA foreign_keys = ON');
      db.exec('PRAGMA busy_timeout = 5000');
      return new SqliteControlDriver(db, pathOrMemory);
    } catch (error) {
      throw errorRuntime('DRIVER.CONNECTION_FAILED', 'Database connection failed', {
        why: error instanceof Error ? error.message : String(error),
        fix: 'Verify the database file path exists and is accessible',
        meta: {
          path: pathOrMemory,
        },
        cause: error,
      });
    }
  },
};

export default sqliteDriverDescriptor;
