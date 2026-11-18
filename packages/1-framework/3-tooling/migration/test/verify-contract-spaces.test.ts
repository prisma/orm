import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type ContractSpaceHeadRecord,
  listContractSpaceDirectories,
  type SpaceMarkerRecord,
  verifyContractSpaces,
} from '../src/verify-contract-spaces';

describe('listContractSpaceDirectories', () => {
  let projectMigrationsDir: string;

  async function makeMigrationDir(name: string): Promise<void> {
    await mkdir(join(projectMigrationsDir, name), { recursive: true });
    await writeFile(join(projectMigrationsDir, name, 'migration.json'), '{}');
  }

  async function makeContractSpaceDir(name: string): Promise<void> {
    await mkdir(join(projectMigrationsDir, name), { recursive: true });
  }

  beforeEach(async () => {
    projectMigrationsDir = await mkdtemp(join(tmpdir(), 'list-contract-space-'));
  });

  afterEach(async () => {
    await rm(projectMigrationsDir, { recursive: true, force: true });
  });

  it('returns an empty list when the migrations directory does not exist', async () => {
    const missing = join(projectMigrationsDir, 'does-not-exist');
    expect(await listContractSpaceDirectories(missing)).toEqual([]);
  });

  it('excludes timestamp-shaped migration directories that contain migration.json', async () => {
    await makeMigrationDir('20260101T0000_baseline');
    await makeMigrationDir('20260507T1100_add_users');

    expect(await listContractSpaceDirectories(projectMigrationsDir)).toEqual([]);
  });

  it('excludes a space-id-shaped directory when it contains migration.json', async () => {
    // The directory name happens to look like a space id, but the
    // presence of `migration.json` is the structural marker — users may
    // freely name their migration directories.
    await makeMigrationDir('cipherstash');

    expect(await listContractSpaceDirectories(projectMigrationsDir)).toEqual([]);
  });

  it('includes a timestamp-shaped directory with no migration.json (verifier no longer trusts the name)', async () => {
    await makeContractSpaceDir('20260101T0000_baseline');
    await makeContractSpaceDir('cipherstash');

    expect(await listContractSpaceDirectories(projectMigrationsDir)).toEqual([
      '20260101T0000_baseline',
      'cipherstash',
    ]);
  });

  it('returns extension-space subdirectories sorted alphabetically', async () => {
    await makeContractSpaceDir('pgvector');
    await makeContractSpaceDir('cipherstash');
    await makeContractSpaceDir('audit');

    expect(await listContractSpaceDirectories(projectMigrationsDir)).toEqual([
      'audit',
      'cipherstash',
      'pgvector',
    ]);
  });

  it('returns contract-space dirs alongside skipping migration dirs', async () => {
    await makeMigrationDir('20260101T0000_baseline');
    await makeContractSpaceDir('cipherstash');
    await makeMigrationDir('20260507T1100_add_users');
    await makeContractSpaceDir('pgvector');

    expect(await listContractSpaceDirectories(projectMigrationsDir)).toEqual([
      'cipherstash',
      'pgvector',
    ]);
  });

  it('skips files (only directory entries are reported)', async () => {
    await writeFile(join(projectMigrationsDir, 'cipherstash'), 'i am a file');
    await makeContractSpaceDir('pgvector');

    expect(await listContractSpaceDirectories(projectMigrationsDir)).toEqual(['pgvector']);
  });

  it('skips dot-prefixed directories', async () => {
    await mkdir(join(projectMigrationsDir, '.git'));
    await mkdir(join(projectMigrationsDir, '.tmp'));
    await makeContractSpaceDir('cipherstash');

    expect(await listContractSpaceDirectories(projectMigrationsDir)).toEqual(['cipherstash']);
  });

  it('skips the reserved snapshots/ contract snapshot store directory', async () => {
    await makeContractSpaceDir('snapshots');
    await makeContractSpaceDir('cipherstash');

    expect(await listContractSpaceDirectories(projectMigrationsDir)).toEqual(['cipherstash']);
  });
});

