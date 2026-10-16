import type {
  ActivityParent,
  ClientActivity,
  ClientActivityEnd,
  ClientActivityKind,
  ClientActivityResult,
  RuntimeExecuteOptions,
  StartActivity,
} from '@internal/framework-components/runtime';
import type { SqlExecutionPlan, SqlQueryPlan } from '@internal/sql-relational-core/plan';
import type { RuntimeScope } from '@internal/sql-relational-core/types';
import { invariant } from '@internal/utils/assertions';
import type { PreparedExecution, PreparedStatement } from './prepared/types';
import type { RuntimeQueryable, RuntimeTransaction } from './sql-runtime';

/** What starts client activities and hashes plans. The runtime's queryables and activity handles carry one through `activitySource`. */
export interface ActivitySource {
  /**
   * Starts an activity for an act the runtime would not otherwise see, such as an ORM call. Statements and activities started through the handle are its children. An open handle on the runtime keeps the runtime busy, so `close()` waits for its `end()`; a handle never ended keeps it busy, as a connection never released does.
   */
  startActivity<K extends ClientActivityKind>(
    activity: StartActivity<K>,
  ): Promise<ActivityHandle<K>>;
  /** The content hash of the statement `plan` sends: after `beforeCompile`, lowering and encoding, without `beforeEncode`. It equals the digest `ctx.contentHash(exec)` returns for the statement's execution plan only when `beforeCompile` gives the same result here as for the statement (it runs here with the scope and parent of the queryable it is called on, and with fresh state; on the runtime itself there is no parent), no `beforeEncode` hook changes the parameters, and the codecs encode deterministically. It starts nothing, so it also works on a handle that has ended. */
  planContentHash(plan: HashablePlan): Promise<string>;
}

/** A prepared statement and the parameters one execution of it binds; its hash is that of the statement it sends with those parameters. The statement is one the SQL runtime prepared, returning rows or statistics. */
export interface BoundPreparedStatement {
  readonly statement: PreparedStatement<unknown, unknown> | PreparedExecution<unknown>;
  readonly params: unknown;
}

/** What `planContentHash` hashes: a plan, or one execution of a prepared statement, whose hash is that of the statement it sends with those parameters. */
export type HashablePlan = SqlQueryPlan | SqlExecutionPlan | BoundPreparedStatement;

/** An open client activity, to send its statements through and to end. Its `startActivity` and `planContentHash` members are those of its `activitySource` member. */
export interface ActivityHandle<K extends ClientActivityKind>
  extends RuntimeQueryable,
    ActivitySource,
    ActivitySourceTarget {
  readonly activity: ClientActivity<K>;
  /** Set when an `intercept.onActivity` handler supplied the result; the client then returns it without running anything. */
  readonly intercepted: { readonly result: ClientActivityResult<K> } | undefined;
  /** Starts a transaction beneath the activity. Absent on a handle opened under a transaction, or on a connection whose transaction is open. */
  readonly transaction?: () => Promise<RuntimeTransaction>;
  /** Ends the activity. Rejects with `RUNTIME.ACTIVITY_CHILDREN_OPEN` when a statement or activity beneath it has not ended, after ending it `failed`. */
  end(end: ClientActivityEnd<K>): Promise<void>;
}

/** Options a queryable's statements carry: the activity they start beneath. */
export interface ActivityExecuteOptions extends RuntimeExecuteOptions {
  readonly activityParent?: ActivityParent | undefined;
}

/** The symbol-keyed member through which a runtime, connection, transaction, `withTransaction` context or activity handle starts activities; user-facing types do not show it. */
export const activitySource = Symbol('activitySource');

export interface ActivitySourceTarget {
  readonly [activitySource]: ActivitySource;
}

function hasActivitySourceMember(
  target: RuntimeScope,
): target is RuntimeScope & ActivitySourceTarget {
  return activitySource in target;
}

/** The `activitySource` member of a queryable; `undefined` for a queryable that cannot start activities, such as a test stub. */
export function findActivitySource(target: RuntimeScope): ActivitySource | undefined {
  return hasActivitySourceMember(target) ? target[activitySource] : undefined;
}

function activitySourceOf(target: RuntimeScope): ActivitySource {
  const source = findActivitySource(target);
  invariant(source !== undefined, 'The queryable cannot start activities');
  return source;
}

/** An activity source that starts activities on whatever queryable `target()` returns when called, for an object that sends its statements to a queryable it looks up each time. */
export function delegatingActivitySource(target: () => RuntimeScope): ActivitySource {
  return {
    startActivity: (activity) => startActivityOn(target(), activity),
    planContentHash: (plan) => planContentHashOn(target(), plan),
  };
}

/** Starts an activity on a queryable through its `activitySource` member. */
export function startActivityOn<K extends ClientActivityKind>(
  target: RuntimeScope,
  activity: StartActivity<K>,
): Promise<ActivityHandle<K>> {
  return activitySourceOf(target).startActivity(activity);
}

export function planContentHashOn(target: RuntimeScope, plan: HashablePlan): Promise<string> {
  return activitySourceOf(target).planContentHash(plan);
}
