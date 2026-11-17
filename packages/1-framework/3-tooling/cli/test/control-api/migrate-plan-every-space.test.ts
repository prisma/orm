import type { Contract, LedgerEntryRecord } from '@internal/contract/types';
import type { MigrationPlanOperation } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { createAggregateContractSpace } from '@internal/migration-tools/aggregate';
import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import type { OnDiskMigrationPackage } from '@internal/migration-tools/package';
import { createSqlContract } from '@repo/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { planEverySpace, planSpacePath } from '../../src/control-api/operations/migrate';

const APP_A = 'a'.repeat(64);
const APP_B = 'b'.repeat(64);
const APP_ELSEWHERE = 'c'.repeat(64);
const APP_DELETED = 'd'.repeat(64);
const EXT_HEAD = 'e'.repeat(64);
const EXT_OLD = 'f'.repeat(64);
const EXT_DELETED = '9'.repeat(64);

const CREATE_TABLE: MigrationPlanOperation = {
  id: 'table.post',
  label: 'Create table post',
  operationClass: 'additive',
};

function migration(from: string, to: string, dirName: string): OnDiskMigrationPackage {
  return {
    dirName,
    dirPath: `/work/app/migrations/${dirName}`,
    metadata: {
      migrationHash: `sha256:${dirName}`,
      from,
      to,
      providedInvariants: [],
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    ops: [CREATE_TABLE],
  };
}

function contract(control: 'external' | 'managed'): Contract {
  const base = createSqlContract({
    target: 'postgres',
    storage: {
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: { id: UNBOUND_NAMESPACE_ID, entries: { table: { user: {} } } },
      },
    },
  });
  return control === 'external' ? { ...base, defaultControlPolicy: 'external' } : base;
}

function space(args: {
  readonly spaceId: string;
  readonly packages: readonly OnDiskMigrationPackage[];
  readonly head: string;
  readonly control?: 'external' | 'managed';
}) {
  const resolved = contract(args.control ?? 'managed');
  return createAggregateContractSpace({
    spaceId: args.spaceId,
    packages: args.packages,
    refs: {},
    headRef: { hash: args.head, invariants: [] },
    refsDir: '/work/app/migrations/refs',
    migrationsDir: '/work/app/migrations',
    resolveContract: () => resolved,
    deserializeContract: () => resolved,
  });
}

const app = space({
  spaceId: 'app',
  packages: [
    migration(EMPTY_CONTRACT_HASH, APP_A, '20260101T0000_initial'),
    migration(APP_A, APP_B, '20260102T0000_second'),
  ],
  head: APP_B,
});
const pgvector = space({
  spaceId: 'pgvector',
  packages: [migration(EMPTY_CONTRACT_HASH, EXT_HEAD, '20260101T0000_ext_initial')],
  head: EXT_HEAD,
});
const supabase = space({ spaceId: 'supabase', packages: [], head: EXT_HEAD, control: 'external' });

function markerAt(storageHash: string) {
  return { storageHash, invariants: [] };
}

const invocation = { cwd: '/work/app', configPath: undefined, dbGiven: false };

function planned(args: {
  readonly extensions: ReadonlyArray<ReturnType<typeof space>>;
  readonly markers: ReadonlyMap<string, { storageHash: string; invariants: readonly string[] }>;
  readonly appTargetHash?: string;
  readonly readLedger?: (spaceId: string) => Promise<readonly LedgerEntryRecord[]>;
}) {
  return planEverySpace({
    aggregate: { targetId: 'postgres', app, extensions: args.extensions },
    markers: args.markers,
    appTarget: { hash: args.appTargetHash ?? APP_B, invariants: undefined, refName: undefined },
    storageNameOf: (operation) => operation.id,
    migrationsDir: '/work/app/migrations',
    invocation,
    readLedger: args.readLedger ?? (async () => []),
  });
}

function planApp(liveMarker: string, targetHash = APP_B, onSpace = app) {
  return planSpacePath({
    space: onSpace,
    aggregate: { targetId: 'postgres', app: onSpace },
    targetHash,
    refInvariants: undefined,
    liveMarker: markerAt(liveMarker),
    storageNameOf: (operation) => operation.id,
  });
}

