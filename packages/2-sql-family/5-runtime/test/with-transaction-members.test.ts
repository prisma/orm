import { describe, expect, it } from 'vitest';
import type { TransactionContext } from '../src/exports/index';
import { withTransactionMembers } from '../src/exports/index';

describe('withTransactionMembers', () => {
  it('adds the members and keeps the context accessors live', () => {
    let ended = false;
    const txCtx = {
      get invalidated() {
        return ended;
      },
    } as unknown as TransactionContext;

    const tx = withTransactionMembers(txCtx, { greeting: 'hello' });
    const before = tx.invalidated;
    ended = true;

    expect({ greeting: tx.greeting, before, after: tx.invalidated }).toEqual({
      greeting: 'hello',
      before: false,
      after: true,
    });
  });
});
