import mariadbAdapter from '@internal/adapter-mariadb/runtime';
import type { Contract } from '@internal/contract/types';
import mariadbDriver from '@internal/driver-mariadb/runtime';
import {
  createMysqlClient,
  type MysqlClient,
  type MysqlOptions,
  mysqlUrlSchemes,
} from '@internal/mysql/runtime';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { CollectionClasses, NoCollectionClasses } from '@internal/sql-orm-client';
import mariadbTarget from '@internal/target-mariadb/runtime';

export type MariadbTargetId = 'mariadb';

export type MariadbOptions<
  TContract extends Contract<SqlStorage>,
  TCollections extends CollectionClasses = NoCollectionClasses,
> = MysqlOptions<TContract, TCollections, MariadbTargetId>;

export type MariadbClient<
  TContract extends Contract<SqlStorage>,
  TCollections extends CollectionClasses = NoCollectionClasses,
> = MysqlClient<TContract, TCollections, MariadbTargetId>;

/**
 * Creates a lazy MariaDB client, as `mysql()` creates a MySQL one. It takes a `mariadb://` or `mysql://` URL. The database opens on the first query or `connect()`.
 *
 * @example
 * ```ts
 * import { contractFromJson } from '@prisma/orm-mariadb/static';
 * import mariadb from '@prisma/orm-mariadb/runtime';
 * import type { Contract } from './contract.d';
 * import contractJson from './contract.json' with { type: 'json' };
 *
 * export const contract = contractFromJson<Contract>(contractJson);
 * export const db = mariadb({ contract, url: process.env.DATABASE_URL });
 * ```
 */
const mariadb: <
  TContract extends Contract<SqlStorage>,
  TCollections extends CollectionClasses = NoCollectionClasses,
>(
  options: MariadbOptions<TContract, TCollections>,
) => MariadbClient<TContract, TCollections> = createMysqlClient({
  target: mariadbTarget,
  adapter: mariadbAdapter,
  driver: mariadbDriver,
  urlSchemes: ['mariadb', ...mysqlUrlSchemes],
});

export default mariadb;