describe('planSpacePath with a marker outside the graph', () => {
  it('reports a marker that is not a graph node', () => {
    expect(planApp(APP_DELETED)).toEqual({
      kind: 'marker-outside-graph',
      spaceId: 'app',
      markerHash: APP_DELETED,
      targetHash: APP_B,
    });
  });

  it('reports the marker of an application space with no migrations', () => {
    const withoutMigrations = space({ spaceId: 'app', packages: [], head: APP_B });

    expect(planApp(APP_DELETED, APP_B, withoutMigrations)).toEqual({
      kind: 'marker-outside-graph',
      spaceId: 'app',
      markerHash: APP_DELETED,
      targetHash: APP_B,
    });
  });

  it('reports a marker outside the graph even when it is the target', () => {
    expect(planApp(APP_DELETED, APP_DELETED)).toEqual({
      kind: 'marker-outside-graph',
      spaceId: 'app',
      markerHash: APP_DELETED,
      targetHash: APP_DELETED,
    });
  });

  it('plans the path when the marker is a graph node', () => {
    const outcome = planApp(APP_A);

    expect(
      outcome.kind === 'ok' ? outcome.plan.migrationEdges.map((edge) => edge.dirName) : outcome,
    ).toEqual(['20260102T0000_second']);
  });
});

describe('planEverySpace', () => {
  it('advances an extension that ships no migrations from an older head, reading no ledger', async () => {
    const readLedger = vi.fn(async () => []);

    const result = await planned({
      extensions: [supabase],
      markers: new Map([
        ['app', markerAt(APP_B)],
        ['supabase', markerAt(EXT_OLD)],
      ]),
      readLedger,
    });

    expect(result.ok ? result.value.get('supabase')?.kind : result.failure.code).toBe('ok');
    expect(readLedger).not.toHaveBeenCalled();
  });

  it('refuses for an extension outside its graph before the application space fails to find a path', async () => {
    const result = await planned({
      extensions: [pgvector],
      markers: new Map([
        ['app', markerAt(APP_B)],
        ['pgvector', markerAt(EXT_DELETED)],
      ]),
      appTargetHash: APP_ELSEWHERE,
    });

    expect(result.ok ? undefined : result.failure.toEnvelope()).toMatchObject({
      code: 'MIGRATION.MARKER_MISMATCH',
      meta: { spaceId: 'pgvector', markerHash: EXT_DELETED, targetHash: EXT_HEAD },
    });
  });

  it('refuses for the application space first when several spaces are outside their graphs', async () => {
    const result = await planned({
      extensions: [pgvector],
      markers: new Map([
        ['app', markerAt(APP_DELETED)],
        ['pgvector', markerAt(EXT_DELETED)],
      ]),
    });

    expect(result.ok ? undefined : result.failure.toEnvelope().meta).toEqual({
      spaceId: 'app',
      markerHash: APP_DELETED,
      targetHash: APP_B,
      missingMigrations: [],
    });
  });

  it('explains the refusal from the ledger of the refused space', async () => {
    const readLedger = vi.fn(async (spaceId: string) => [
      {
        space: spaceId,
        migrationName: '20260101T0000_initial',
        migrationHash: 'sha256:20260101T0000_initial',
        from: null,
        to: APP_A,
        appliedAt: new Date(0),
        operationCount: 1,
      },
    ]);

    const result = await planned({
      extensions: [],
      markers: new Map([['app', markerAt(APP_DELETED)]]),
      readLedger,
    });

    expect(readLedger).toHaveBeenCalledWith('app');
    expect(result.ok ? undefined : result.failure.toEnvelope().meta).toEqual({
      spaceId: 'app',
      markerHash: APP_DELETED,
      targetHash: APP_B,
      lastGraphHash: APP_A,
      missingMigrations: [],
    });
  });

  it('refuses without the history when the ledger cannot be read', async () => {
    const result = await planned({
      extensions: [],
      markers: new Map([['app', markerAt(APP_DELETED)]]),
      readLedger: async () => {
        throw new Error('permission denied for table _prisma_ledger');
      },
    });

    expect(result.ok ? undefined : result.failure.toEnvelope().meta).toEqual({
      spaceId: 'app',
      markerHash: APP_DELETED,
      targetHash: APP_B,
    });
  });
});
