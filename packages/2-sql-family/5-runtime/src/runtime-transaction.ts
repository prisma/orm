import {
  type ActivityParent,
  type AsyncIterableResult,
  type ClientActivityKind,
  type RuntimeExecuteOptions,
  runtimeError,
  type StartActivity,
  type TransactionActivityRun,
} from '@internal/framework-components/runtime';
import type {
  SqlConnection,
  SqlQueryable,
  SqlStatementStats,
  SqlTransaction,
} from '@internal/sql-relational-core/ast';
import type { SqlExecutionPlan, SqlQueryPlan } from '@internal/sql-relational-core/plan';
import { invariant } from '@internal/utils/assertions';
import { blindCast } from '@internal/utils/casts';
import {
  type ActivityHandle,
  type ActivitySource,
  type ActivitySourceTarget,
  activitySource,
  type HashablePlan,
} from './activity-handle';
import type { SqlMiddlewareContext } from './middleware/sql-middleware';
import {
  type PreparedStatementExecuteTarget,
  preparedStatementExecute,
} from './prepared/prepared-execute';
import {
  type PreparedStatementQueryTarget,
  preparedStatementQuery,
} from './prepared/prepared-query';
import type { PreparedExecutionImpl, PreparedStatementImpl } from './prepared/prepared-statement';
import type { PreparedExecution, PreparedStatement } from './prepared/types';
import type { ActivityRoute, RuntimeTransaction } from './sql-runtime';
import { type StackEntry, TransactionStack } from './transaction-stack';
import {
  type SettledTransactionTarget,
  type TransactionSettlementState,
  transactionSettlement,
} from './transaction-state';

type TransactionRun = TransactionActivityRun<SqlMiddlewareContext>;

export interface OpenTransaction {
  readonly activity: TransactionRun;
  readonly assertAcceptsStatements: () => void;
  readonly assertOpen: () => void;
}

export interface TransactionRuntime {
  route(driverTx: SqlTransaction, activity: TransactionRun): ActivityRoute;
  startActivity<K extends ClientActivityKind>(
    route: ActivityRoute,
    activity: StartActivity<K>,
  ): Promise<ActivityHandle<K>>;
  planContentHash(plan: HashablePlan, parent: ActivityParent): Promise<string>;
  startTransactionActivity(parent: ActivityParent): Promise<TransactionRun>;
  trackInFlight<T>(operation: () => Promise<T>): Promise<T>;
  register(queryable: SqlQueryable, transaction: OpenTransaction): void;
  unregister(queryable: SqlQueryable, transaction: OpenTransaction): void;
  markHeld(driverTx: SqlTransaction, driverSavepoint: SqlTransaction): void;
  onConnectionReleased(connection: SqlConnection, teardown: () => Promise<void>): void;
}

