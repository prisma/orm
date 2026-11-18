import mariadbAdapter from '@internal/adapter-mariadb/runtime';
import { createMysqlStatic, type MysqlStaticFactory } from '@internal/mysql/static';
import mariadbTarget from '@internal/target-mariadb/runtime';
import type { MariadbTargetId } from '../runtime/mariadb';

const mariadbStaticEntry = createMysqlStatic({ target: mariadbTarget, adapter: mariadbAdapter });

/**
 * Validates an emitted MariaDB `contract.json` and returns it as the contract type the application names, ready to pass to `mariadb({ contract })` and `mariadbStatic({ contract })`. Clients built from the result do not validate it again.
 */
export const contractFromJson = mariadbStaticEntry.contractFromJson;

/** The query surfaces of a MariaDB client without a driver: `sql`, `raw`, `enums` and `toSql`. */
const mariadbStatic: MysqlStaticFactory<MariadbTargetId> = mariadbStaticEntry.staticContext;

export default mariadbStatic;