describe('verifyContractSpaces', () => {
  const cipherstashHead: ContractSpaceHeadRecord = {
    hash: '0000000000000000000000000000000000000000000000000000000000000001',
    invariants: ['cipherstash:install-v1'],
  };
  const pgvectorHead: ContractSpaceHeadRecord = {
    hash: '0000000000000000000000000000000000000000000000000000000000000002',
    invariants: ['pgvector:install-v1'],
  };

  const markerOf = (head: ContractSpaceHeadRecord): SpaceMarkerRecord => ({
    hash: head.hash,
    invariants: [...head.invariants],
  });

  it("returns ok for today's single-app project (no extensions, no extra dirs, no extra markers)", () => {
    const result = verifyContractSpaces({
      markerLocation: 'prisma_contract.marker',
      loadedSpaces: new Set(['app']),
      spaceDirsOnDisk: [],
      headRefsBySpace: new Map(),
      markerRowsBySpace: new Map(),
    });
    expect(result.ok).toBe(true);
  });

  it('returns ok when loadedSpaces match contract-space dirs and marker rows exactly', () => {
    const result = verifyContractSpaces({
      markerLocation: 'prisma_contract.marker',
      loadedSpaces: new Set(['app', 'cipherstash']),
      spaceDirsOnDisk: ['cipherstash'],
      headRefsBySpace: new Map([['cipherstash', cipherstashHead]]),
      markerRowsBySpace: new Map([['cipherstash', markerOf(cipherstashHead)]]),
    });
    expect(result.ok).toBe(true);
  });

  it('rejects when extensions declares a space without a contract-space dir on disk (declaredButUnmigrated)', () => {
    const result = verifyContractSpaces({
      markerLocation: 'prisma_contract.marker',
      loadedSpaces: new Set(['app', 'cipherstash']),
      spaceDirsOnDisk: [],
      headRefsBySpace: new Map(),
      markerRowsBySpace: new Map(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({
      kind: 'declaredButUnmigrated',
      spaceId: 'cipherstash',
    });
  });

  it('rejects when a contract-space dir on disk is not in extensions (orphanSpaceDir)', () => {
    const result = verifyContractSpaces({
      markerLocation: 'prisma_contract.marker',
      loadedSpaces: new Set(['app']),
      spaceDirsOnDisk: ['cipherstash'],
      headRefsBySpace: new Map([['cipherstash', cipherstashHead]]),
      markerRowsBySpace: new Map(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({
      kind: 'orphanSpaceDir',
      spaceId: 'cipherstash',
    });
  });

  it('rejects when a marker row exists for a space not in extensions (orphanMarker)', () => {
    const result = verifyContractSpaces({
      markerLocation: 'prisma_contract.marker',
      loadedSpaces: new Set(['app']),
      spaceDirsOnDisk: [],
      headRefsBySpace: new Map(),
      markerRowsBySpace: new Map([['cipherstash', markerOf(cipherstashHead)]]),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({
      kind: 'orphanMarker',
      spaceId: 'cipherstash',
    });
  });

  it('names the marker location the target gives in the orphan marker remediation', () => {
    const result = verifyContractSpaces({
      markerLocation: '_prisma_marker',
      loadedSpaces: new Set(['app']),
      spaceDirsOnDisk: [],
      headRefsBySpace: new Map(),
      markerRowsBySpace: new Map([['cipherstash', markerOf(cipherstashHead)]]),
    });
    expect(result).toEqual({
      ok: false,
      violations: [
        {
          kind: 'orphanMarker',
          spaceId: 'cipherstash',
          remediation:
            "Orphan marker row for space 'cipherstash' (no longer in extensions); remediation: manually delete the row from `_prisma_marker`.",
        },
      ],
    });
  });

  it('rejects when marker hash does not match on-disk head hash for a loaded space (hashMismatch)', () => {
    const driftedMarker: SpaceMarkerRecord = {
      hash: '00000000000000000000000000000000000000000000000000000000000000ff',
      invariants: cipherstashHead.invariants,
    };
    const result = verifyContractSpaces({
      markerLocation: 'prisma_contract.marker',
      loadedSpaces: new Set(['app', 'cipherstash']),
      spaceDirsOnDisk: ['cipherstash'],
      headRefsBySpace: new Map([['cipherstash', cipherstashHead]]),
      markerRowsBySpace: new Map([['cipherstash', driftedMarker]]),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations).toContainEqual(
      expect.objectContaining({
        kind: 'hashMismatch',
        spaceId: 'cipherstash',
        priorHeadHash: cipherstashHead.hash,
        markerHash: driftedMarker.hash,
      }),
    );
  });

  it("rejects when marker invariants don't cover on-disk invariants (invariantsMismatch)", () => {
    const partialMarker: SpaceMarkerRecord = {
      hash: cipherstashHead.hash,
      invariants: [],
    };
    const result = verifyContractSpaces({
      markerLocation: 'prisma_contract.marker',
      loadedSpaces: new Set(['app', 'cipherstash']),
      spaceDirsOnDisk: ['cipherstash'],
      headRefsBySpace: new Map([['cipherstash', cipherstashHead]]),
      markerRowsBySpace: new Map([['cipherstash', partialMarker]]),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations).toContainEqual(
      expect.objectContaining({
        kind: 'invariantsMismatch',
        spaceId: 'cipherstash',
      }),
    );
  });

  it('aggregates multiple violations across spaces deterministically (alphabetical by spaceId)', () => {
    const result = verifyContractSpaces({
      markerLocation: 'prisma_contract.marker',
      loadedSpaces: new Set(['app', 'cipherstash']),
      spaceDirsOnDisk: ['orphan-z', 'orphan-a'],
      headRefsBySpace: new Map([
        ['orphan-a', cipherstashHead],
        ['orphan-z', pgvectorHead],
      ]),
      markerRowsBySpace: new Map([
        ['orphan-marker-1', markerOf(cipherstashHead)],
        ['orphan-marker-2', markerOf(pgvectorHead)],
      ]),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const kindsAndIds = result.violations.map((v) => `${v.kind}:${v.spaceId}`);
    expect(kindsAndIds).toEqual([
      'declaredButUnmigrated:cipherstash',
      'orphanMarker:orphan-marker-1',
      'orphanMarker:orphan-marker-2',
      'orphanSpaceDir:orphan-a',
      'orphanSpaceDir:orphan-z',
    ]);
  });

  it('every violation includes a remediation hint', () => {
    const driftedMarker: SpaceMarkerRecord = {
      hash: '00000000000000000000000000000000000000000000000000000000000000ff',
      invariants: [],
    };
    const result = verifyContractSpaces({
      markerLocation: 'prisma_contract.marker',
      loadedSpaces: new Set(['app', 'pgvector']),
      spaceDirsOnDisk: ['orphan'],
      headRefsBySpace: new Map([['orphan', cipherstashHead]]),
      markerRowsBySpace: new Map([
        ['ghost', markerOf(cipherstashHead)],
        ['pgvector', driftedMarker],
      ]),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    for (const v of result.violations) {
      expect(typeof v.remediation).toBe('string');
      expect(v.remediation.length).toBeGreaterThan(0);
    }
  });

  it("treats 'app' marker rows as expected (app is always loaded)", () => {
    const appMarker: SpaceMarkerRecord = {
      hash: 'dead',
      invariants: [],
    };
    const result = verifyContractSpaces({
      markerLocation: 'prisma_contract.marker',
      loadedSpaces: new Set(['app']),
      spaceDirsOnDisk: [],
      headRefsBySpace: new Map(),
      markerRowsBySpace: new Map([['app', appMarker]]),
    });
    expect(result.ok).toBe(true);
  });
});