abstract class TransactionBase
  implements
    RuntimeTransaction,
    ActivitySourceTarget,
    PreparedStatementQueryTarget,
    PreparedStatementExecuteTarget
{
  abstract readonly signal: AbortSignal;
  readonly [activitySource]: ActivitySource;
  protected readonly runtime: TransactionRuntime;
  protected readonly driverTx: SqlTransaction;
  protected readonly activity: TransactionRun;
  protected readonly stack: TransactionStack;
  protected readonly entry: StackEntry;
  protected readonly openTransaction: OpenTransaction;
  private readonly route: ActivityRoute;

  constructor(
    runtime: TransactionRuntime,
    driverTx: SqlTransaction,
    activity: TransactionRun,
    stack: TransactionStack,
    entry: StackEntry,
  ) {
    this.runtime = runtime;
    this.driverTx = driverTx;
    this.activity = activity;
    this.stack = stack;
    this.entry = entry;
    this.route = runtime.route(driverTx, activity);
    this.openTransaction = {
      activity,
      assertAcceptsStatements: () => this.assertAcceptsStatements(),
      assertOpen: () => this.assertOpen(),
    };
    runtime.register(driverTx, this.openTransaction);
    this[activitySource] = {
      startActivity: (clientActivity) => runtime.startActivity(this.route, clientActivity),
      planContentHash: (plan) => runtime.planContentHash(plan, activity),
    };
  }

  abstract get isClosed(): boolean;
  abstract assertOpen(): void;
  abstract commit(): Promise<void>;
  abstract rollback(): Promise<void>;
  protected abstract assertAcceptsStatements(): void;
  protected abstract get rootTransaction(): OuterTransaction;

  query<Row>(
    plan: (SqlExecutionPlan<unknown> | SqlQueryPlan<unknown>) & { readonly _row?: Row },
    options?: RuntimeExecuteOptions,
  ): AsyncIterableResult<Row> {
    return this.route.query<Row>(plan, { ...options });
  }

  execute(
    plan: SqlExecutionPlan<unknown> | SqlQueryPlan<unknown>,
    options?: RuntimeExecuteOptions,
  ): Promise<SqlStatementStats> {
    return this.route.execute(plan, { ...options });
  }

  [preparedStatementQuery]<Params, Row>(
    ps: PreparedStatement<Params, Row>,
    params: Params,
    options?: RuntimeExecuteOptions,
  ): AsyncIterableResult<Row> {
    return this.route.preparedQuery<Params, Row>(
      blindCast<
        PreparedStatementImpl<Params, Row>,
        'prepared statements are created by this runtime implementation'
      >(ps),
      params,
      { ...options },
    );
  }

  [preparedStatementExecute]<Params>(
    ps: PreparedExecution<Params>,
    params: Params,
    options?: RuntimeExecuteOptions,
  ): Promise<SqlStatementStats> {
    return this.route.preparedExecute<Params>(
      blindCast<
        PreparedExecutionImpl<Params>,
        'prepared statements are created by this runtime implementation'
      >(ps),
      params,
      { ...options },
    );
  }

  async transaction(): Promise<RuntimeTransaction> {
    if (this.isClosed) throw transactionClosedError();
    this.assertAcceptsStatements();
    const name = this.stack.nextSavepointName();
    const entry: StackEntry = { name, activity: undefined, commitEnding: undefined, state: 'open' };
    this.stack.push(entry);
    let activity: TransactionRun;
    try {
      activity = await this.runtime.startTransactionActivity(this.activity);
    } catch (error) {
      this.stack.pop();
      throw error;
    }
    entry.activity = activity;
    let driverSavepoint: SqlTransaction;
    try {
      driverSavepoint = await this.runtime.trackInFlight(() => this.driverTx.savepoint(name));
    } catch (error) {
      this.stack.pop();
      await activity.end({ by: 'rollback', outcome: 'failed', commitAttempted: false });
      throw error;
    }
    this.runtime.markHeld(this.driverTx, driverSavepoint);
    return new Savepoint(
      this.runtime,
      driverSavepoint,
      activity,
      this.stack,
      entry,
      this.rootTransaction,
    );
  }
}

export class OuterTransaction extends TransactionBase implements SettledTransactionTarget {
  readonly signal: AbortSignal;
  readonly [transactionSettlement]: TransactionSettlementState;
  private readonly controller = new AbortController();
  private readonly connection: SqlConnection;
  private readonly endTransactionWork: () => void;
  private readonly timeout: number | undefined;
  private readonly deadline: number;
  private closed = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private commitAttempted = false;

