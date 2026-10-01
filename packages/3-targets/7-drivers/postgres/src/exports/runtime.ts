import type {
  RuntimeDriverDescriptor,
  RuntimeDriverInstance,
} from '@internal/framework-components/execution';
import type {
  SqlConnection,
  SqlDriver,
  SqlExecuteRequest,
  SqlExplainResult,
  SqlStatementStats,
} from '@internal/sql-relational-core/ast';
import { postgresDriverDescriptorMeta } from '../core/descriptor-meta';
import { driverError } from '../driver-error';
import {
  createBoundDriverFromBinding,
  type PostgresBinding,
  type PostgresDriverCreateOptions,
} from '../postgres-driver';

export type PostgresRuntimeDriver = RuntimeDriverInstance<'sql', 'postgres'> &
  SqlDriver<PostgresBinding>;

const USE_BEFORE_CONNECT_MESSAGE =
  'Postgres driver not connected. Call connect(binding) before acquireConnection or execute.';
const CLOSED_MESSAGE = 'Postgres driver is closed. Call connect(binding) to reconnect.';
const CONNECTION_LOST_MESSAGE =
  'Postgres connection lost or closed. Call connect(binding) to reconnect.';
const ALREADY_CONNECTED_MESSAGE =
  'Postgres driver already connected. Call close() before reconnecting with a new binding.';

function unboundQuery<Row>(notConnected: () => Error): AsyncIterable<Row> {
  return {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          throw notConnected();
        },
      };
    },
  };
}

type DisconnectedState = 'unbound' | 'closed' | 'connectionLost';

const notConnectedMessages: Record<DisconnectedState, string> = {
  unbound: USE_BEFORE_CONNECT_MESSAGE,
  closed: CLOSED_MESSAGE,
  connectionLost: CONNECTION_LOST_MESSAGE,
};

class PostgresUnboundDriverImpl implements PostgresRuntimeDriver {
  readonly familyId = 'sql' as const;
  readonly targetId = 'postgres' as const;

  #delegate: SqlDriver<PostgresBinding> | null = null;
  #disconnectedState: DisconnectedState = 'unbound';
  #cursorOpts: PostgresDriverCreateOptions['cursor'];
  #preparedStatements: PostgresDriverCreateOptions['preparedStatements'];

  constructor(options?: PostgresDriverCreateOptions) {
    this.#cursorOpts = options?.cursor;
    this.#preparedStatements = options?.preparedStatements;
  }

  get state(): 'unbound' | 'connected' | 'closed' {
    if (this.#delegate !== null) {
      return 'connected';
    }
    return this.#disconnectedState === 'unbound' ? 'unbound' : 'closed';
  }

  #notConnectedError(): Error {
    return driverError('DRIVER.NOT_CONNECTED', notConnectedMessages[this.#disconnectedState]);
  }

  #requireDelegate(): SqlDriver<PostgresBinding> {
    const delegate = this.#delegate;
    if (delegate === null) {
      throw this.#notConnectedError();
    }
    return delegate;
  }

  async connect(binding: PostgresBinding): Promise<void> {
    if (this.#delegate !== null) {
      throw driverError('DRIVER.ALREADY_CONNECTED', ALREADY_CONNECTED_MESSAGE, {
        bindingKind: binding.kind,
      });
    }
    this.#delegate = createBoundDriverFromBinding(binding, this.#cursorOpts, {
      preparedStatements: this.#preparedStatements,
    });
    this.#disconnectedState = 'unbound';
  }

  async acquireConnection(): Promise<SqlConnection> {
    const delegate = this.#requireDelegate();
    const connection = await delegate.acquireConnection();
    return this.#wrapConnection(connection, delegate);
  }

  /**
   * Wraps an acquired connection so that teardown paths which close the
   * underlying delegate (notably `destroy()` on a pgClient binding, where
   * the single socket means a destroyed connection invalidates the driver)
   * also reset our own `#delegate` reference. Without this, a failed
   * transaction rollback would leave the outer unbound wrapper reporting
   * `connected` while routing subsequent work to an already-ended delegate.
   */
  #wrapConnection(connection: SqlConnection, delegate: SqlDriver<PostgresBinding>): SqlConnection {
    const syncDelegateState = (): void => {
      if (this.#delegate === delegate && delegate.state === 'closed') {
        this.#delegate = null;
        this.#disconnectedState = 'connectionLost';
      }
    };
    const wrapped: SqlConnection = {
      beginTransaction: connection.beginTransaction.bind(connection),
      query: connection.query.bind(connection),
      execute: connection.execute.bind(connection),
      release: async () => {
        try {
          await connection.release();
        } finally {
          syncDelegateState();
        }
      },
      destroy: async (reason?: unknown) => {
        try {
          await connection.destroy(reason);
        } finally {
          syncDelegateState();
        }
      },
    };
    if (connection.explain) {
      wrapped.explain = connection.explain.bind(connection);
    }
    return wrapped;
  }

  async close(): Promise<void> {
    const delegate = this.#delegate;
    this.#delegate = null;
    this.#disconnectedState = 'closed';
    await delegate?.close();
  }

  query<Row = Record<string, unknown>>(request: SqlExecuteRequest): AsyncIterable<Row> {
    const delegate = this.#delegate;
    return delegate === null
      ? unboundQuery<Row>(() => this.#notConnectedError())
      : delegate.query<Row>(request);
  }

  async execute(request: SqlExecuteRequest): Promise<SqlStatementStats> {
    return this.#requireDelegate().execute(request);
  }

  async explain(request: SqlExecuteRequest): Promise<SqlExplainResult> {
    const delegate = this.#requireDelegate();
    const explain = delegate.explain;
    if (explain === undefined) {
      throw driverError('DRIVER.NOT_CONNECTED', USE_BEFORE_CONNECT_MESSAGE);
    }
    return explain.call(delegate, request);
  }
}

const postgresRuntimeDriverDescriptor: RuntimeDriverDescriptor<
  'sql',
  'postgres',
  PostgresDriverCreateOptions,
  PostgresRuntimeDriver
> = {
  ...postgresDriverDescriptorMeta,
  create(options?: PostgresDriverCreateOptions): PostgresRuntimeDriver {
    return new PostgresUnboundDriverImpl(options);
  },
};

export default postgresRuntimeDriverDescriptor;
export { suppressIdleConnectionErrors } from '@internal/utils/suppress-idle-connection-errors';
export type {
  PostgresBinding,
  PostgresDriverCreateOptions,
  QueryResult,
} from '../postgres-driver';
