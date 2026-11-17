import type { TransactionActivityRun } from '@internal/framework-components/runtime';
import { invariant } from '@internal/utils/assertions';
import type { SqlMiddlewareContext } from './middleware/sql-middleware';

export type TransactionState = 'open' | 'commit-failed' | 'committed' | 'rolled-back';

export interface StackEntry {
  readonly name: string | undefined;
  activity: TransactionActivityRun<SqlMiddlewareContext> | undefined;
  commitEnding: Promise<void> | undefined;
  state: TransactionState;
}

export class TransactionStack {
  readonly #entries: StackEntry[] = [];
  #savepoints = 0;
  #invalidated = false;

  push(entry: StackEntry): void {
    this.#entries.push(entry);
  }

  pop(): StackEntry {
    const entry = this.#entries.pop();
    invariant(entry !== undefined, 'The transaction stack is empty');
    return entry;
  }

  get top(): StackEntry | undefined {
    return this.#entries.at(-1);
  }

  includes(entry: StackEntry): boolean {
    return this.#entries.includes(entry);
  }

  nextSavepointName(): string {
    this.#savepoints += 1;
    return `sp_${this.#savepoints}`;
  }

  invalidate(): void {
    this.#invalidated = true;
  }

  get invalidated(): boolean {
    return this.#invalidated;
  }
}
