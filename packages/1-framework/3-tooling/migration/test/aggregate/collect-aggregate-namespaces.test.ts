import type { Contract } from '@internal/contract/types';
import { createSqlContract } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import {
  collectAggregateNamespaces,
  createContractSpaceAggregate,
} from '../../src/aggregate/aggregate';
import type { AggregateContractSpace, ContractSpaceAggregate } from '../../src/aggregate/types';
import { makeAggregateContractSpace } from '../fixtures';

function makeSpace(
  spaceId: string,
  namespaces: Record<string, { table?: Record<string, unknown>; enum?: Record<string, unknown> }>,
): AggregateContractSpace {
  return makeAggregateContractSpace({
    spaceId,
    contract: createSqlContract({
      target: 'postgres',
      storage: {
        namespaces: Object.fromEntries(
          Object.entries(namespaces).map(([id, entries]) => [id, { id, entries }]),
        ),
      },
    }) as Contract,
  });
}

function makeAggregate(
  app: AggregateContractSpace,
  extensions: AggregateContractSpace[],
): ContractSpaceAggregate {
  return createContractSpaceAggregate({
    targetId: 'postgres',
    app,
    extensions,
    checkIntegrity: () => [],
  });
}

describe('collectAggregateNamespaces', () => {
  it('unions tables when two contract spaces share a namespaceId', () => {
    const app = makeSpace('app', { public: { table: { user: {} } } });
    const ext = makeSpace('cipher', { public: { table: { cipher_state: {} } } });

    const collected = collectAggregateNamespaces(makeAggregate(app, [ext]));

    expect(
      Object.keys(collected.storage.namespaces['public']?.entries['table'] ?? {}).sort(),
    ).toEqual(['cipher_state', 'user']);
  });

  it('unions per entity kind, keeping kinds only one space declares', () => {
    const app = makeSpace('app', {
      public: { table: { user: {} }, enum: { status: {} } },
    });
    const ext = makeSpace('cipher', { public: { table: { audit_log: {} } } });

    const collected = collectAggregateNamespaces(makeAggregate(app, [ext]));
    const entries = collected.storage.namespaces['public']?.entries ?? {};

    expect(Object.keys(entries['table'] ?? {}).sort()).toEqual(['audit_log', 'user']);
    expect(Object.keys(entries['enum'] ?? {})).toEqual(['status']);
  });

  it('keeps disjoint namespaces side by side', () => {
    const app = makeSpace('app', { public: { table: { user: {} } } });
    const ext = makeSpace('cipher', { vault: { table: { secret: {} } } });

    const collected = collectAggregateNamespaces(makeAggregate(app, [ext]));

    expect(Object.keys(collected.storage.namespaces).sort()).toEqual(['public', 'vault']);
    expect(Object.keys(collected.storage.namespaces['public']?.entries['table'] ?? {})).toEqual([
      'user',
    ]);
    expect(Object.keys(collected.storage.namespaces['vault']?.entries['table'] ?? {})).toEqual([
      'secret',
    ]);
  });

  it('carries each space contract, so a table is read with the contract of its own space', () => {
    const app = makeSpace('app', { public: { table: { user: {} } } });
    const ext = makeSpace('cipher', { vault: { table: { secret: {} } } });

    const collected = collectAggregateNamespaces(makeAggregate(app, [ext]));

    expect(collected.contracts).toEqual([app.contract(), ext.contract()]);
  });
});
