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

export interface QueryableTransaction {
  activity: TransactionRun | undefined;
  guard: (() => void) | undefined;
  readonly check: (() => void) | undefined;
}

export interface TransactionHost {
  route(
    driverTx: SqlTransaction,
    activity: TransactionRun,
    savepoint: (parent: ActivityParent) => Promise<RuntimeTransaction>,
  ): ActivityRoute;
  startActivity<K extends ClientActivityKind>(
    route: ActivityRoute,
    activity: StartActivity<K>,
  ): Promise<ActivityHandle<K>>;
  planContentHash(plan: HashablePlan, parent: ActivityParent): Promise<string>;
  startTransactionActivity(parent: ActivityParent): Promise<TransactionRun>;
  track<T>(operation: () => Promise<T>): Promise<T>;
  register(queryable: SqlQueryable, transaction: QueryableTransaction): void;
  hold(driverTx: SqlTransaction, driverSavepoint: SqlTransaction): void;
  onRelease(connection: SqlConnection, teardown: () => Promise<void>): void;
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
  protected readonly host: TransactionHost;
  protected readonly driverTx: SqlTransaction;
  protected readonly activity: TransactionRun;
  protected readonly stack: TransactionStack;
  protected readonly entry: StackEntry;
  protected readonly registration: QueryableTransaction;
  private readonly route: ActivityRoute;

  constructor(
    host: TransactionHost,
    driverTx: SqlTransaction,
    activity: TransactionRun,
    stack: TransactionStack,
    entry: StackEntry,
  ) {
    this.host = host;
    this.driverTx = driverTx;
    this.activity = activity;
    this.stack = stack;
    this.entry = entry;
    this.route = host.route(driverTx, activity, (parent) => this.openSavepoint(parent));
    this.registration = {
      activity,
      guard: () => this.assertMayWork(),
      check: () => this.checkDeadline(),
    };
    host.register(driverTx, this.registration);
    this[activitySource] = {
      startActivity: (clientActivity) => host.startActivity(this.route, clientActivity),
      planContentHash: (plan) => host.planContentHash(plan, activity),
    };
  }

  abstract get isClosed(): boolean;
  abstract checkDeadline(): void;
  abstract commit(): Promise<void>;
  abstract rollback(): Promise<void>;
  protected abstract assertMayWork(): void;
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

  savepoint(): Promise<RuntimeTransaction> {
    return this.openSavepoint(this.activity);
  }

  private async openSavepoint(parent: ActivityParent): Promise<RuntimeTransaction> {
    if (this.isClosed) throw transactionClosedError();
    if (this.stack.top !== this.entry) throw savepointAlreadyOpenError(this.stack);
    const name = this.stack.nextSavepointName();
    const entry: StackEntry = { name, activity: undefined, commitEnding: undefined, state: 'open' };
    this.stack.push(entry);
    let activity: TransactionRun;
    try {
      activity = await this.host.startTransactionActivity(parent);
    } catch (error) {
      this.stack.pop();
      throw error;
    }
    entry.activity = activity;
    let driverSavepoint: SqlTransaction;
    try {
      driverSavepoint = await this.host.track(() => this.driverTx.savepoint(name));
    } catch (error) {
      this.stack.pop();
      await activity.end({ by: 'rollback', outcome: 'failed', commitAttempted: false });
      throw error;
    }
    this.host.hold(this.driverTx, driverSavepoint);
    return new Savepoint(
      this.host,
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
  private readonly onConnection: QueryableTransaction;
  private readonly endTransactionWork: () => void;
  private readonly timeout: number | undefined;
  private readonly deadline: number;
  private closed = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private commitAttempted = false;
  private readonly self: OuterTransaction = this;

  constructor(
    host: TransactionHost,
    connection: SqlConnection,
    driverTx: SqlTransaction,
    activity: TransactionRun,
    endTransactionWork: () => void,
    timeout: number | undefined,
  ) {
    const entry: StackEntry = { name: undefined, activity, commitEnding: undefined, state: 'open' };
    super(host, driverTx, activity, new TransactionStack(), entry);
    this.stack.push(entry);
    this.signal = this.controller.signal;
    this.endTransactionWork = endTransactionWork;
    this.timeout = timeout;
    this.deadline = performance.now() + (timeout ?? Number.POSITIVE_INFINITY);
    this.onConnection = { activity, guard: () => this.assertMayWork(), check: undefined };
    host.register(connection, this.onConnection);
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
      host.onRelease(connection, () => this.releaseConnection());
    }
  }

  get isClosed(): boolean {
    return this.closed || this.stack.invalidated;
  }

  protected get rootTransaction(): OuterTransaction {
    return this.self;
  }

  checkDeadline(): void {
    if (this.timeout === undefined) return;
    if (!this.closed && performance.now() >= this.deadline) this.expire();
    this.signal.throwIfAborted();
    if (this.closed) throw transactionClosedError();
  }

  protected assertMayWork(): void {
    if (this.stack.invalidated) throw transactionClosedError();
    if (!this.closed && this.stack.top !== this.entry) {
      throw transactionSuspendedError(this.stack);
    }
  }

  async commit(): Promise<void> {
    this.checkDeadline();
    this.assertMayWork();
    this.stopDeadline();
    this.commitAttempted = true;
    this.stopAcceptingChildren();
    try {
      await this.host.track(() => this.driverTx.commit());
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
      return;
    }
    if (this.entry.state === 'rolled-back') return;
    try {
      await this.host.track(() => this.driverTx.rollback());
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
    const records =
      this.timeout === undefined ? [this.registration, this.onConnection] : [this.onConnection];
    for (const record of records) {
      if (record.activity === this.activity) record.activity = undefined;
    }
    this.onConnection.guard = undefined;
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
    host: TransactionHost,
    driverTx: SqlTransaction,
    activity: TransactionRun,
    stack: TransactionStack,
    entry: StackEntry,
    root: OuterTransaction,
  ) {
    super(host, driverTx, activity, stack, entry);
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

  checkDeadline(): void {
    this.root.checkDeadline();
  }

  protected assertMayWork(): void {
    if (this.isClosed) throw transactionClosedError();
    if (this.stack.top !== this.entry) throw transactionSuspendedError(this.stack);
  }

  async commit(): Promise<void> {
    this.assertMayWork();
    try {
      await this.host.track(() => this.driverTx.commit());
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
      return;
    }
    const commitAttempted = this.entry.state === 'commit-failed';
    if (this.isClosed) {
      await this.activity.end({ by: 'rollback', outcome: 'failed', commitAttempted });
      throw transactionClosedError();
    }
    if (this.stack.top !== this.entry) throw transactionSuspendedError(this.stack);
    try {
      await this.host.track(() => this.driverTx.rollback());
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

function savepointAlreadyOpenError(stack: TransactionStack): Error {
  const open = openSavepointOf(stack);
  return runtimeError(
    'RUNTIME.TRANSACTION_ALREADY_OPEN',
    `Savepoint ${open.name} is already open on this transaction; commit or roll it back before opening another.`,
    { savepointId: open.activity?.activity.id },
  );
}
