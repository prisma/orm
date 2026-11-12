import { describe, expect, it, vi } from 'vitest';
import { deleteAllGraph } from '../../src/mutation-graph/collection-graphs';
import type { Rule } from '../../src/mutation-graph/rules';
import { createCollectionFor, withReturningCapability } from '../collection-fixtures';
import { getTestContext } from '../helpers';
import { printGraph } from './print-graph';

const order = vi.hoisted(() => ({ reversed: false }));

vi.mock('../../src/mutation-graph/rules', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/mutation-graph/rules')>();
  return {
    ...actual,
    rulesFor: (...args: Parameters<typeof actual.rulesFor>): readonly Rule[] => {
      const rules = actual.rulesFor(...args);
      return order.reversed ? [...rules].reverse() : rules;
    },
  };
});

describe('the rules, in either order', () => {
  it.each([false, true])('build one Delete for a keyed deleteAll, reversed: %s', (reversed) => {
    order.reversed = reversed;
    const context = { ...getTestContext() };
    const contract = withReturningCapability(context.contract);
    const users = createCollectionFor('User', contract).collection.where({ name: 'Ada' });
    const graph = deleteAllGraph(
      {
        context: { ...context, contract },
        state: users.state,
        modelName: 'User',
        namespaceId: 'public',
      },
      'rows',
    );
    graph.removeUnreadFinds();

    expect(printGraph(graph)).toBe(["n1 Delete users where name = 'Ada'", 'result: n1'].join('\n'));
  });
});
