import type { Contract } from '@internal/contract/types';
import { createSqlContract } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { createContractSpaceAggregate, spacesInApplyOrder } from '../../src/aggregate/aggregate';
import { makeAggregateContractSpace } from '../fixtures';

function space(spaceId: string) {
  return makeAggregateContractSpace({
    spaceId,
    contract: createSqlContract({ target: 'postgres' }) as Contract,
  });
}

describe('spacesInApplyOrder', () => {
  it('lists the extension spaces in the aggregate’s order, then the app space', () => {
    const aggregate = createContractSpaceAggregate({
      targetId: 'postgres',
      app: space('app'),
      extensions: [space('pgvector'), space('audit')],
      checkIntegrity: () => [],
    });

    expect(spacesInApplyOrder(aggregate).map((s) => s.spaceId)).toEqual([
      'pgvector',
      'audit',
      'app',
    ]);
  });
});
