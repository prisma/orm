import type { Contract } from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { createAggregateContractSpace } from '@internal/migration-tools/aggregate';
import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import { createSqlContract } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { planSpacePath } from '../../src/control-api/operations/migrate';

const HEAD_HASH = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function makeContract(control: 'external' | 'managed'): Contract {
  const base = createSqlContract({
    target: 'postgres',
    storage: {
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: {
          id: UNBOUND_NAMESPACE_ID,
          entries: { table: { user: {} } },
        },
      },
    },
  });
  return control === 'external' ? { ...base, defaultControlPolicy: 'external' } : base;
}

function makeEmptyGraphSpace(
  spaceId: string,
  invariants: readonly string[] = [],
  control: 'external' | 'managed' = 'external',
) {
  const contract = makeContract(control);
  return createAggregateContractSpace({
    spaceId,
    packages: [],
    refs: {},
    headRef: { hash: HEAD_HASH, invariants: [...invariants] },
    refsDir: '/tmp/refs',
    migrationsDir: '/tmp/migrations',
    resolveContract: () => contract,
    deserializeContract: (json) => json as Contract,
  });
}

const aggregate = { targetId: 'postgres', app: { spaceId: 'app' } } as Pick<
  Parameters<typeof planSpacePath>[0]['aggregate'],
  'targetId' | 'app'
>;

describe('planSpacePath — empty-graph spaces', () => {
  it('an all-external extension space with no marker resolves declaratively to its head ref', () => {
    const outcome = planSpacePath({
      space: makeEmptyGraphSpace('supabase'),
      aggregate,
      targetHash: HEAD_HASH,
      refInvariants: undefined,
      liveMarker: null,
    });

    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(outcome.plan.plan.operations).toEqual([]);
    expect(outcome.plan.plan.origin).toBeNull();
    expect(outcome.plan.plan.destination).toEqual({ storageHash: HEAD_HASH });
    expect(outcome.plan.strategy).toBe('declared-state');
  });

  it('an extension space with a stale marker advances declaratively to the new head', () => {
    const outcome = planSpacePath({
      space: makeEmptyGraphSpace('supabase'),
      aggregate,
      targetHash: HEAD_HASH,
      refInvariants: undefined,
      liveMarker: {
        storageHash: '01d0000000000000000000000000000000000000000000000000000000000000',
        invariants: [],
      },
    });

    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(outcome.plan.plan.operations).toEqual([]);
    expect(outcome.plan.plan.destination).toEqual({ storageHash: HEAD_HASH });
  });

  it('an extension space already at head stays an at-head resolution (no marker rewrite)', () => {
    const outcome = planSpacePath({
      space: makeEmptyGraphSpace('supabase'),
      aggregate,
      targetHash: HEAD_HASH,
      refInvariants: undefined,
      liveMarker: { storageHash: HEAD_HASH, invariants: [] },
    });

    expect(outcome.kind).toBe('at-head');
  });

  it('an extension space whose head requires invariants stays unsatisfiable', () => {
    const outcome = planSpacePath({
      space: makeEmptyGraphSpace('supabase', ['ext:install-v1']),
      aggregate,
      targetHash: HEAD_HASH,
      refInvariants: undefined,
      liveMarker: null,
    });

    expect(outcome.kind).toBe('unsatisfiable');
    if (outcome.kind !== 'unsatisfiable') return;
    expect(outcome.missing).toEqual(['ext:install-v1']);
  });

  it('an extension space with a MANAGED element and no migrations is never-planned, not advanced', () => {
    // Advancing a marker without migrations is valid only when nothing in
    // the space is Prisma 8-managed. A managed element with no authored
    // graph is an authoring bug and must fail loudly.
    const outcome = planSpacePath({
      space: makeEmptyGraphSpace('broken-extension', [], 'managed'),
      aggregate,
      targetHash: HEAD_HASH,
      refInvariants: undefined,
      liveMarker: null,
    });

    expect(outcome).toEqual({
      kind: 'never-planned',
      spaceId: 'broken-extension',
      targetHash: HEAD_HASH,
    });
  });

  it('the APP space with an empty graph and a pending target stays never-planned', () => {
    const outcome = planSpacePath({
      space: makeEmptyGraphSpace('app'),
      aggregate,
      targetHash: HEAD_HASH,
      refInvariants: undefined,
      liveMarker: null,
    });

    expect(outcome).toEqual({ kind: 'never-planned', spaceId: 'app', targetHash: HEAD_HASH });
  });

  it('a greenfield extension space whose target is the empty sentinel stays at-head', () => {
    const contract = makeContract('external');
    const space = createAggregateContractSpace({
      spaceId: 'supabase',
      packages: [],
      refs: {},
      headRef: { hash: EMPTY_CONTRACT_HASH, invariants: [] },
      refsDir: '/tmp/refs',
      migrationsDir: '/tmp/migrations',
      resolveContract: () => contract,
      deserializeContract: (json) => json as Contract,
    });
    const outcome = planSpacePath({
      space,
      aggregate,
      targetHash: EMPTY_CONTRACT_HASH,
      refInvariants: undefined,
      liveMarker: null,
    });

    expect(outcome.kind).toBe('at-head');
  });
});
