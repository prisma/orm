import { runtimeError, type TransactionActivityRun } from '@internal/framework-components/runtime';

export interface TransactionLevelShared {
  readonly signal: AbortSignal;
  nextSavepointName(): string;
  logDroppedError(error: unknown): void;
}

interface OpenSavepoint {
  readonly name: string;
  readonly level: TransactionLevel;
}

export class TransactionLevel {
  readonly shared: TransactionLevelShared;
  readonly #parent: TransactionLevel | undefined;
  activity: TransactionActivityRun | undefined;
  #openChild: OpenSavepoint | undefined;
  #settled = false;
  #invalidated = false;

  constructor(
    shared: TransactionLevelShared,
    parent: TransactionLevel | undefined,
    activity: TransactionActivityRun | undefined,
  ) {
    this.shared = shared;
    this.#parent = parent;
    this.activity = activity;
  }

  get settled(): boolean {
    return this.#settled;
  }

  get invalidated(): boolean {
    return this.#invalidated;
  }

  get closed(): boolean {
    return this.#settled || this.#invalidated || (this.#parent?.closed ?? false);
  }

  assertAcceptsWork(): void {
    this.assertOpen();
    if (this.#openChild !== undefined) throw transactionSuspendedError(this.#openChild);
  }

  assertOpen(): void {
    if (this.#invalidated || (this.#parent !== undefined && this.closed)) {
      throw transactionClosedError();
    }
  }

  openSavepoint(): OpenSavepoint {
    if (this.closed) throw transactionClosedError();
    if (this.#openChild !== undefined) throw savepointAlreadyOpenError(this.#openChild);
    this.#openChild = {
      name: this.shared.nextSavepointName(),
      level: new TransactionLevel(this.shared, this, undefined),
    };
    return this.#openChild;
  }

  close(): void {
    this.#settled = true;
  }

  settle(): void {
    this.#settled = true;
    const parent = this.#parent;
    if (parent !== undefined && parent.#openChild?.level === this) parent.#openChild = undefined;
  }

  invalidateEnclosing(): void {
    for (let level = this.#parent; level !== undefined; level = level.#parent) {
      level.#invalidated = true;
    }
  }

  closeOpenSavepoints(): (outcome: 'succeeded' | 'failed') => Promise<void> {
    const closed: TransactionActivityRun[] = [];
    for (let child = this.#openChild; child !== undefined; child = child.level.#openChild) {
      child.level.#settled = true;
      if (child.level.activity !== undefined) closed.unshift(child.level.activity);
    }
    this.#openChild = undefined;
    return async (outcome) => {
      for (const activity of closed) {
        await activity
          .end({ by: 'rollback', outcome, commitAttempted: false })
          .catch(this.shared.logDroppedError);
      }
    };
  }
}

export function transactionClosedError(): Error {
  return runtimeError(
    'RUNTIME.TRANSACTION_CLOSED',
    'Cannot use a transaction operation after the transaction has ended. Consume query results and await execute calls inside the transaction callback.',
    {},
  );
}

function transactionSuspendedError(open: OpenSavepoint): Error {
  return runtimeError(
    'RUNTIME.TRANSACTION_SUSPENDED',
    `Savepoint ${open.name} is open on this transaction; commit or roll it back before using the transaction again.`,
    { savepointId: open.level.activity?.activity.id },
  );
}

function savepointAlreadyOpenError(open: OpenSavepoint): Error {
  return runtimeError(
    'RUNTIME.TRANSACTION_ALREADY_OPEN',
    `Savepoint ${open.name} is already open on this transaction; commit or roll it back before opening another.`,
    { savepointId: open.level.activity?.activity.id },
  );
}
