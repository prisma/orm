export class InFlightOperations {
  #count = 0;
  #started = 0;
  #drainWaiters: Array<() => void> = [];

  /** Records one operation as in flight; the returned callback ends it and ignores later calls. */
  begin(): () => void {
    this.#count += 1;
    this.#started += 1;
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      this.#count -= 1;
      if (this.#count === 0) {
        for (const wake of this.#drainWaiters.splice(0)) wake();
      }
    };
  }

  /** How many operations have begun so far; a change between two reads means work started in between. */
  get started(): number {
    return this.#started;
  }

  get active(): boolean {
    return this.#count > 0;
  }

  drained(): Promise<void> {
    if (this.#count === 0) return Promise.resolve();
    return new Promise((resolve) => this.#drainWaiters.push(resolve));
  }

  /** Records `work` as in flight until it settles. */
  async track<T>(work: () => Promise<T>): Promise<T> {
    const end = this.begin();
    try {
      return await work();
    } finally {
      end();
    }
  }
}
