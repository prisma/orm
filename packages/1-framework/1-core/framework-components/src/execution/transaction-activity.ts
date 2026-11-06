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
import type {
  ActivityContext,
  ActivityContextFields,
  ActivityFinalizedResult,
  ActivityObserver,
  TransactionActivity,
} from './runtime-middleware';

/** How a transaction's `commit()` or `rollback()` settled. */
export type TransactionSettlement =
  | { readonly by: 'commit'; readonly outcome: 'succeeded' | 'failed' }
  | {
      readonly by: 'rollback';
      readonly outcome: 'succeeded' | 'failed';
      /** Whether `commit()` was called before this rollback. */
      readonly commitAttempted: boolean;
    };

/** An open transaction activity. Pass it as the `parent` of every statement sent while the transaction is open. */
export interface TransactionActivityRun<TContext extends ActivityContext = ActivityContext>
  extends ActivityParent {
  readonly activity: TransactionActivity;
  readonly ctx: TContext;
  /** Stops accepting children: new work beneath the transaction, and beneath the client activities inside it, is refused from now on. `end` does this too. */
  stopAcceptingChildren(): void;
  /**
   * Ends the transaction: its `activityEnded` hooks, then the `activityFinalized` hooks of the activities beneath it that have ended, in post-order (each activity's children in the order they started, depth first, then the activity), then its own. Resolves after those hooks have run. An activity still open is finalized when it ends, with this transaction's outcome; `end` does not wait for it. A second call does nothing. An `activityEnded` error after a successful settlement is rethrown once finalization has run.
   */
  end(settlement: TransactionSettlement): Promise<void>;
}

export interface TransactionActivityOptions<TContext extends ActivityContext> {
  readonly middleware: ReadonlyArray<ActivityObserver>;
  readonly context: ActivityContextFields<TContext>;
  /** The open activity the transaction starts beneath, such as a client activity. */
  readonly parent: ActivityParent | undefined;
  /** Whether the transaction keeps its finished children to finalize them when it ends. A runtime decides this once, when it is created: only when a middleware implements `activityFinalized`. Without it, the transaction keeps nothing but whether a statement beneath it failed. */
  readonly holdFinishedChildren: boolean;
}

/**
 * Starts a transaction activity and runs its `activityStarted` hooks. When one of them throws, the transaction ends `failed`, is finalized `rolled-back`, and the error is rethrown. Rejects at once, running no hook, when `parent` no longer accepts children.
 */
export async function startTransactionActivity<TContext extends ActivityContext>(
  options: TransactionActivityOptions<TContext>,
): Promise<TransactionActivityRun<TContext>> {
  const run = new TransactionActivityRunImpl<TContext>(options);
  try {
    await run.start();
  } catch (error) {
    await run.end({ by: 'rollback', outcome: 'failed', commitAttempted: false });
    throw error;
  }
  return run;
}

class TransactionActivityRunImpl<TContext extends ActivityContext>
  implements TransactionActivityRun<TContext>
{
  readonly activity: TransactionActivity;
  readonly ctx: TContext;
  readonly #record: ActivityRecord<TContext>;
  readonly #children: ActivityChildren;
  readonly #slot: ActivityChildSlot | undefined;
  #aStatementFailed = false;
  #ended = false;
  #acceptingChildren = true;

  constructor(options: TransactionActivityOptions<TContext>) {
    this.activity = {
      id: crypto.randomUUID(),
      kind: 'transaction',
      annotations: brandedAnnotations(undefined),
    };
    this.#record = createActivityRecord<TContext>(
      options.middleware,
      this.activity,
      options.context,
      options.parent,
    );
    this.ctx = this.#record.ctx;
    this.#children = new ActivityChildren({
      inTransaction: true,
      holdFinishedChildren: options.holdFinishedChildren,
      statementFailed: () => {
        this.#aStatementFailed = true;
      },
      transactionAcceptsChildren: () => this.#acceptingChildren,
      childFinalized: () => {},
    });
    this.#slot = options.parent?.adopt(this);
  }

  start(): Promise<void> {
    return this.#record.started();
  }

  acceptsChildren(): boolean {
    return this.#acceptingChildren;
  }

  adopt(child: ActivityChild): ActivityChildSlot {
    if (!this.#acceptingChildren) throw notAcceptingChildrenError(this.activity, 'parent');
    return this.#children.add(child);
  }

  stopAcceptingChildren(): void {
    this.#acceptingChildren = false;
  }

  async end(settlement: TransactionSettlement): Promise<void> {
    if (this.#ended) return;
    this.#ended = true;
    this.#acceptingChildren = false;
    await endActivity(
      this.#record,
      { kind: 'transaction', outcome: settlement.outcome },
      this.#finalizedResult(settlement),
      this.#slot,
      (result) => this.finalize(result),
    );
  }

  async finalize(result: ActivityFinalizedResult): Promise<void> {
    await this.#children.finalize(result);
    await this.#record.finalize(result);
  }

  #finalizedResult(settlement: TransactionSettlement): ActivityFinalizedResult {
    if (settlement.by === 'rollback') {
      return { outcome: settlement.commitAttempted ? 'unknown' : 'rolled-back' };
    }
    return {
      outcome:
        settlement.outcome === 'succeeded' && !this.#aStatementFailed ? 'committed' : 'unknown',
    };
  }
}
