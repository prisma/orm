import { describe, expect, it } from 'vitest';
import { type StackEntry, TransactionStack } from '../src/transaction-stack';

const entry = (name: string | undefined): StackEntry => ({
  name,
  activity: undefined,
  commitEnding: undefined,
  state: 'open',
});

describe('TransactionStack', () => {
  it('pushes and pops entries in last-in, first-out order and reports the top', () => {
    const stack = new TransactionStack();
    const outer = entry(undefined);
    const savepoint = entry('sp_1');

    expect(stack.top).toBeUndefined();
    stack.push(outer);
    stack.push(savepoint);

    expect(stack.top).toBe(savepoint);
    expect(stack.pop()).toBe(savepoint);
    expect(stack.top).toBe(outer);
    expect(stack.pop()).toBe(outer);
    expect(stack.top).toBeUndefined();
  });

  it('tells by identity whether an entry is on the stack', () => {
    const stack = new TransactionStack();
    const onStack = entry('sp_1');
    stack.push(onStack);

    expect(stack.includes(onStack)).toBe(true);
    expect(stack.includes(entry('sp_1'))).toBe(false);
    stack.pop();
    expect(stack.includes(onStack)).toBe(false);
  });

  it('throws when popping an empty stack', () => {
    expect(() => new TransactionStack().pop()).toThrow();
  });

  it('names savepoints sp_1, sp_2 and on, counting up even after pops', () => {
    const stack = new TransactionStack();

    expect(stack.nextSavepointName()).toBe('sp_1');
    stack.push(entry('sp_1'));
    stack.pop();
    expect(stack.nextSavepointName()).toBe('sp_2');
    expect(new TransactionStack().nextSavepointName()).toBe('sp_1');
  });

  it('stays invalidated once invalidated', () => {
    const stack = new TransactionStack();

    expect(stack.invalidated).toBe(false);
    stack.invalidate();
    stack.invalidate();
    expect(stack.invalidated).toBe(true);
  });
});
