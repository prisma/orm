import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { contractSnapshotDir } from '@internal/migration-tools/contract-snapshot-store';
import type { MigrationMetadata } from '@internal/migration-tools/metadata';
import {
  emitContractSpaceArtifacts,
  readContractSpaceHeadRef,
  spaceMigrationDirectory,
} from '@internal/migration-tools/spaces';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type DescriptorMigrationPackage,
  runContractSpaceSeedPhase,
} from '../../src/control-api/operations/contract-space-seed-phase';

const HASH_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const HASH_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function makeContract(storageHash: string, extra: Record<string, unknown> = {}): unknown {
  return { storage: { storageHash }, ...extra };
}

function makeMetadata(args: {
  readonly from: string | null;
  readonly to: string;
}): MigrationMetadata {
  return {
    from: args.from,
    to: args.to,
    migrationHash: `mh:${args.to}`,
    providedInvariants: [],
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function makePkg(
  dirName: string,
  fromTo: { from: string | null; to: string },
): DescriptorMigrationPackage {
  return {
    dirName,
    metadata: makeMetadata(fromTo),
    ops: [],
  };
}

describe('runContractSpaceSeedPhase', () => {
  let migrationsDir: string;

  beforeEach(async () => {
    migrationsDir = await mkdtemp(join(tmpdir(), 'cli-cs-seed-'));
  });

  afterEach(async () => {
    await rm(migrationsDir, { recursive: true, force: true });
  });

  it('emits on-disk artifacts on first emit and reports action=updated', async () => {
    const out = await runContractSpaceSeedPhase({
      migrationsDir,
      extensions: [
        {
          id: 'cipherstash',
          contractSpace: {
            contractJson: makeContract(HASH_A, { v: 1 }),
            headRef: { hash: HASH_A, invariants: [] },
            migrations: [],
          },
        },
      ],
    });

    expect(out.seeded).toHaveLength(1);
    const record = out.seeded[0]!;
    expect(record.spaceId).toBe('cipherstash');
    expect(record.action).toBe('updated');
    expect(record.priorHash).toBeNull();
    expect(record.newHash).toBe(HASH_A);
    expect(record.newMigrationDirs).toEqual([]);

    const head = await readContractSpaceHeadRef(migrationsDir, 'cipherstash');
    expect(head?.hash).toBe(HASH_A);
  });

  it('reports action=unchanged on idempotent re-pin', async () => {
    await emitContractSpaceArtifacts(migrationsDir, 'cipherstash', {
      contract: makeContract(HASH_A, { v: 1 }),
      contractDts: '\n',
      headRef: { hash: HASH_A, invariants: [] },
    });

    const out = await runContractSpaceSeedPhase({
      migrationsDir,
      extensions: [
        {
          id: 'cipherstash',
          contractSpace: {
            contractJson: makeContract(HASH_A, { v: 1 }),
            headRef: { hash: HASH_A, invariants: [] },
            migrations: [],
          },
        },
      ],
    });

    expect(out.seeded).toHaveLength(1);
    const record = out.seeded[0]!;
    expect(record.action).toBe('unchanged');
    expect(record.priorHash).toBe(HASH_A);
    expect(record.newHash).toBe(HASH_A);
    expect(record.newMigrationDirs).toEqual([]);
  });

  it('leaves the store snapshot untouched (write-if-absent) when descriptor hash matches on-disk head', async () => {
    // Pre-write the store entry at HASH_A. The seed phase re-emits
    // `refs/head.json` unconditionally, but the store's write-if-absent
    // semantics mean an already-populated hash directory is left as-is.
    await emitContractSpaceArtifacts(migrationsDir, 'cipherstash', {
      contract: makeContract(HASH_A, { v: 1 }),
      contractDts: '// first write\n',
      headRef: { hash: HASH_A, invariants: [] },
    });

    await runContractSpaceSeedPhase({
      migrationsDir,
      extensions: [
        {
          id: 'cipherstash',
          contractSpace: {
            contractJson: makeContract(HASH_A, { v: 1 }),
            headRef: { hash: HASH_A, invariants: [] },
            migrations: [],
          },
        },
      ],
    });

    const dts = await readFile(
      join(contractSnapshotDir(migrationsDir, HASH_A), 'contract.d.ts'),
      'utf-8',
    );
    expect(dts).toBe('// first write\n');
  });

  it('reports action=updated when descriptor hash differs from on-disk head', async () => {
    await emitContractSpaceArtifacts(migrationsDir, 'cipherstash', {
      contract: makeContract(HASH_A, { v: 1 }),
      contractDts: '\n',
      headRef: { hash: HASH_A, invariants: [] },
    });

    const out = await runContractSpaceSeedPhase({
      migrationsDir,
      extensions: [
        {
          id: 'cipherstash',
          contractSpace: {
            contractJson: makeContract(HASH_B, { v: 2 }),
            headRef: { hash: HASH_B, invariants: [] },
            migrations: [],
          },
        },
      ],
    });

    expect(out.seeded).toHaveLength(1);
    const record = out.seeded[0]!;
    expect(record.action).toBe('updated');
    expect(record.priorHash).toBe(HASH_A);
    expect(record.newHash).toBe(HASH_B);

    const head = await readContractSpaceHeadRef(migrationsDir, 'cipherstash');
    expect(head?.hash).toBe(HASH_B);
  });

  it('materialises every descriptor-shipped migration package not yet on disk', async () => {
    const out = await runContractSpaceSeedPhase({
      migrationsDir,
      extensions: [
        {
          id: 'cipherstash',
          contractSpace: {
            contractJson: makeContract(HASH_A, { v: 1 }),
            headRef: { hash: HASH_A, invariants: [] },
            migrations: [makePkg('20260101T0000_init', { from: null, to: HASH_A })],
          },
        },
      ],
    });

    const record = out.seeded[0]!;
    expect(record.newMigrationDirs).toEqual(['20260101T0000_init']);

    const manifest = JSON.parse(
      await readFile(
        join(
          spaceMigrationDirectory(migrationsDir, 'cipherstash'),
          '20260101T0000_init',
          'migration.json',
        ),
        'utf-8',
      ),
    );
    expect(manifest.to).toBe(HASH_A);
  });

  it('skips packages already on disk and only emits the missing ones', async () => {
    // Pre-existing first migration.
    const existingDir = join(migrationsDir, 'cipherstash', '20260101T0000_init');
    await mkdir(existingDir, { recursive: true });
    await writeFile(join(existingDir, 'migration.json'), '{}');

    const out = await runContractSpaceSeedPhase({
      migrationsDir,
      extensions: [
        {
          id: 'cipherstash',
          contractSpace: {
            contractJson: makeContract(HASH_B, { v: 1 }),
            headRef: { hash: HASH_B, invariants: [] },
            migrations: [
              makePkg('20260101T0000_init', { from: null, to: HASH_A }),
              makePkg('20260201T0000_bump', { from: HASH_A, to: HASH_B }),
            ],
          },
        },
      ],
    });

    const record = out.seeded[0]!;
    expect(record.newMigrationDirs).toEqual(['20260201T0000_bump']);
    // Pre-existing manifest is left untouched.
    const manifest = await readFile(join(existingDir, 'migration.json'), 'utf-8');
    expect(manifest).toBe('{}');
  });

  it('reports action=updated when artifacts unchanged but new migration packages were materialised', async () => {
    // Pre-emit artifacts at HASH_A so on-disk head matches descriptor.
    await emitContractSpaceArtifacts(migrationsDir, 'cipherstash', {
      contract: makeContract(HASH_A, { v: 1 }),
      contractDts: '\n',
      headRef: { hash: HASH_A, invariants: [] },
    });
    // Descriptor ships a migration package not yet on disk.
    const out = await runContractSpaceSeedPhase({
      migrationsDir,
      extensions: [
        {
          id: 'cipherstash',
          contractSpace: {
            contractJson: makeContract(HASH_A, { v: 1 }),
            headRef: { hash: HASH_A, invariants: [] },
            migrations: [makePkg('20260101T0000_init', { from: null, to: HASH_A })],
          },
        },
      ],
    });

    const record = out.seeded[0]!;
    expect(record.action).toBe('updated');
    expect(record.priorHash).toBe(HASH_A);
    expect(record.newHash).toBe(HASH_A);
    expect(record.newMigrationDirs).toEqual(['20260101T0000_init']);
  });

  describe('the paths it writes', () => {
    function seedAt(hash: string, migrations: readonly DescriptorMigrationPackage[] = []) {
      return runContractSpaceSeedPhase({
        migrationsDir,
        extensions: [
          {
            id: 'cipherstash',
            contractSpace: {
              contractJson: makeContract(hash, { v: hash }),
              headRef: { hash, invariants: [] },
              migrations,
            },
          },
        ],
      });
    }
    const headPath = () => join(migrationsDir, 'cipherstash', 'refs', 'head.json');

    it('lists the snapshot, the head ref and each new migration on a first seed', async () => {
      const out = await seedAt(HASH_A, [makePkg('20260101T0000_init', { from: null, to: HASH_A })]);

      expect(out.seeded[0]?.writtenPaths).toEqual([
        contractSnapshotDir(migrationsDir, HASH_A),
        headPath(),
        join(migrationsDir, 'cipherstash', '20260101T0000_init'),
      ]);
    });

    it('lists nothing when every file already holds the pack', async () => {
      await seedAt(HASH_A, [makePkg('20260101T0000_init', { from: null, to: HASH_A })]);

      const out = await seedAt(HASH_A, [makePkg('20260101T0000_init', { from: null, to: HASH_A })]);

      expect(out.seeded[0]?.writtenPaths).toEqual([]);
    });

    it('lists the head ref when it moves the head back to an older installed pack', async () => {
      await seedAt(HASH_A);
      await seedAt(HASH_B);

      const out = await seedAt(HASH_A);

      expect(out.seeded[0]).toMatchObject({
        priorHash: HASH_B,
        newHash: HASH_A,
        writtenPaths: [headPath()],
      });
    });
  });

  it('writes nothing once cancelled', async () => {
    await expect(
      runContractSpaceSeedPhase({
        migrationsDir,
        signal: AbortSignal.abort(),
        extensions: [
          {
            id: 'cipherstash',
            contractSpace: {
              contractJson: makeContract(HASH_A),
              headRef: { hash: HASH_A, invariants: [] },
              migrations: [],
            },
          },
        ],
      }),
    ).rejects.toSatisfy((error: unknown) => error instanceof Error && error.name === 'AbortError');
    expect(await readdir(migrationsDir)).toEqual([]);
  });

  it('skips extensions without a contractSpace (codec-only packs)', async () => {
    const out = await runContractSpaceSeedPhase({
      migrationsDir,
      extensions: [{ id: 'codec-only' }],
    });
    expect(out.seeded).toEqual([]);
  });

  it('orders per-space output deterministically (alphabetical by spaceId)', async () => {
    const out = await runContractSpaceSeedPhase({
      migrationsDir,
      extensions: [
        {
          id: 'zeta',
          contractSpace: {
            contractJson: makeContract(HASH_A, { v: 1 }),
            headRef: { hash: HASH_A, invariants: [] },
            migrations: [],
          },
        },
        {
          id: 'alpha',
          contractSpace: {
            contractJson: makeContract(HASH_B, { v: 1 }),
            headRef: { hash: HASH_B, invariants: [] },
            migrations: [],
          },
        },
      ],
    });

    expect(out.seeded.map((r) => r.spaceId)).toEqual(['alpha', 'zeta']);
  });
});
