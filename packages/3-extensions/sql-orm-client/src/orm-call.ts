import {
  type AnnotationValue,
  AsyncIterableResult,
  type OperationKind,
} from '@internal/framework-components/runtime';
import type { Preparable, SqlQueryPlan } from '@internal/sql-relational-core/plan';
import type { RuntimeScope } from '@internal/sql-relational-core/types';
import {
  type ActivityHandle,
  type ActivitySource,
  findActivitySource,
  type PreparedStatement,
} from '@internal/sql-runtime';
import { canonicalStringify } from '@internal/utils/canonical-stringify';
import { hashContent } from '@internal/utils/hash-content';
import { ormError } from './orm-errors';
import type { RuntimeQueryable } from './types';

type Annotations = ReadonlyMap<string, AnnotationValue<unknown, OperationKind>>;

export interface OrmCall<Result> {
  readonly method: string;
  readonly annotations: Annotations | undefined;
  /** What the call's content hash digests besides its kind and method. */
  readonly hashInput: (source: ActivitySource) => Promise<unknown>;
  readonly accepts: (value: unknown) => value is Result;
}

export type CallHashInput = OrmCall<unknown>['hashInput'];

/** The hash input of a read is the content hash of the plan it sends first. */
export function planHashInput(plan: () => SqlQueryPlan): CallHashInput {
  return (source) => source.planContentHash(plan());
}

/** The hash input of a prepared read is the content hash of the statement with the parameters this execution binds. */
export function preparedHashInput(
  statement: PreparedStatement<unknown, unknown>,
  params: unknown,
): CallHashInput {
  return (source) => source.planContentHash({ statement, params });
}

