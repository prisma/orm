import { mariadbAdapterContractContributions } from '@internal/adapter-mariadb/adapter';
import {
  createMysqlDefineContract,
  type MysqlDefineContract,
} from '@internal/mysql/contract-builder';
import mariadbPack from '@internal/target-mariadb/pack';

/** MariaDB's `defineContract`: MySQL's, applied to MariaDB's pack and adapter, so the contract carries target `mariadb` and MariaDB's capabilities. */
export const defineContract: MysqlDefineContract<
  typeof mariadbPack,
  typeof mariadbAdapterContractContributions
> = createMysqlDefineContract({
  target: mariadbPack,
  adapter: mariadbAdapterContractContributions,
});
