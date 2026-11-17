import { blindCast } from '@internal/utils/casts';
import { brandedAnnotations } from '../annotations';
import {
  type ActivityChild,
  ActivityChildren,
  type ActivityChildSlot,
  type ActivityParent,
  type ActivityRecord,
  createActivityRecord,
  endActivity,
  notAcceptingChildrenError,
} from './activity-lifecycle';
import { runtimeError } from './runtime-error';
import type {
  ActivityContext,
  ActivityContextFields,
  ActivityFinalizedResult,
  ActivityObserver,
  ClientActivity,
  ClientActivityEnded,
  ClientActivityKind,
  ClientActivityResult,
  RuntimeMiddleware,
  StartActivity,
} from './runtime-middleware';

/** What a client passes to end its activity. */
export interface ClientActivityEnd<K extends ClientActivityKind> {
  readonly outcome: 'succeeded' | 'failed' | 'stopped';
  /** The value the client returns to its caller. When omitted after an interception, the intercepted result. */
  readonly result?: ClientActivityResult<K>;
}

/** An open client activity. Pass it as the `parent` of every statement, transaction and client activity started beneath it. */
export interface ClientActivityRun<
  K extends ClientActivityKind,
  TContext extends ActivityContext = ActivityContext,
> extends ActivityParent {
  readonly activity: ClientActivity<K>;
  readonly ctx: TContext;
  /** Set when an `intercept.onActivity` handler supplied the result. */
  readonly intercepted: { readonly result: ClientActivityResult<K> } | undefined;
  /** Throws `RUNTIME.ACTIVITY_NOT_ACCEPTING_CHILDREN` when the activity no longer accepts children. */
  assertAcceptsChildren(): void;
  /**
   * Ends the activity: its `activityEnded` hooks, then its finalization. Outside a transaction it is finalized at once: `committed` when it succeeded and everything beneath it was finalized `committed`, otherwise `unknown`. Inside one, its transaction finalizes it. When a child has not ended, the activity ends `failed`, is finalized, and `end` rejects with `RUNTIME.ACTIVITY_CHILDREN_OPEN`. A second call rejects with `RUNTIME.ACTIVITY_ALREADY_ENDED`.
   */
  end(end: ClientActivityEnd<K>): Promise<void>;
}

/** How a runtime runs a client activity. */
export interface ClientActivityOptions<TContext extends ActivityContext> {
  readonly middleware: ReadonlyArray<ActivityObserver & Pick<RuntimeMiddleware, 'intercept'>>;
  readonly context: ActivityContextFields<TContext>;
  /** The open activity the client activity starts beneath. */
  readonly parent: ActivityParent | undefined;
  /** As for a transaction: whether finished children inside a transaction are kept for it to finalize. */
  readonly holdFinishedChildren: boolean;
}

/**
 * Starts a client activity: its `activityStarted` hooks, then each `intercept.onActivity` handler in registration order until one returns a result. When a hook or a handler throws, the activity ends `failed`, is finalized, and the error is rethrown. Rejects at once, running no hook, when `kind` has no hyphen (such as `statement` or `transaction`) or when `parent` no longer accepts children.
 */
export async function startClientActivity<
  K extends ClientActivityKind,
  TContext extends ActivityContext = ActivityContext,
>(
  activity: StartActivity<K>,
  options: ClientActivityOptions<TContext>,
): Promise<ClientActivityRun<K, TContext>> {
  const kind: string = activity.kind;
  if (!kind.includes('-')) {
    throw runtimeError(
      'RUNTIME.ACTIVITY_KIND_RESERVED',
      `A client activity kind contains a hyphen, such as 'orm-call', and '${kind}' does not. Kinds without one, such as 'statement' and 'transaction', belong to the runtime.`,
      { kind },
    );
  }
  const run = new ClientActivityRunImpl<K, TContext>(activity, options);
  try {
    await run.start();
  } catch (error) {
    await run.finish({ outcome: 'failed', source: 'client' });
    throw error;
  }
  for (const mw of options.middleware) {
    const intercept = mw.intercept;
    if (intercept?.onActivity === undefined) continue;
    let intercepted: { readonly result: unknown } | undefined;
    try {
      intercepted = await intercept.onActivity(run.activity, run.ctx);
    } catch (error) {
      await run.finish({ outcome: 'failed', source: 'middleware' });
      throw error;
    }
    if (intercepted === undefined) continue;
    run.ctx.log.debug?.({ event: 'middleware.intercept.onActivity', middleware: mw.name });
    run.intercept(intercepted.result);
    break;
  }
  return run;
}

