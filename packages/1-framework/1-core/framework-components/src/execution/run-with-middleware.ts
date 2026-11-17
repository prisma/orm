import { blindCast } from '@internal/utils/casts';
import { brandedAnnotations } from '../annotations';
import {
  type ActivityChildSlot,
  type ActivityParent,
  type ActivityRecord,
  createActivityRecord,
  endActivity,
} from './activity-lifecycle';
import type { ExecutionPlan, QueryPlan } from './query-plan';
import { checkAborted, raceAgainstAbort } from './race-against-abort';
import type {
  ActivityContext,
  ActivityContextFields,
  ParamRefMutator,
  RuntimeMiddleware,
  RuntimeStatementStats,
  StatementActivity,
  StatementEnded,
} from './runtime-middleware';

/** How a family runtime starts one statement activity. */
export interface StatementOptions<
  TExec extends ExecutionPlan,
  TMutator extends ParamRefMutator,
  TContext extends ActivityContext,
> {
  readonly middleware: ReadonlyArray<RuntimeMiddleware<TExec, TMutator>>;
  /** The plan the caller sent. */
  readonly plan: QueryPlan;
  readonly context: ActivityContextFields<TContext>;
  /** The open activity the statement runs beneath, such as the transaction it was sent on. */
  readonly parent: ActivityParent | undefined;
}

/** One running statement activity, handed to the family's statement body. */
export interface StatementActivityRun<
  TExec extends ExecutionPlan,
  TMutator extends ParamRefMutator,
  TContext extends ActivityContext,
> {
  readonly activity: StatementActivity;
  readonly ctx: TContext;
  /** Runs every `beforeEncode` hook in registration order, raced against `ctx.signal`. */
  beforeEncode(draft: TExec, params?: TMutator): Promise<void>;
  /** Runs `intercept.onQuery`, then the intercepted rows or `runDriver()` with `onRow` for each driver row. `runDriver` is called only when no handler supplied rows. */
  runQuery<Row>(exec: TExec, runDriver: () => AsyncIterable<Row>): AsyncIterable<Row>;
  /** Runs `intercept.onExecute`, then `runDriver()` when no handler supplied statistics. */
  runExecute(
    exec: TExec,
    runDriver: () => Promise<RuntimeStatementStats>,
  ): Promise<RuntimeStatementStats>;
}

/**
 * Runs one `query()` statement as an activity. The activity starts on the first `next()`: `activityStarted`, then `body`'s rows, then `activityEnded` and, unless a transaction holds it, `activityFinalized`. Each fires exactly once, whether the body succeeds, throws (`failed`) or the caller stops reading (`stopped`). When the parent no longer accepts work, the first `next()` rejects and no hook runs.
 */
export function streamStatement<
  TExec extends ExecutionPlan,
  TMutator extends ParamRefMutator,
  TContext extends ActivityContext,
  Row,
>(
  options: StatementOptions<TExec, TMutator, TContext>,
  body: (statement: StatementActivityRun<TExec, TMutator, TContext>) => AsyncIterable<Row>,
): AsyncIterable<Row> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<Row, void, undefined> {
      let thrownByCaller: { readonly error: unknown } | undefined;
      const generator = streamStatementRows(
        options,
        body,
        (error) => thrownByCaller !== undefined && thrownByCaller.error === error,
      );
      return {
        next: () => generator.next(),
        return: () => generator.return(undefined),
        throw: (error: unknown) => {
          thrownByCaller = { error };
          return generator.throw(error);
        },
      };
    },
  };
}

async function* streamStatementRows<
  TExec extends ExecutionPlan,
  TMutator extends ParamRefMutator,
  TContext extends ActivityContext,
  Row,
>(
  options: StatementOptions<TExec, TMutator, TContext>,
  body: (statement: StatementActivityRun<TExec, TMutator, TContext>) => AsyncIterable<Row>,
  isThrownByCaller: (error: unknown) => boolean,
): AsyncGenerator<Row, void, unknown> {
  const statement = new StatementActivityRunImpl(options, 'rows');
  statement.attach();
  let outcome: StatementEnded['outcome'] = 'stopped';
  try {
    await statement.start();
    yield* body(statement);
    outcome = 'succeeded';
  } catch (error) {
    if (!isThrownByCaller(error)) outcome = 'failed';
    throw error;
  } finally {
    await statement.end(outcome);
  }
}

/**
 * Runs one `execute()` statement as an activity: `activityStarted`, then `body`, then `activityEnded` and, unless a transaction holds it, `activityFinalized`, each exactly once. When the parent no longer accepts work, it rejects and no hook runs.
 */
export async function executeStatement<
  TExec extends ExecutionPlan,
  TMutator extends ParamRefMutator,
  TContext extends ActivityContext,
>(
  options: StatementOptions<TExec, TMutator, TContext>,
  body: (
    statement: StatementActivityRun<TExec, TMutator, TContext>,
  ) => Promise<RuntimeStatementStats>,
): Promise<RuntimeStatementStats> {
  const statement = new StatementActivityRunImpl(options, 'stats');
  statement.attach();
  let outcome: StatementEnded['outcome'] = 'failed';
  try {
    await statement.start();
    const stats = await body(statement);
    outcome = 'succeeded';
    return stats;
  } finally {
    await statement.end(outcome);
  }
}