/** A write's statements depend on earlier results, so its hash input is the model it writes. */
export function modelHashInput(namespaceId: string, modelName: string): CallHashInput {
  return async () => ({ namespace: namespaceId, model: modelName });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const ormResults = {
  rows: <Row>(value: unknown): value is Row[] => Array.isArray(value),
  row: <Row>(value: unknown): value is Row => isRecord(value),
  rowOrNull: <Row>(value: unknown): value is Row | null => value === null || isRecord(value),
  count: (value: unknown): value is number => typeof value === 'number',
} as const;

async function ormCallContentHash(source: ActivitySource, call: OrmCall<unknown>): Promise<string> {
  return hashContent(
    canonicalStringify({
      kind: 'orm-call',
      method: call.method,
      hashInput: await call.hashInput(source),
    }),
  );
}

/** Starts the call in the same turn as the terminal method, so a runtime closed after the method returns waits for it. The content hash is computed only when a middleware asks for it. */
function startOrmCall<Result>(
  source: ActivitySource,
  call: OrmCall<Result>,
): Promise<ActivityHandle<'orm-call'>> {
  return source.startActivity({
    kind: 'orm-call',
    contentHash: () => ormCallContentHash(source, call),
    ...(call.annotations === undefined ? {} : { annotations: call.annotations }),
  });
}

/** Ends a call whose work failed. The runtime has ended the activity `failed` even when `end` rejects, so the caller gets the error that failed the call; the error from `end`, such as one an `activityEnded` hook threw, becomes its `cause` when it has none. */
async function endFailed(handle: ActivityHandle<'orm-call'>, failure: unknown): Promise<void> {
  try {
    await handle.end({ outcome: 'failed' });
  } catch (endError) {
    if (failure instanceof Error && failure.cause === undefined) {
      failure.cause = endError;
    }
  }
}

async function interceptedResult<Result>(
  handle: ActivityHandle<'orm-call'>,
  call: OrmCall<Result>,
  intercepted: { readonly result: unknown },
): Promise<Result> {
  const { result } = intercepted;
  if (!call.accepts(result)) {
    const invalid = ormError(
      'ORM.INTERCEPTED_RESULT_INVALID',
      `A middleware answered ${call.method}() with a value that is not a result of ${call.method}()`,
      { meta: { method: call.method } },
    );
    await endFailed(handle, invalid);
    throw invalid;
  }
  await handle.end({ outcome: 'succeeded' });
  return result;
}

function activitySourceOf(queryable: RuntimeScope, method: string): ActivitySource {
  const source = findActivitySource(queryable);
  if (source === undefined) {
    throw ormError(
      'ORM.ACTIVITY_SOURCE_MISSING',
      `${method}() runs as an orm-call activity, and the queryable it was given has no activity source`,
      {
        fix: 'Pass the ORM a runtime, connection or transaction from the SQL runtime, or a wrapper that keeps its [activitySource] member.',
        meta: { method },
      },
    );
  }
  return source;
}

export async function runOrmCall<Result>(
  queryable: RuntimeScope,
  call: OrmCall<Result>,
  run: (queryable: RuntimeQueryable) => Promise<Result>,
): Promise<Result> {
  const handle = await startOrmCall(activitySourceOf(queryable, call.method), call);
  if (handle.intercepted !== undefined) {
    return interceptedResult(handle, call, handle.intercepted);
  }
  let result: Result;
  try {
    result = await run(handle);
  } catch (error) {
    await endFailed(handle, error);
    throw error;
  }
  await handle.end({ outcome: 'succeeded', result });
  return result;
}

/** The call ends when the caller reads to the end, stops early or the stream fails. Its result holds the rows only when it carries annotations, so an unannotated stream does not hold its rows. */
export function streamOrmCall<Row>(
  queryable: RuntimeScope,
  call: OrmCall<Row[]>,
  run: (queryable: RuntimeQueryable) => AsyncIterableResult<Row>,
): AsyncIterableResult<Row> {
  return new AsyncIterableResult(
    new OrmCallRows(activitySourceOf(queryable, call.method), call, run),
  );
}

const done = { done: true, value: undefined } as const;

/**
 * The rows of a streaming call. The call starts on the first `next()`. Like an async generator, it runs one `next()`, `return()` or `throw()` at a time and queues the calls that overlap it; unlike one, it forwards each row from the statement's iterator with a single promise.
 */
class OrmCallRows<Row> implements AsyncGenerator<Row, void, unknown> {
  readonly #source: ActivitySource;
  readonly #call: OrmCall<Row[]>;
  readonly #run: (queryable: RuntimeQueryable) => AsyncIterableResult<Row>;
  #state: 'idle' | 'running' | 'intercepted' | 'finished' = 'idle';
  #handle: ActivityHandle<'orm-call'> | undefined;
  #inner: AsyncIterator<Row, void, unknown> | undefined;
  #intercepted: Iterator<Row> | undefined;
  #collected: Row[] | undefined;
  #busy = false;
  readonly #waiting: Array<() => void> = [];

  constructor(
    source: ActivitySource,
    call: OrmCall<Row[]>,
    run: (queryable: RuntimeQueryable) => AsyncIterableResult<Row>,
  ) {
    this.#source = source;
    this.#call = call;
    this.#run = run;
  }

  next(): Promise<IteratorResult<Row, void>> {
    return this.#enqueue(() => this.#next());
  }

  return(): Promise<IteratorResult<Row, void>> {
    return this.#enqueue(() => this.#return());
  }

  throw(error: unknown): Promise<IteratorResult<Row, void>> {
    return this.#enqueue(() => this.#throw(error));
  }

  [Symbol.asyncIterator](): this {
    return this;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.return();
  }

  #enqueue(
    operation: () => Promise<IteratorResult<Row, void>>,
  ): Promise<IteratorResult<Row, void>> {
    if (!this.#busy) {
      this.#busy = true;
      return operation();
    }
    return new Promise((resolve, reject) => {
      this.#waiting.push(() => {
        operation().then(resolve, reject);
      });
    });
  }

  #release(): void {
    const waiting = this.#waiting.shift();
    if (waiting === undefined) {
      this.#busy = false;
    } else {
      waiting();
    }
  }

  #next(): Promise<IteratorResult<Row, void>> {
    switch (this.#state) {
      case 'idle':
        return this.#start().then(
          () => this.#next(),
          (error: unknown) => {
            this.#release();
            throw error;
          },
        );
      case 'running':
        return this.#nextRow();
      case 'intercepted': {
        const row = this.#intercepted?.next();
        this.#release();
        if (row === undefined || row.done === true) {
          this.#state = 'finished';
          return Promise.resolve(done);
        }
        return Promise.resolve({ done: false, value: row.value });
      }
      default:
        this.#release();
        return Promise.resolve(done);
    }
  }

  async #return(): Promise<IteratorResult<Row, void>> {
    try {
      const handle = this.#handle;
      if (this.#state !== 'running' || handle === undefined) {
        this.#state = 'finished';
        return done;
      }
      this.#state = 'finished';
      try {
        await this.#inner?.return?.();
      } catch (error) {
        await endFailed(handle, error);
        throw error;
      }
      await handle.end({ outcome: 'stopped' });
      return done;
    } finally {
      this.#release();
    }
  }

  async #throw(error: unknown): Promise<IteratorResult<Row, void>> {
    try {
      const handle = this.#handle;
      if (this.#state !== 'running' || handle === undefined) {
        this.#state = 'finished';
        throw error;
      }
      this.#state = 'finished';
      try {
        await this.#inner?.return?.();
      } catch {
        // As when a generator closes its iterator because of a throw, the thrown error is the one kept.
      }
      await endFailed(handle, error);
      throw error;
    } finally {
      this.#release();
    }
  }

  async #start(): Promise<void> {
    let handle: ActivityHandle<'orm-call'>;
    try {
      handle = await startOrmCall(this.#source, this.#call);
    } catch (error) {
      this.#state = 'finished';
      throw error;
    }
    this.#handle = handle;
    if (handle.intercepted !== undefined) {
      try {
        const rows = await interceptedResult(handle, this.#call, handle.intercepted);
        this.#intercepted = rows[Symbol.iterator]();
      } catch (error) {
        this.#state = 'finished';
        throw error;
      }
      this.#state = 'intercepted';
      return;
    }
    const annotations = this.#call.annotations;
    this.#collected = annotations !== undefined && annotations.size > 0 ? [] : undefined;
    try {
      this.#inner = this.#run(handle)[Symbol.asyncIterator]();
    } catch (error) {
      this.#state = 'finished';
      await endFailed(handle, error);
      throw error;
    }
    this.#state = 'running';
  }

  #nextRow(): Promise<IteratorResult<Row, void>> {
    const inner = this.#inner;
    const handle = this.#handle;
    if (inner === undefined || handle === undefined) {
      this.#release();
      return Promise.resolve(done);
    }
    let pending: Promise<IteratorResult<Row, void>>;
    try {
      pending = inner.next();
    } catch (error) {
      return this.#fail(handle, error);
    }
    return pending.then<IteratorResult<Row, void>, never>(
      (result) => {
        if (result.done !== true) {
          this.#collected?.push(result.value);
          this.#release();
          return result;
        }
        this.#state = 'finished';
        const collected = this.#collected;
        return handle
          .end(
            collected === undefined
              ? { outcome: 'succeeded' }
              : { outcome: 'succeeded', result: collected },
          )
          .then(
            () => {
              this.#release();
              return done;
            },
            (endError: unknown) => {
              this.#release();
              throw endError;
            },
          );
      },
      (error: unknown) => this.#fail(handle, error),
    );
  }

  async #fail(handle: ActivityHandle<'orm-call'>, error: unknown): Promise<never> {
    try {
      this.#state = 'finished';
      await endFailed(handle, error);
      throw error;
    } finally {
      this.#release();
    }
  }
}

