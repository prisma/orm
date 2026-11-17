import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { MysqlMigrationBase } from '@internal/target-mysql/migration';

/** The base class of a MariaDB `migration.ts`. */
export abstract class MariadbMigration<
  Start extends Contract<SqlStorage> = Contract<SqlStorage>,
  End extends Contract<SqlStorage> = Contract<SqlStorage>,
> extends MysqlMigrationBase<'mariadb', Start, End> {
  readonly targetId = 'mariadb' as const;
}