class StatementActivityRunImpl<
  TExec extends ExecutionPlan,
  TMutator extends ParamRefMutator,
  TContext extends ActivityContext,
> implements StatementActivityRun<TExec, TMutator, TContext>
{
  readonly activity: StatementActivity;
  readonly ctx: TContext;
  readonly #middleware: ReadonlyArray<RuntimeMiddleware<TExec, TMutator>>;
  readonly #parent: ActivityParent | undefined;
  readonly #record: ActivityRecord<TContext>;
  #slot: ActivityChildSlot | undefined;
  #runStartedAt: number | undefined;
  #source: 'driver' | 'middleware' = 'driver';
  #rowCount = 0;
  #stats: RuntimeStatementStats | undefined;

  constructor(options: StatementOptions<TExec, TMutator, TContext>, returns: 'rows' | 'stats') {
    const { plan } = options;
    let annotations: StatementActivity['annotations'] | undefined;
    this.activity = {
      id: crypto.randomUUID(),
      kind: 'statement',
      returns,
      plan,
      get annotations() {
        annotations ??= brandedAnnotations(plan.meta.annotations);
        return annotations;
      },
    };
    this.#middleware = options.middleware;
    this.#parent = options.parent;
    this.#record = createActivityRecord<TContext>(
      options.middleware,
      this.activity,
      options.context,
      options.parent,
    );
    this.ctx = this.#record.ctx;
  }

  /** Adopts the statement into its parent; throws when the parent no longer accepts work. */
  attach(): void {
    this.#slot = this.#parent?.adopt(this.#record);
  }

  start(): Promise<void> {
    return this.#record.started();
  }

  end(outcome: StatementEnded['outcome']): Promise<void> {
    if (outcome === 'failed') this.#slot?.statementFailed();
    return endActivity(
      this.#record,
      this.#endedResult(outcome),
      { outcome: outcome === 'succeeded' ? 'committed' : 'unknown' },
      this.#slot,
      this.#record.finalize,
    );
  }

  async beforeEncode(draft: TExec, params?: TMutator): Promise<void> {
    for (const mw of this.#middleware) {
      if (!mw.beforeEncode) continue;
      checkAborted(this.ctx, 'beforeEncode');
      const work = mw.beforeEncode(draft, this.ctx, params);
      if (work !== undefined) {
        await raceAgainstAbort(Promise.resolve(work), this.ctx.signal, 'beforeEncode');
      }
    }
  }

  async *runQuery<Row>(exec: TExec, runDriver: () => AsyncIterable<Row>): AsyncGenerator<Row> {
    this.#runStartedAt = Date.now();
    let rows: AsyncIterable<Row> | Iterable<Row> | undefined;
    for (const mw of this.#middleware) {
      const intercept = mw.intercept;
      if (intercept?.onQuery === undefined) continue;
      this.#source = 'middleware';
      const result = await intercept.onQuery(exec, this.ctx);
      if (result === undefined) {
        this.#source = 'driver';
        continue;
      }
      this.ctx.log.debug?.({ event: 'middleware.intercept.onQuery', middleware: mw.name });
      rows = blindCast<
        AsyncIterable<Row> | Iterable<Row>,
        'the caller types rows through the plan; intercepted rows are the same opaque records'
      >(result.rows);
      break;
    }

    if (rows === undefined) {
      for await (const row of runDriver()) {
        for (const mw of this.#middleware) {
          if (mw.onRow) {
            await mw.onRow(
              blindCast<Record<string, unknown>, 'driver rows are opaque records'>(row),
              exec,
              this.ctx,
            );
          }
        }
        this.#rowCount++;
        yield row;
      }
      return;
    }

    for await (const row of rows) {
      this.#rowCount++;
      yield row;
    }
  }

  async runExecute(
    exec: TExec,
    runDriver: () => Promise<RuntimeStatementStats>,
  ): Promise<RuntimeStatementStats> {
    this.#runStartedAt = Date.now();
    for (const mw of this.#middleware) {
      const intercept = mw.intercept;
      if (intercept?.onExecute === undefined) continue;
      this.#source = 'middleware';
      const result = await intercept.onExecute(exec, this.ctx);
      if (result === undefined) {
        this.#source = 'driver';
        continue;
      }
      this.ctx.log.debug?.({ event: 'middleware.intercept.onExecute', middleware: mw.name });
      this.#stats = result.stats;
      return result.stats;
    }
    this.#stats = await runDriver();
    return this.#stats;
  }

  #endedResult(outcome: StatementEnded['outcome']): StatementEnded {
    const latencyMs = this.#runStartedAt === undefined ? 0 : Date.now() - this.#runStartedAt;
    const base = { kind: 'statement', outcome, latencyMs, source: this.#source } as const;
    if (this.activity.returns === 'rows') {
      return { ...base, returns: 'rows', rowCount: this.#rowCount };
    }
    return outcome === 'succeeded' && this.#stats !== undefined
      ? { ...base, returns: 'stats', stats: this.#stats }
      : { ...base, returns: 'stats' };
  }
}
