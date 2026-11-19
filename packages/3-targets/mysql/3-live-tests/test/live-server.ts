import type { MysqlDriverCreateOptions, MysqlRuntimeDriver } from '@internal/driver-mysql/runtime';
import type { SqlControlAdapter } from '@internal/family-sql/control-adapter';
import type { ControlDriverDescriptor } from '@internal/framework-components/control';
import type { RuntimeDriverDescriptor } from '@internal/framework-components/execution';
import type { MysqlClient, MysqlOptions } from '@internal/mysql/runtime';
import type { SqlControlDriverInstance } from '@internal/sql-contract/types';
import type { NoCollectionClasses } from '@internal/sql-orm-client';
import type { LiveContract, LiveTargetId } from '#live-types';

/** The options a live test passes when it creates a client: all but the contract, which the server supplies. */
export type LiveClientOptions = Omit<
  MysqlOptions<LiveContract, NoCollectionClasses, LiveTargetId>,
  'contract'
>;

export type LiveClient = MysqlClient<LiveContract, NoCollectionClasses, LiveTargetId>;

/** Where the server's SQL or results differ from another's, stated by the runner that passes the server. */
export interface LiveExpectations {
  /** The statement an upsert that changes `role` sends. */
  readonly upsertStatement: string;
  /** What reading an ordered include larger than a packet does: fail, or return every row. */
  readonly oversizedOrderedInclude: 'fails' | 'returns every row';
  /** Whether `having` keeps a group whose mean of integers is 5/3 when it asks for a mean greater than 5/3. `having` compares the server's own `AVG`, a decimal each server rounds its own way, not the exact mean a projection reads. */
  readonly havingAboveExactMean: 'drops the group' | 'keeps the group';
  /** What an update or delete whose filter reads the table it writes does: the renderer refuses it, or the server runs it. */
  readonly writeReadingWrittenTable: 'refused' | 'runs';
  /** What a decimal `sum` in an include gives when the total needs more digits than the widest decimal holds: the exact total, or the largest value of its type, with no error or warning. */
  readonly includedSumPastWidestDecimal: 'exact' | 'the largest value';
}

/**
 * A server the ORM live suites run against: its name, the environment variable its URL is read from, the contract the suites use emitted for its target, a client of it, its control components, and what differs on it.
 */
export interface LiveServer {
  readonly displayName: string;
  readonly urlVariable: string;
  readonly contract: LiveContract;
  readonly client: (options: LiveClientOptions) => LiveClient;
  readonly controlAdapter: () => SqlControlAdapter<LiveTargetId>;
  readonly controlDriver: ControlDriverDescriptor<
    'sql',
    LiveTargetId,
    SqlControlDriverInstance<LiveTargetId>
  >;
  /** The runtime driver descriptor the client creates its driver with, which a test can watch. */
  readonly runtimeDriver: RuntimeDriverDescriptor<
    'sql',
    LiveTargetId,
    MysqlDriverCreateOptions,
    MysqlRuntimeDriver<LiveTargetId>
  >;
  readonly expected: LiveExpectations;
}
