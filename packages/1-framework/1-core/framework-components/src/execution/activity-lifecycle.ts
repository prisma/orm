import { blindCast } from '@internal/utils/casts';
import { type RuntimeErrorEnvelope, runtimeError } from './runtime-error';
import type {
  Activity,
  ActivityBase,
  ActivityContext,
  ActivityContextFields,
  ActivityEndedResult,
  ActivityFinalizedResult,
  ActivityObserver,
} from './runtime-middleware';

const resolved: Promise<void> = Promise.resolve();

/** An open activity that new activities can start beneath. */
export interface ActivityParent {
  readonly activity: ActivityBase;
  readonly ctx: ActivityContext;
  /** Whether statements and activities may still start beneath this parent. A transaction stops accepting children when its `commit()` or `rollback()` is called; a client activity, when it ends or its transaction stops accepting children. */
  acceptsChildren(): boolean;
  /** Records `child` in start order and returns how the child reports to this parent. Throws `RUNTIME.ACTIVITY_NOT_ACCEPTING_CHILDREN` when the parent no longer accepts children. */
  adopt(child: ActivityChild): ActivityChildSlot;
}

/** What a parent holds of a child activity until it is finalized. */
export interface ActivityChild {
  /** Runs the `activityFinalized` hooks of the children it holds, in the order they started and depth first, then its own. A second call does nothing. */
  finalize(result: ActivityFinalizedResult): Promise<void>;
}

/** How a child reports to its parent. */
export interface ActivityChildSlot {
  /** A statement at or beneath the child failed. The report travels up to the nearest transaction. */
  statementFailed(): void;
  /** The child has ended. `own` is its finalized result when no transaction finalizes it. Resolves once the child is finalized, or held for its transaction. */
  ended(own: ActivityFinalizedResult): Promise<void>;
  /** Whether the nearest transaction at or above the parent still accepts children; `true` outside any transaction. */
  transactionAcceptsChildren(): boolean;
}

export interface ActivityChildrenOptions {
  /** Whether a transaction at or above the parent finalizes the children. Otherwise each child is finalized with its own result when it ends. */
  readonly inTransaction: boolean;
  /** Whether finished children are kept for the transaction to finalize. */
  readonly holdFinishedChildren: boolean;
  readonly statementFailed: () => void;
  readonly transactionAcceptsChildren: () => boolean;
  /** Receives the result of each child finalized when it ends. */
  readonly childFinalized: (result: ActivityFinalizedResult) => void;
}

/** The children of a transaction or a client activity: which are open, and which have ended and wait to be finalized. */
export class ActivityChildren {
  readonly #options: ActivityChildrenOptions;
  readonly #held: Array<{ readonly child: ActivityChild; ended: boolean }> = [];
  #open = 0;
  #finalized: ActivityFinalizedResult | undefined;

  constructor(options: ActivityChildrenOptions) {
    this.#options = options;
  }

  /** The children that have started and not ended. */
  get open(): number {
    return this.#open;
  }

