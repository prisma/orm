import { MariadbMigration } from '@internal/target-mariadb/migration';
import { describe, expect, it } from 'vitest';
import { col, Migration, MigrationCLI, MysqlMigrationBase } from '../src/exports/migration';

describe("the MariaDB facade's migration module", () => {
  it("names MariaDB's migration class Migration and keeps the rest of MySQL's migration module", () => {
    expect({
      migration: Migration,
      extendsMysqlBase: Migration.prototype instanceof MysqlMigrationBase,
      migrationCli: typeof MigrationCLI,
      col: typeof col,
    }).toEqual({
      migration: MariadbMigration,
      extendsMysqlBase: true,
      migrationCli: 'function',
      col: 'function',
    });
  });
});
