import type { Contract } from '@internal/contract/types';
import { CliStructuredError } from '@internal/errors/control';
import {
  type AggregateContractSpace,
  createAggregateContractSpace,
} from '@internal/migration-tools/aggregate';
import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import { MigrationToolsError } from '@internal/migration-tools/errors';
import { reconstructGraph } from '@internal/migration-tools/migration-graph';
import type { OnDiskMigrationPackage } from '@internal/migration-tools/package';
import type { Refs } from '@internal/migration-tools/refs';
import { applicationDomainOf } from '@repo/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertFromIsGraphNode,
  looksLikeFullHash,
  type ResolveFromForPlanInput,
  type ResolveToForPlanInput,
  resolveFromForPlan,
  resolveToForPlan,
} from '../../src/control-api/operations/plan-resolution';
import type { ContractIR } from '../../src/control-api/operations/ref-advancement';

const E = EMPTY_CONTRACT_HASH;
const HASH_A = `${'a'.repeat(64)}`;
const HASH_B = `${'b'.repeat(64)}`;
const HASH_ORPHAN = `${'d'.repeat(64)}`;

let migrationCounter = 0;

function makePkg(from: string, to: string, dirName: string): OnDiskMigrationPackage {
  migrationCounter += 1;
  return {
    dirName,
    dirPath: `/migrations/app/${dirName}`,
    metadata: {
      from: from === E ? null : from,
      to,
      migrationHash: `mig-${migrationCounter.toString().padStart(64, '0')}`,
      createdAt: `2026-03-01T09:00:00.${migrationCounter.toString().padStart(3, '0')}Z`,
      providedInvariants: [],
    },
    ops: [],
  };
}

function sampleContractIR(storageHash: string): ContractIR {
  return {
    contract: {
      schemaVersion: '1',
      targetFamily: 'sql',
      target: 'postgres',
      profileHash: `${'p'.repeat(64)}`,
      storage: { storageHash },
      domain: applicationDomainOf({ models: {} }),
      roots: {},
    },
    contractDts: 'export type Contract = unknown;\n',
  };
}

function contractAtResult(
  storageHash: string,
  opts?: { readonly provenance?: 'ref' | 'graph-node' },
): {
  hash: string;
  contract: Contract;
  contractJson: unknown;
  contractDts: string;
  provenance: 'ref' | 'graph-node';
} {
  const ir = sampleContractIR(storageHash);
  const provenance = opts?.provenance ?? 'ref';
  return {
    hash: storageHash,
    contract: ir.contract as Contract,
    contractJson: ir.contract,
    contractDts: ir.contractDts,
    provenance,
  };
}

function makeSpace(
  packages: readonly OnDiskMigrationPackage[],
  refs: Refs = {},
  contractAtImpl?: ReturnType<typeof vi.fn>,
) {
  const space = createAggregateContractSpace({
    spaceId: 'app',
    packages,
    refs,
    headRef:
      packages.length > 0
        ? { hash: packages[packages.length - 1]!.metadata.to, invariants: [] }
        : null,
    refsDir: '/project/migrations/refs',
    migrationsDir: '/project/migrations',
    resolveContract: () => ({ storage: { storageHash: HASH_B } }) as Contract,
    deserializeContract: (json) => json as Contract,
  });
  if (contractAtImpl) {
    vi.spyOn(space, 'contractAt').mockImplementation(
      contractAtImpl as AggregateContractSpace['contractAt'],
    );
  }
  return space;
}

function baseInput(
  overrides: Partial<ResolveFromForPlanInput> & Pick<ResolveFromForPlanInput, 'space'>,
): ResolveFromForPlanInput {
  return {
    optionsFrom: undefined,
    ...overrides,
  };
}

function expectRefuse(error: CliStructuredError, migrationCode: string, fixFragment: string): void {
  expect(error.code).toBe(migrationCode);
  expect(error.fix).toContain(fixFragment);
}

