import mariadbAdapter from '@internal/adapter-mariadb/runtime';
import type { Contract } from '@internal/contract/types';
import { createMysqlStatic, mysqlContractValidation } from '@internal/mysql/static';
import type { SqlStorage } from '@internal/sql-contract/types';
import mariadbTarget from '@internal/target-mariadb/runtime';

const mariadbValidation = mysqlContractValidation(mariadbTarget.targetId);

/**
 * Validates an emitted MariaDB `contract.json` and returns it as the contract type the application names, ready to pass to `mariadb({ contract })` and `mariadbStatic({ contract })`. Clients built from the result do not validate it again.
 */
export function contractFromJson<TContract extends Contract<SqlStorage>>(json: unknown): TContract {
  return mariadbValidation.contractFromJson<TContract>(json);
}

/** The query surfaces of a MariaDB client without a driver: `sql`, `raw`, `enums` and `toSql`. */
const mariadbStatic = createMysqlStatic({ target: mariadbTarget, adapter: mariadbAdapter });

export default mariadbStatic;