  add(child: ActivityChild): ActivityChildSlot {
    const options = this.#options;
    const entry =
      options.inTransaction && options.holdFinishedChildren ? { child, ended: false } : undefined;
    if (entry !== undefined) this.#held.push(entry);
    this.#open++;
    let ended = false;
    return {
      statementFailed: options.statementFailed,
      transactionAcceptsChildren: options.transactionAcceptsChildren,
      ended: async (own) => {
        if (ended) return;
        ended = true;
        this.#open--;
        if (!options.inTransaction) {
          options.childFinalized(own);
          await child.finalize(own);
        } else if (this.#finalized !== undefined) {
          await child.finalize(this.#finalized);
        } else if (entry !== undefined) {
          entry.ended = true;
        }
      },
    };
  }

  /** Finalizes the children that have ended, in start order, with `result`; a child that ends later is finalized with it then. `undefined` when no ended child waited. */
  finalize(result: ActivityFinalizedResult): Promise<void> | undefined {
    if (this.#finalized !== undefined) return undefined;
    this.#finalized = result;
    const held = this.#held.splice(0);
    if (held.length === 0) return undefined;
    return (async () => {
      for (const { child, ended } of held) {
        if (ended) await child.finalize(result);
      }
    })();
  }
}

export function notAcceptingChildrenError(
  parent: ActivityBase,
  reason: 'parent' | 'transaction',
): RuntimeErrorEnvelope {
  const subject = parent.kind === 'transaction' ? 'a transaction' : `a '${parent.kind}' activity`;
  const state =
    parent.kind === 'transaction'
      ? 'that no longer accepts children: its commit() or rollback() has been called'
      : reason === 'parent'
        ? 'that has ended'
        : 'whose transaction no longer accepts children';
  return runtimeError(
    'RUNTIME.ACTIVITY_NOT_ACCEPTING_CHILDREN',
    `An activity was started beneath ${subject} ${state}`,
    { parentKind: parent.kind, parentId: parent.id },
  );
}

export interface ActivityRecord<TContext extends ActivityContext> extends ActivityChild {
  readonly activity: Activity;
  readonly ctx: TContext;
  started(): Promise<void>;
  /** Runs the `activityEnded` hooks; `undefined` when no middleware has one. */
  ended(result: ActivityEndedResult): Promise<void> | undefined;
}

/** The per-activity state behind `ctx.state(key)`: one object per key, created empty on first use. */
export interface ActivityStateStore {
  state(key: string | symbol): Record<string | symbol, unknown>;
  clear(): void;
}

export function createStateStore(): ActivityStateStore {
  let states: Map<string | symbol, Record<string | symbol, unknown>> | undefined;
  return {
    state(key) {
      states ??= new Map();
      let state = states.get(key);
      if (state === undefined) {
        state = {};
        states.set(key, state);
      }
      return state;
    },
    clear() {
      states = undefined;
    },
  };
}

interface LifecycleHooks {
  anyStarted: boolean;
  anyEnded: boolean;
  anyFinalized: boolean;
}

function hooksOf(middleware: ReadonlyArray<ActivityObserver>): LifecycleHooks {
  const hooks = { anyStarted: false, anyEnded: false, anyFinalized: false };
  for (const mw of middleware) {
    hooks.anyStarted ||= mw.activityStarted !== undefined;
    hooks.anyEnded ||= mw.activityEnded !== undefined;
    hooks.anyFinalized ||= mw.activityFinalized !== undefined;
  }
  return hooks;
}

export function createActivityRecord<TContext extends ActivityContext>(
  middleware: ReadonlyArray<ActivityObserver>,
  activity: Activity,
  fields: ActivityContextFields<TContext>,
  parent: ActivityParent | undefined,
): ActivityRecord<TContext> {
  const store = createStateStore();
  let finalized = false;
  // How many middleware ran activityStarted. A middleware after one whose activityStarted threw never saw the activity start, so it gets no later event for it.
  let started = middleware.length;
  const ctx = contextBeneath<TContext>(fields, parent, store);

  const { anyStarted, anyEnded, anyFinalized } = hooksOf(middleware);

  return {
    activity,
    ctx,
    started() {
      if (!anyStarted) return resolved;
      return (async () => {
        for (let index = 0; index < middleware.length; index++) {
          const mw = middleware[index];
          if (!mw?.activityStarted) continue;
          try {
            await mw.activityStarted(activity, ctx);
          } catch (error) {
            started = index + 1;
            throw error;
          }
        }
      })();
    },
    ended(result) {
      if (!anyEnded) return undefined;
      // Every middleware that saw the activity start sees it end. When the activity succeeded, the first error a hook throws fails it; after a failure the activity's own error reaches the caller, and hook errors go to the log.
      return (async () => {
        let firstError: { readonly error: unknown } | undefined;
        for (let index = 0; index < started; index++) {
          const mw = middleware[index];
          if (!mw?.activityEnded) continue;
          try {
            await mw.activityEnded(activity, result, ctx);
          } catch (error) {
            if (result.outcome === 'succeeded') firstError ??= { error };
            else logHookError(ctx, 'middleware.activityEnded.error', mw.name, error);
          }
        }
        if (firstError !== undefined) throw firstError.error;
      })();
    },
    finalize(result) {
      if (finalized) return resolved;
      finalized = true;
      if (!anyFinalized) {
        store.clear();
        return resolved;
      }
      return (async () => {
        for (let index = 0; index < started; index++) {
          const mw = middleware[index];
          if (!mw?.activityFinalized) continue;
          try {
            await mw.activityFinalized(activity, result, ctx);
          } catch (error) {
            logHookError(ctx, 'middleware.activityFinalized.error', mw.name, error);
          }
        }
        store.clear();
      })();
    },
  };
}

/**
 * The context of work that belongs to no activity but runs beneath `parent`, such as compiling a plan outside any statement: `parent` and `inTransaction()` as a child of `parent` would have them, and state of its own.
 */
export function createContextBeneath<TContext extends ActivityContext>(
  fields: ActivityContextFields<TContext>,
  parent: ActivityParent | undefined,
): TContext {
  return contextBeneath<TContext>(fields, parent, createStateStore());
}

function contextBeneath<TContext extends ActivityContext>(
  fields: ActivityContextFields<TContext>,
  parent: ActivityParent | undefined,
  store: ActivityStateStore,
): TContext {
  const parentCtx = parent?.ctx;
  const parentIsTransaction = parent?.activity.kind === 'transaction';
  return blindCast<
    TContext,
    'the family context is its fields plus the members every activity context adds'
  >({
    ...fields,
    parent: parentCtx,
    state: store.state,
    inTransaction: () => parentIsTransaction || (parentCtx?.inTransaction() ?? false),
  });
}

function logHookError(
  ctx: ActivityContext,
  event: string,
  middleware: string,
  error: unknown,
): void {
  try {
    ctx.log.error({ event, middleware, error });
  } catch {
    // A failing logger must not replace the error the caller receives.
  }
}

/**
 * Ends an activity: its `activityEnded` hooks, then its finalization, which its parent holds or performs, or which happens at once with `own` when it has no parent. The finalization runs even when an `activityEnded` hook fails the activity; that error is rethrown afterwards.
 */
export function endActivity(
  record: Pick<ActivityRecord<ActivityContext>, 'ended'>,
  result: ActivityEndedResult,
  own: ActivityFinalizedResult,
  slot: ActivityChildSlot | undefined,
  finalize: (result: ActivityFinalizedResult) => Promise<void>,
): Promise<void> {
  const ended = record.ended(result);
  if (ended === undefined) return slot === undefined ? finalize(own) : slot.ended(own);
  return finishAfterEndedHooks(ended, own, slot, finalize);
}

async function finishAfterEndedHooks(
  ended: Promise<void>,
  own: ActivityFinalizedResult,
  slot: ActivityChildSlot | undefined,
  finalize: (result: ActivityFinalizedResult) => Promise<void>,
): Promise<void> {
  let endedError: { readonly error: unknown } | undefined;
  try {
    await ended;
  } catch (error) {
    endedError = { error };
  }
  if (slot === undefined) {
    await finalize(own);
  } else {
    await slot.ended(own);
  }
  if (endedError !== undefined) throw endedError.error;
}