  constructor(
    runtime: TransactionRuntime,
    connection: SqlConnection,
    driverTx: SqlTransaction,
    activity: TransactionRun,
    endTransactionWork: () => void,
    timeout: number | undefined,
  ) {
    const entry: StackEntry = { name: undefined, activity, commitEnding: undefined, state: 'open' };
    super(runtime, driverTx, activity, new TransactionStack(), entry);
    this.stack.push(entry);
    this.signal = this.controller.signal;
    this.endTransactionWork = endTransactionWork;
    this.timeout = timeout;
    this.deadline = performance.now() + (timeout ?? Number.POSITIVE_INFINITY);
    this.connection = connection;
    runtime.register(connection, this.openTransaction);
    this[transactionSettlement] = {
      get committed() {
        return entry.state === 'committed';
      },
      get rolledBack() {
        return entry.state === 'rolled-back';
      },
      logDroppedError: (error) => this.logDroppedError(error),
    };
    if (timeout !== undefined) {
      this.timer = setTimeout(() => this.expire(), timeout);
      runtime.onConnectionReleased(connection, () => this.releaseConnection());
    }
  }

  get isClosed(): boolean {
    return this.closed || this.stack.invalidated;
  }

  protected get rootTransaction(): OuterTransaction {
    return this;
  }

  assertOpen(): void {
    if (!this.closed && performance.now() >= this.deadline) this.expire();
    this.signal.throwIfAborted();
    if (this.isClosed) throw transactionClosedError();
  }

  protected assertAcceptsStatements(): void {
    if (this.stack.invalidated) throw transactionClosedError();
    if (!this.closed && this.stack.top !== this.entry) {
      throw transactionSuspendedError(this.stack);
    }
  }

  async commit(): Promise<void> {
    if (this.timeout !== undefined) this.assertOpen();
    this.assertAcceptsStatements();
    this.stopDeadline();
    this.commitAttempted = true;
    this.stopAcceptingChildren();
    try {
      await this.runtime.trackInFlight(() => this.driverTx.commit());
    } catch (error) {
      this.endTransactionWork();
      await this.activity.end({ by: 'commit', outcome: 'failed' });
      throw error;
    }
    this.entry.state = 'committed';
    this.entry.commitEnding = this.activity.end({ by: 'commit', outcome: 'succeeded' });
    try {
      await this.entry.commitEnding;
    } finally {
      this.endTransactionWork();
    }
  }

  async rollback(): Promise<void> {
    if (this.stack.invalidated) return this.refuseInvalidatedRollback();
    if (this.stack.top !== this.entry && !this.signal.aborted) {
      throw transactionSuspendedError(this.stack);
    }
    this.stopDeadline();
    this.stopAcceptingChildren();
    if (this.entry.commitEnding !== undefined) {
      await this.entry.commitEnding.catch(() => undefined);
      throw transactionClosedError();
    }
    if (this.entry.state === 'rolled-back') return;
    try {
      await this.runtime.trackInFlight(() => this.driverTx.rollback());
    } catch (error) {
      this.endTransactionWork();
      await this.activity.end({
        by: 'rollback',
        outcome: 'failed',
        commitAttempted: this.commitAttempted,
      });
      throw error;
    }
    this.entry.state = 'rolled-back';
    try {
      await this.activity.end({
        by: 'rollback',
        outcome: 'succeeded',
        commitAttempted: this.commitAttempted,
      });
    } finally {
      this.endTransactionWork();
    }
  }

  private async refuseInvalidatedRollback(): Promise<void> {
    this.stopDeadline();
    this.stopAcceptingChildren();
    this.endTransactionWork();
    await this.activity.end({
      by: 'rollback',
      outcome: 'failed',
      commitAttempted: this.commitAttempted,
    });
    throw transactionClosedError();
  }

  private async releaseConnection(): Promise<void> {
    this.stopDeadline();
    this.stopAcceptingChildren();
    try {
      if (this.entry.state !== 'committed' && this.entry.state !== 'rolled-back') {
        this.entry.state = 'rolled-back';
        await this.activity.end({
          by: 'rollback',
          outcome: 'failed',
          commitAttempted: this.commitAttempted,
        });
      }
    } catch (error) {
      this.logDroppedError(error);
    } finally {
      this.endTransactionWork();
    }
  }