class ClientActivityRunImpl<K extends ClientActivityKind, TContext extends ActivityContext>
  implements ClientActivityRun<K, TContext>, ActivityChild
{
  readonly activity: ClientActivity<K>;
  readonly ctx: TContext;
  readonly #record: ActivityRecord<TContext>;
  readonly #children: ActivityChildren;
  readonly #slot: ActivityChildSlot | undefined;
  #intercepted: { readonly result: ClientActivityResult<K> } | undefined;
  #ended = false;
  #everythingBeneathCommitted = true;

  constructor(activity: StartActivity<K>, options: ClientActivityOptions<TContext>) {
    const computeContentHash = activity.contentHash;
    let contentHash: Promise<string> | undefined;
    let id: string | undefined;
    this.activity = {
      get id() {
        id ??= crypto.randomUUID();
        return id;
      },
      kind: activity.kind,
      contentHash: () => {
        contentHash ??= computeContentHash();
        return contentHash;
      },
      annotations: activity.annotations ?? brandedAnnotations(undefined),
    };
    this.#record = createActivityRecord<TContext>(
      options.middleware,
      this.activity,
      options.context,
      options.parent,
    );
    this.ctx = this.#record.ctx;
    this.#children = new ActivityChildren({
      inTransaction: this.ctx.inTransaction(),
      holdFinishedChildren: options.holdFinishedChildren,
      statementFailed: () => this.#slot?.statementFailed(),
      transactionAcceptsChildren: () => this.#slot?.transactionAcceptsChildren() ?? true,
      childFinalized: (result) => {
        if (result.outcome !== 'committed') this.#everythingBeneathCommitted = false;
      },
    });
    this.#slot = options.parent?.adopt(this);
  }

  get intercepted(): { readonly result: ClientActivityResult<K> } | undefined {
    return this.#intercepted;
  }

  start(): Promise<void> {
    return this.#record.started();
  }

  intercept(result: unknown): void {
    this.#intercepted = {
      result: blindCast<
        ClientActivityResult<K>,
        'the framework types intercepted results unknown; the client checks what it receives'
      >(result),
    };
  }

  acceptsChildren(): boolean {
    return !this.#ended && (this.#slot?.transactionAcceptsChildren() ?? true);
  }

  assertAcceptsChildren(): void {
    if (this.#ended) throw notAcceptingChildrenError(this.activity, 'parent');
    if (!(this.#slot?.transactionAcceptsChildren() ?? true)) {
      throw notAcceptingChildrenError(this.activity, 'transaction');
    }
  }

  adopt(child: ActivityChild): ActivityChildSlot {
    this.assertAcceptsChildren();
    return this.#children.add(child);
  }

  end(end: ClientActivityEnd<K>): Promise<void> {
    if (this.#ended) {
      return Promise.reject(
        runtimeError(
          'RUNTIME.ACTIVITY_ALREADY_ENDED',
          `The '${this.activity.kind}' activity has already ended`,
          { kind: this.activity.kind, id: this.activity.id },
        ),
      );
    }
    const openChildren = this.#children.open;
    if (openChildren > 0) {
      return this.finish({ outcome: 'failed', source: 'client' }).then(() => {
        throw runtimeError(
          'RUNTIME.ACTIVITY_CHILDREN_OPEN',
          `The '${this.activity.kind}' activity ended while ${openChildren} ${openChildren === 1 ? 'activity' : 'activities'} beneath it had not ended`,
          { kind: this.activity.kind, id: this.activity.id, openChildren },
        );
      });
    }
    const intercepted = this.#intercepted;
    if (end.result === undefined && intercepted !== undefined) {
      return this.finish({
        outcome: end.outcome,
        source: 'middleware',
        result: intercepted.result,
      });
    }
    return this.finish({ outcome: end.outcome, source: 'client', result: end.result });
  }

  finish(ended: {
    readonly outcome: ClientActivityEnd<K>['outcome'];
    readonly source: 'client' | 'middleware';
    readonly result?: ClientActivityResult<K> | undefined;
  }): Promise<void> {
    this.#ended = true;
    const { kind } = this.activity;
    const result: ClientActivityEnded<K> =
      ended.result === undefined
        ? { kind, outcome: ended.outcome, source: ended.source }
        : { kind, outcome: ended.outcome, source: ended.source, result: ended.result };
    const own: ActivityFinalizedResult = {
      outcome:
        ended.outcome === 'succeeded' && this.#everythingBeneathCommitted ? 'committed' : 'unknown',
    };
    return endActivity(this.#record, result, own, this.#slot, (finalized) =>
      this.finalize(finalized),
    );
  }

  finalize(result: ActivityFinalizedResult): Promise<void> {
    const children = this.#children.finalize(result);
    return children === undefined
      ? this.#record.finalize(result)
      : children.then(() => this.#record.finalize(result));
  }
}
