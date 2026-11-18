import { describe, expect, it } from 'vitest';
import { AsyncIterableResult } from '../src/execution/async-iterable-result';

describe('AsyncIterableResult', () => {
  it('works with for await loop', async () => {
    async function* generateItems(): AsyncGenerator<number, void, unknown> {
      yield 1;
      yield 2;
      yield 3;
    }

    const result = new AsyncIterableResult(generateItems());
    const items: number[] = [];

    for await (const item of result) {
      items.push(item);
    }

    expect(items).toEqual([1, 2, 3]);
  });

  it('toArray collects all values correctly', async () => {
    async function* generateItems(): AsyncGenerator<string, void, unknown> {
      yield 'a';
      yield 'b';
      yield 'c';
    }

    const result = new AsyncIterableResult(generateItems());
    const items = await result.toArray();

    expect(items).toEqual(['a', 'b', 'c']);
  });

  it('await collects all values via thenable behavior', async () => {
    async function* generateItems(): AsyncGenerator<number, void, unknown> {
      yield 1;
      yield 2;
      yield 3;
    }

    const result = new AsyncIterableResult(generateItems());
    const items = await result;

    expect(items).toEqual([1, 2, 3]);
  });

  it('returns the same promise for repeated toArray calls', async () => {
    async function* generateItems(): AsyncGenerator<number, void, unknown> {
      yield 1;
      yield 2;
      yield 3;
    }

    const result = new AsyncIterableResult(generateItems());
    const first = result.toArray();
    const second = result.toArray();

    expect(first).toBe(second);
    await expect(first).resolves.toEqual([1, 2, 3]);
    await expect(second).resolves.toEqual([1, 2, 3]);
  });

  it('shares one buffered execution across toArray and then', async () => {
    let executionCount = 0;

    async function* generateItems(): AsyncGenerator<number, void, unknown> {
      executionCount += 1;
      yield 1;
      yield 2;
      yield 3;
    }

    const result = new AsyncIterableResult(generateItems());
    const fromToArray = result.toArray();
    const fromThen = result.then((rows) => rows);

    await expect(fromToArray).resolves.toEqual([1, 2, 3]);
    await expect(fromThen).resolves.toEqual([1, 2, 3]);
    expect(executionCount).toBe(1);
  });

  it('handles empty results', async () => {
    async function* generateItems(): AsyncGenerator<number, void, unknown> {
      // No items
    }

    const result = new AsyncIterableResult(generateItems());
    const items = await result;

    expect(items).toEqual([]);
  });

  it('handles empty results with for await', async () => {
    async function* generateItems(): AsyncGenerator<number, void, unknown> {
      // No items
    }

    const result = new AsyncIterableResult(generateItems());
    const items: number[] = [];

    for await (const item of result) {
      items.push(item);
    }

    expect(items).toEqual([]);
  });

  it('propagates errors during iteration with for await', async () => {
    async function* generateItems(): AsyncGenerator<number, void, unknown> {
      yield 1;
      throw new Error('Test error');
    }

    const result = new AsyncIterableResult(generateItems());
    const items: number[] = [];

    await expect(async () => {
      for await (const item of result) {
        items.push(item);
      }
    }).rejects.toThrow('Test error');

    expect(items).toEqual([1]);
  });

  it('propagates errors during thenable consumption', async () => {
    async function* generateItems(): AsyncGenerator<number, void, unknown> {
      yield 1;
      throw new Error('Test error');
    }

    const result = new AsyncIterableResult(generateItems());

    await expect(result).rejects.toThrow('Test error');
    await expect(result.toArray()).rejects.toThrow('Test error');
  });

  it('throws error when iterating after toArray', async () => {
    async function* generateItems(): AsyncGenerator<number, void, unknown> {
      yield 1;
      yield 2;
      yield 3;
    }

    const result = new AsyncIterableResult(generateItems());
    await result.toArray();

    await expect(async () => {
      for await (const _item of result) {
        // Should not reach here
      }
    }).rejects.toThrow('AsyncIterableResult iterator has already been consumed');
  });

  it('throws error when iterating after await', async () => {
    async function* generateItems(): AsyncGenerator<number, void, unknown> {
      yield 1;
      yield 2;
      yield 3;
    }

    const result = new AsyncIterableResult(generateItems());
    await result;

    await expect(async () => {
      for await (const _item of result) {
        // Should not reach here
      }
    }).rejects.toThrow('AsyncIterableResult iterator has already been consumed');
  });

  it('throws error when iterating after for await', async () => {
    async function* generateItems(): AsyncGenerator<number, void, unknown> {
      yield 1;
      yield 2;
      yield 3;
    }

    const result = new AsyncIterableResult(generateItems());

    const items: number[] = [];
    for await (const item of result) {
      items.push(item);
    }
    expect(items).toEqual([1, 2, 3]);

    await expect(async () => {
      for await (const _item of result) {
        // Should not reach here
      }
    }).rejects.toThrow('AsyncIterableResult iterator has already been consumed');
  });

  it('throws error when calling toArray after for await', async () => {
    async function* generateItems(): AsyncGenerator<number, void, unknown> {
      yield 1;
      yield 2;
      yield 3;
    }

    const result = new AsyncIterableResult(generateItems());

    const items: number[] = [];
    for await (const item of result) {
      items.push(item);
    }
    expect(items).toEqual([1, 2, 3]);

    await expect(result.toArray()).rejects.toThrow(
      'AsyncIterableResult iterator has already been consumed',
    );
  });

  it('throws error when awaiting after for await', async () => {
    async function* generateItems(): AsyncGenerator<number, void, unknown> {
      yield 1;
      yield 2;
      yield 3;
    }

    const result = new AsyncIterableResult(generateItems());

    const items: number[] = [];
    for await (const item of result) {
      items.push(item);
    }
    expect(items).toEqual([1, 2, 3]);

    await expect(result).rejects.toThrow('AsyncIterableResult iterator has already been consumed');
  });
});

describe('AsyncIterableResult.rejected', () => {
  it('rejects the first read with the error, not the call', async () => {
    const failure = new Error('client is closed');
    const result = AsyncIterableResult.rejected<number>(failure);

    await expect(result.toArray()).rejects.toBe(failure);
  });
});