const preparedOrmCall = Symbol('preparedOrmCall');

export type PreparedOrmCall<DbRow, Result> = (
  target: RuntimeScope,
  rows: (queryable: RuntimeQueryable) => AsyncIterableResult<DbRow>,
  hashInput: CallHashInput,
) => Result;

interface PreparableOrmCall<DbRow, Result> extends Preparable<DbRow, Result> {
  readonly [preparedOrmCall]: PreparedOrmCall<DbRow, Result>;
}

export function asPreparedOrmCall<DbRow, Result>(
  preparable: Preparable<DbRow, Result>,
  call: PreparedOrmCall<DbRow, Result>,
): Preparable<DbRow, Result> {
  const marked: PreparableOrmCall<DbRow, Result> = { ...preparable, [preparedOrmCall]: call };
  return marked;
}

function isPreparableOrmCall<DbRow, Result>(
  preparable: Preparable<DbRow, Result>,
): preparable is PreparableOrmCall<DbRow, Result> {
  return preparedOrmCall in preparable;
}

export function preparedOrmCallOf<DbRow, Result>(
  preparable: Preparable<DbRow, Result>,
): PreparedOrmCall<DbRow, Result> | undefined {
  return isPreparableOrmCall(preparable) ? preparable[preparedOrmCall] : undefined;
}

export function preparedRowsCall<DbRow, Row>(
  method: string,
  annotations: Annotations | undefined,
  consume: (rows: AsyncIterableResult<DbRow>) => AsyncIterableResult<Row>,
): PreparedOrmCall<DbRow, AsyncIterableResult<Row>> {
  return (target, rows, hashInput) =>
    streamOrmCall(
      target,
      { method, annotations, hashInput, accepts: ormResults.rows<Row> },
      (queryable) => consume(rows(queryable)),
    );
}

export function preparedValueCall<DbRow, Result>(
  method: string,
  annotations: Annotations | undefined,
  consume: (rows: AsyncIterableResult<DbRow>) => Promise<Result>,
  accepts: (value: unknown) => value is Result,
): PreparedOrmCall<DbRow, Promise<Result>> {
  return (target, rows, hashInput) =>
    runOrmCall(target, { method, annotations, hashInput, accepts }, (queryable) =>
      consume(rows(queryable)),
    );
}