describe('resolveFromForPlan', () => {
  beforeEach(() => {
    migrationCounter = 0;
  });

  it('returns greenfield when db ref is absent and --from is omitted', async () => {
    const space = makeSpace([]);
    const result = await resolveFromForPlan(baseInput({ space }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ kind: 'greenfield', fromHash: null, fromContract: null });
    }
  });

  it('returns auto-baseline when graph is empty and the db ref resolves through the store', async () => {
    const space = makeSpace(
      [],
      { db: { hash: HASH_ORPHAN, invariants: [] } },
      vi.fn().mockResolvedValue(contractAtResult(HASH_ORPHAN)),
    );
    const result = await resolveFromForPlan(baseInput({ space }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe('auto-baseline');
      if (result.value.kind === 'auto-baseline') {
        expect(result.value.fromHash).toBe(HASH_ORPHAN);
        expect(result.value.contractDts).toContain('Contract');
      }
    }
    expect(space.contractAt).toHaveBeenCalledWith(HASH_ORPHAN, { refName: 'db' });
  });

  it('returns auto-baseline for explicit ref name on an empty graph', async () => {
    const space = makeSpace(
      [],
      { staging: { hash: HASH_ORPHAN, invariants: [] } },
      vi.fn().mockResolvedValue(contractAtResult(HASH_ORPHAN)),
    );
    const result = await resolveFromForPlan(baseInput({ space, optionsFrom: 'staging' }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe('auto-baseline');
    }
  });

  it('returns ref-provenance for db ref at graph tip', async () => {
    const bundles = [makePkg(E, HASH_A, 'm1'), makePkg(HASH_A, HASH_B, 'm2')];
    const space = makeSpace(
      bundles,
      { db: { hash: HASH_B, invariants: [] } },
      vi.fn().mockResolvedValue(contractAtResult(HASH_B)),
    );
    const result = await resolveFromForPlan(baseInput({ space }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatchObject({ kind: 'ref', fromHash: HASH_B });
    }
  });

  it('returns ref-provenance for db ref at a non-tip graph node', async () => {
    const bundles = [makePkg(E, HASH_A, 'm1'), makePkg(HASH_A, HASH_B, 'm2')];
    const space = makeSpace(
      bundles,
      { db: { hash: HASH_A, invariants: [] } },
      vi.fn().mockResolvedValue(contractAtResult(HASH_A)),
    );
    const result = await resolveFromForPlan(baseInput({ space }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatchObject({ kind: 'ref', fromHash: HASH_A });
    }
  });

  it('refuses forgot-the-flag when db ref hash is not a graph node', async () => {
    const bundles = [makePkg(E, HASH_A, 'm1'), makePkg(HASH_A, HASH_B, 'm2')];
    const space = makeSpace(
      bundles,
      {
        db: { hash: HASH_ORPHAN, invariants: [] },
        staging: { hash: HASH_B, invariants: [] },
      },
      vi.fn().mockResolvedValue(contractAtResult(HASH_ORPHAN)),
    );
    const result = await resolveFromForPlan(baseInput({ space }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expectRefuse(result.failure, 'MIGRATION.HASH_NOT_IN_GRAPH', '--from staging');
      expect(result.failure.why).toContain(HASH_ORPHAN);
    }
  });

  it('refuses forgot-the-flag for explicit ref name whose hash is not a graph node', async () => {
    const bundles = [makePkg(E, HASH_A, 'm1')];
    const space = makeSpace(
      bundles,
      { staging: { hash: HASH_ORPHAN, invariants: [] } },
      vi.fn().mockResolvedValue(contractAtResult(HASH_ORPHAN)),
    );
    const result = await resolveFromForPlan(baseInput({ space, optionsFrom: 'staging' }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expectRefuse(result.failure, 'MIGRATION.HASH_NOT_IN_GRAPH', '--from');
    }
  });

  it('refuses forgot-the-flag for explicit full hash not in graph on non-empty graph', async () => {
    const bundles = [makePkg(E, HASH_A, 'm1')];
    const space = makeSpace(bundles, { tip: { hash: HASH_A, invariants: [] } });
    const result = await resolveFromForPlan(baseInput({ space, optionsFrom: HASH_ORPHAN }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expectRefuse(result.failure, 'MIGRATION.HASH_NOT_IN_GRAPH', '--from tip');
    }
    expect(looksLikeFullHash(HASH_ORPHAN)).toBe(true);
  });

  it('refuses snapshot-missing for explicit full hash not in graph on empty graph', async () => {
    const space = makeSpace([]);
    const result = await resolveFromForPlan(baseInput({ space, optionsFrom: HASH_ORPHAN }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expectRefuse(result.failure, 'MIGRATION.SNAPSHOT_MISSING', HASH_ORPHAN);
    }
  });

  it('returns graph-node for explicit full hash that is a graph node', async () => {
    const bundles = [makePkg(E, HASH_A, 'm1')];
    const contractAt = vi
      .fn()
      .mockResolvedValue(contractAtResult(HASH_A, { provenance: 'graph-node' }));
    const space = makeSpace(bundles, {}, contractAt);
    const result = await resolveFromForPlan(baseInput({ space, optionsFrom: HASH_A }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatchObject({
        kind: 'graph-node',
        fromHash: HASH_A,
      });
    }
    expect(contractAt).toHaveBeenCalledWith(HASH_A, undefined);
  });

  it('refuses ref-not-resolvable for db ref whose pointer is absent and hash is not a graph node', async () => {
    const space = makeSpace(
      [],
      { db: { hash: HASH_ORPHAN, invariants: [] } },
      vi.fn().mockRejectedValue(
        new MigrationToolsError('MIGRATION.REF_NOT_RESOLVABLE', `Ref "db" is not resolvable`, {
          why: 'Ref "db" has no pointer file, and the hash being resolved is not a node in the migration graph either.',
          fix: 'Create the ref with "{bin} migration ref set db <hash>" (or advance it via "{bin} db update --advance-ref db"), or pass a hash that is a node in the migration graph.',
          meta: { refName: 'db' },
        }),
      ),
    );
    const result = await resolveFromForPlan(baseInput({ space }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expectRefuse(result.failure, 'MIGRATION.SNAPSHOT_MISSING', 'db update --advance-ref db');
      expect(result.failure.fix).toContain('ref set db');
    }
  });

  it('falls back to graph-node bundle source when the db ref pointer is absent but the hash is a graph node', async () => {
    const bundles = [makePkg(E, HASH_A, 'm1')];
    const space = makeSpace(
      bundles,
      { db: { hash: HASH_A, invariants: [] } },
      vi.fn().mockResolvedValue(contractAtResult(HASH_A, { provenance: 'graph-node' })),
    );
    const result = await resolveFromForPlan(baseInput({ space }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatchObject({
        kind: 'graph-node',
        fromHash: HASH_A,
      });
    }
  });

  it('returns graph-node for explicit ref when the pointer is absent but hash is a graph node', async () => {
    const bundles = [makePkg(E, HASH_A, 'm1')];
    const space = makeSpace(
      bundles,
      { staging: { hash: HASH_A, invariants: [] } },
      vi.fn().mockResolvedValue(contractAtResult(HASH_A, { provenance: 'graph-node' })),
    );
    const result = await resolveFromForPlan(baseInput({ space, optionsFrom: 'staging' }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatchObject({
        kind: 'graph-node',
        fromHash: HASH_A,
      });
    }
    expect(space.contractAt).toHaveBeenCalledWith(HASH_A, { refName: 'staging' });
  });

  it('refuses ref-not-resolvable for an explicit ref whose pointer is absent and hash is not a graph node', async () => {
    const space = makeSpace(
      [],
      { staging: { hash: HASH_ORPHAN, invariants: [] } },
      vi.fn().mockRejectedValue(
        new MigrationToolsError('MIGRATION.REF_NOT_RESOLVABLE', `Ref "staging" is not resolvable`, {
          why: 'Ref "staging" has no pointer file, and the hash being resolved is not a node in the migration graph either.',
          fix: 'Create the ref with "{bin} migration ref set staging <hash>" (or advance it via "{bin} db update --advance-ref staging"), or pass a hash that is a node in the migration graph.',
          meta: { refName: 'staging' },
        }),
      ),
    );
    const result = await resolveFromForPlan(baseInput({ space, optionsFrom: 'staging' }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expectRefuse(result.failure, 'MIGRATION.SNAPSHOT_MISSING', 'advance-ref staging');
    }
  });

  it('surfaces contract validation failure for a bad store contract shape', async () => {
    const space = makeSpace(
      [],
      { db: { hash: HASH_A, invariants: [] } },
      vi.fn().mockRejectedValue(
        new MigrationToolsError(
          'MIGRATION.CONTRACT_DESERIALIZATION_FAILED',
          'Contract failed to deserialize',
          {
            why: `Contract at "/project/migrations/snapshots/${'a'.repeat(64)}/contract.json" failed to deserialize: unsupported legacy shape`,
            fix: 'Re-emit.',
            meta: {
              filePath: `/project/migrations/snapshots/${'a'.repeat(64)}/contract.json`,
              message: 'unsupported legacy shape',
            },
          },
        ),
      ),
    );
    const result = await resolveFromForPlan(baseInput({ space }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(String(result.failure.why)).toContain('deserialize');
    }
  });

  it('surfaces INVALID_REF_FILE when the ref pointer file is malformed', async () => {
    const space = makeSpace(
      [],
      { db: { hash: HASH_A, invariants: [] } },
      vi.fn().mockRejectedValue(
        new MigrationToolsError('MIGRATION.INVALID_REF_FILE', 'Invalid ref file', {
          why: 'Failed to parse as JSON',
          fix: 'Fix the malformed ref pointer file.',
        }),
      ),
    );
    const result = await resolveFromForPlan(baseInput({ space }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('MIGRATION.INVALID_REF_FILE');
    }
  });

  it('treats explicit --from db identically to implicit default', async () => {
    const space = makeSpace(
      [],
      { db: { hash: HASH_ORPHAN, invariants: [] } },
      vi.fn().mockResolvedValue(contractAtResult(HASH_ORPHAN)),
    );
    const implicit = await resolveFromForPlan(baseInput({ space }));
    const explicit = await resolveFromForPlan(baseInput({ space, optionsFrom: 'db' }));

    expect(implicit.ok).toBe(true);
    expect(explicit.ok).toBe(true);
    if (implicit.ok && explicit.ok) {
      expect(implicit.value.kind).toBe(explicit.value.kind);
    }
  });
});

function baseToInput(
  overrides: Partial<ResolveToForPlanInput> & Pick<ResolveToForPlanInput, 'space'>,
): ResolveToForPlanInput {
  return { ...overrides };
}

describe('resolveToForPlan', () => {
  beforeEach(() => {
    migrationCounter = 0;
  });

  it('resolves a ref name to its materialized contract through the snapshot store', async () => {
    const bundles = [makePkg(E, HASH_A, 'm1'), makePkg(HASH_A, HASH_B, 'm2')];
    const space = makeSpace(
      bundles,
      { staging: { hash: HASH_A, invariants: [] } },
      vi.fn().mockResolvedValue(contractAtResult(HASH_A)),
    );
    const result = await resolveToForPlan('staging', baseToInput({ space }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.hash).toBe(HASH_A);
      expect(result.value.contractDts).toContain('Contract');
      expect(result.value.contractJson).toMatchObject({ storage: { storageHash: HASH_A } });
    }
  });

  it('resolves a full hash that is a graph node via the bundle destination contract artifacts', async () => {
    const bundles = [makePkg(E, HASH_A, 'm1')];
    const contractAt = vi
      .fn()
      .mockResolvedValue(contractAtResult(HASH_A, { provenance: 'graph-node' }));
    const space = makeSpace(bundles, {}, contractAt);
    const result = await resolveToForPlan(HASH_A, baseToInput({ space }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.hash).toBe(HASH_A);
      expect(result.value.contractJson).toMatchObject({ storage: { storageHash: HASH_A } });
    }
    expect(contractAt).toHaveBeenCalledWith(HASH_A, undefined);
  });

  it('resolves <dir>^ to the predecessor (from) contract via the bundle artifacts', async () => {
    const bundles = [makePkg(E, HASH_A, 'm1'), makePkg(HASH_A, HASH_B, 'm2')];
    const contractAt = vi
      .fn()
      .mockResolvedValue(contractAtResult(HASH_A, { provenance: 'graph-node' }));
    const space = makeSpace(bundles, {}, contractAt);
    const result = await resolveToForPlan('m2^', baseToInput({ space }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.hash).toBe(HASH_A);
    }
    expect(contractAt).toHaveBeenCalledWith(HASH_A, undefined);
  });

  it('maps a not-found reference to a structured error', async () => {
    const bundles = [makePkg(E, HASH_A, 'm1')];
    const space = makeSpace(bundles);
    const result = await resolveToForPlan('does-not-exist', baseToInput({ space }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.meta?.['input']).toBe('does-not-exist');
    }
  });
});

describe('assertFromIsGraphNode', () => {
  it('throws forgot-the-flag CliStructuredError for a non-graph-node hash', () => {
    const bundles = [makePkg(E, HASH_A, 'm1')];
    const graph = reconstructGraph(bundles);
    const refs = { tip: { hash: HASH_A, invariants: [] } };

    expect(() => assertFromIsGraphNode(HASH_ORPHAN, graph, refs, HASH_A)).toThrow(
      CliStructuredError,
    );

    try {
      assertFromIsGraphNode(HASH_ORPHAN, graph, refs, HASH_A);
    } catch (error) {
      if (CliStructuredError.is(error)) {
        expectRefuse(error, 'MIGRATION.HASH_NOT_IN_GRAPH', '--from tip');
      }
    }
  });
});
