import mysqlAdapter from '@internal/adapter-mysql/control';
import type { Contract as SqlContract } from '@internal/contract/types';
import mysqlDriver from '@internal/driver-mysql/control';
import sql from '@internal/family-sql/control';
import type { SqlControlAdapter } from '@internal/family-sql/control-adapter';
import {
  type ControlDriverDescriptor,
  createControlStack,
} from '@internal/framework-components/control';
import type { SqlControlDriverInstance, SqlStorage } from '@internal/sql-contract/types';
import type { NoCollectionClasses } from '@internal/sql-orm-client';
import mysqlTarget from '@internal/target-mysql/control';
import mysql, { type MysqlClient, type MysqlOptions } from '../../src/runtime/mysql';
import { contractFromJson } from '../../src/static/contract-from-json';
import type { Contract } from '../fixtures/generated/contract.d';
import contractJson from '../fixtures/generated/contract.json' with { type: 'json' };
import { countersContract, eventsContract, notesContract, ticksContract } from './live-contracts';

/** The options a live test passes when it creates a client: all but the contract, which the server supplies. */
export type LiveClientOptions<TargetId extends string> = Omit<
  MysqlOptions<Contract, NoCollectionClasses, TargetId>,
  'contract'
>;

type LiveClient<TContract extends SqlContract<SqlStorage>, TargetId extends string> = (
  options: LiveClientOptions<TargetId>,
) => MysqlClient<TContract, NoCollectionClasses, TargetId>;

/**
 * A server the MySQL ORM live tests run against, MySQL or MariaDB: its name, the environment variable its URL is read from, a client of it for each contract the tests use, built for its own target, and its control components.
 */
export interface LiveServer<TargetId extends string> {
  readonly name: 'MySQL' | 'MariaDB';
  readonly urlVariable: string;
  readonly example: LiveClient<Contract, TargetId>;
  readonly counters: LiveClient<typeof countersContract, TargetId>;
  readonly events: LiveClient<typeof eventsContract, TargetId>;
  readonly notes: LiveClient<typeof notesContract, TargetId>;
  readonly ticks: LiveClient<typeof ticksContract, TargetId>;
  /** The control adapter, which the tests use to write the marker. */
  readonly controlAdapter: () => SqlControlAdapter<TargetId>;
  /** The control driver, which the tests seed each database with. */
  readonly controlDriver: ControlDriverDescriptor<
    'sql',
    TargetId,
    SqlControlDriverInstance<TargetId>
  >;
}

const contract = contractFromJson<Contract>(contractJson);

export const mysqlLiveServer: LiveServer<'mysql'> = {
  name: 'MySQL',
  urlVariable: 'MYSQL_URL',
  example: (options) => mysql({ ...options, contract }),
  counters: (options) => mysql({ ...options, contract: countersContract }),
  events: (options) => mysql({ ...options, contract: eventsContract }),
  notes: (options) => mysql({ ...options, contract: notesContract }),
  ticks: (options) => mysql({ ...options, contract: ticksContract }),
  controlAdapter: () =>
    mysqlAdapter.create(
      createControlStack({
        family: sql,
        target: mysqlTarget,
        adapter: mysqlAdapter,
        driver: mysqlDriver,
      }),
    ),
  controlDriver: mysqlDriver,
};