  private stopDeadline(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.closed = true;
  }

  private expire(): void {
    if (this.closed) return;
    this.stopDeadline();
    this.activity.stopAcceptingChildren();
    this.controller.abort(
      runtimeError('RUNTIME.TRANSACTION_TIMEOUT', 'Transaction callback exceeded its timeout', {
        timeout: this.timeout,
      }),
    );
  }

  private stopAcceptingChildren(): void {
    this.activity.stopAcceptingChildren();
    this.runtime.unregister(this.connection, this.openTransaction);
  }

  private logDroppedError(error: unknown): void {
    try {
      this.activity.ctx.log.error({ event: 'middleware.activityEnded.error', error });
    } catch {
      // A failing logger must not replace the error the caller receives.
    }
  }
}

class Savepoint extends TransactionBase {
  private readonly root: OuterTransaction;

  constructor(
    runtime: TransactionRuntime,
    driverTx: SqlTransaction,
    activity: TransactionRun,
    stack: TransactionStack,
    entry: StackEntry,
    root: OuterTransaction,
  ) {
    super(runtime, driverTx, activity, stack, entry);
    this.root = root;
  }

  get signal(): AbortSignal {
    return this.root.signal;
  }

  get isClosed(): boolean {
    return this.root.isClosed || !this.stack.includes(this.entry);
  }

  protected get rootTransaction(): OuterTransaction {
    return this.root;
  }

  assertOpen(): void {
    this.root.assertOpen();
    if (this.isClosed) throw transactionClosedError();
  }

  protected assertAcceptsStatements(): void {
    if (this.isClosed) throw transactionClosedError();
    if (this.stack.top !== this.entry) throw transactionSuspendedError(this.stack);
  }

  async commit(): Promise<void> {
    this.assertAcceptsStatements();
    try {
      await this.runtime.trackInFlight(() => this.driverTx.commit());
    } catch (error) {
      this.entry.state = 'commit-failed';
      throw error;
    }
    this.stack.pop();
    this.entry.state = 'committed';
    this.entry.commitEnding = this.activity.end({ by: 'release', outcome: 'succeeded' });
    await this.entry.commitEnding;
  }

  async rollback(): Promise<void> {
    if (this.entry.commitEnding !== undefined) {
      await this.entry.commitEnding.catch(() => undefined);
      throw transactionClosedError();
    }
    const commitAttempted = this.entry.state === 'commit-failed';
    if (this.isClosed) {
      await this.activity.end({ by: 'rollback', outcome: 'failed', commitAttempted });
      throw transactionClosedError();
    }
    if (this.stack.top !== this.entry) throw transactionSuspendedError(this.stack);
    try {
      await this.runtime.trackInFlight(() => this.driverTx.rollback());
    } catch (error) {
      this.stack.invalidate();
      await this.activity.end({ by: 'rollback', outcome: 'failed', commitAttempted });
      throw error;
    }
    this.stack.pop();
    this.entry.state = 'rolled-back';
    await this.activity.end({ by: 'rollback', outcome: 'succeeded', commitAttempted });
  }
}

export function transactionClosedError(): Error {
  return runtimeError(
    'RUNTIME.TRANSACTION_CLOSED',
    'Cannot use a transaction operation after the transaction has ended. Consume query results and await execute calls inside the transaction callback.',
    {},
  );
}

function openSavepointOf(stack: TransactionStack): StackEntry {
  const { top } = stack;
  invariant(top !== undefined, 'A transaction below the top of the stack has a savepoint above it');
  return top;
}

function transactionSuspendedError(stack: TransactionStack): Error {
  const open = openSavepointOf(stack);
  return runtimeError(
    'RUNTIME.TRANSACTION_SUSPENDED',
    `Savepoint ${open.name} is open on this transaction; commit or roll it back before using the transaction again.`,
    { savepointId: open.activity?.activity.id },
  );
}
