import type { DiffableNode } from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import { issueLabel } from '../../src/orm/db/verification';

const node: DiffableNode = {
  id: 'default',
  nodeKind: 'sql-column-default',
  isEqualTo: () => false,
  children: () => [],
};

describe('issueLabel', () => {
  it('names the outcome and the path', () => {
    expect(
      issueLabel({ path: ['public', 'event', 'at', 'default'], expected: node, actual: node }),
    ).toBe('mismatch: public/event/at/default');
  });

  it('adds the explanation a mismatch carries', () => {
    expect(
      issueLabel({
        path: ['public', 'event', 'at', 'default'],
        expected: node,
        actual: node,
        explanation: 'Re-emit the contract, then try again.',
      }),
    ).toBe('mismatch: public/event/at/default. Re-emit the contract, then try again.');
  });
});
