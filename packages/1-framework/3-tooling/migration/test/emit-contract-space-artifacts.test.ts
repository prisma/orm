import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { canonicalizeJson } from '@internal/framework-components/utils';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { contractSnapshotDir } from '../src/contract-snapshot-store';
import { emitContractSpaceArtifacts } from '../src/emit-contract-space-artifacts';
import { MigrationToolsError } from '../src/errors';
import { APP_SPACE_ID } from '../src/space-layout';

const HASH_V1 = '1'.repeat(64);
const HASH_V2 = '2'.repeat(64);
const HASH_APP = 'a'.repeat(64);

function makeContract(storageHash: string, extra: Record<string, unknown> = {}): unknown {
  return { storage: { storageHash }, ...extra };
}

describe('emitContractSpaceArtifacts', () => {
  let migrationsDir: string;

  beforeEach(async () => {
    migrationsDir = await mkdtemp(join(tmpdir(), 'space-artifacts-'));
  });

  afterEach(async () => {
    await rm(migrationsDir, { recursive: true, force: true });
  });

  it('writes the head contract into the snapshot store and refs/head.json under migrations/<spaceId>/, with no per-space contract files', async () => {
    await emitContractSpaceArtifacts(migrationsDir, 'cipherstash', {
      contract: makeContract(HASH_V1, { foo: 1 }),
      contractDts: 'export interface Contract {}\n',
      headRef: { hash: HASH_V1, invariants: [] },
    });

    const dir = join(migrationsDir, 'cipherstash');
    const entries = (await readdir(dir)).sort();
    expect(entries).toEqual(['refs']);

    const refsEntries = await readdir(join(dir, 'refs'));
    expect(refsEntries).toEqual(['head.json']);

    const snapshotEntries = (await readdir(contractSnapshotDir(migrationsDir, HASH_V1))).sort();
    expect(snapshotEntries).toEqual(['contract.d.ts', 'contract.json']);
  });

  describe('the paths it reports writing', () => {
    const emitAt = (hash: string) =>
      emitContractSpaceArtifacts(migrationsDir, 'cipherstash', {
        contract: makeContract(hash),
        contractDts: '\n',
        headRef: { hash, invariants: [] },
      });
    const headPath = () => join(migrationsDir, 'cipherstash', 'refs', 'head.json');

    it('are the snapshot and the head ref on a first write', async () => {
      expect(await emitAt(HASH_V1)).toEqual({
        writtenPaths: [contractSnapshotDir(migrationsDir, HASH_V1), headPath()],
      });
    });

    it('are none when both already hold the head', async () => {
      await emitAt(HASH_V1);

      expect(await emitAt(HASH_V1)).toEqual({ writtenPaths: [] });
    });

    it('are the head ref alone when it moves back to a head already in the store', async () => {
      await emitAt(HASH_V1);
      await emitAt(HASH_V2);

      expect(await emitAt(HASH_V1)).toEqual({ writtenPaths: [headPath()] });
    });
  });

  it('serialises the snapshot contract.json as the canonical-JSON form of the supplied contract', async () => {
    const contract = makeContract(HASH_V1, { z: 1, a: { y: 2, x: 3 } });
    await emitContractSpaceArtifacts(migrationsDir, 'cipherstash', {
      contract,
      contractDts: '\n',
      headRef: { hash: HASH_V1, invariants: [] },
    });

    const raw = await readFile(
      join(contractSnapshotDir(migrationsDir, HASH_V1), 'contract.json'),
      'utf-8',
    );
    expect(raw).toBe(`${canonicalizeJson(contract)}\n`);
  });

  it('writes the snapshot contract.d.ts verbatim from the caller-supplied string', async () => {
    const dts = `// rendered by the caller\nexport type Contract = { kind: 'cipherstash' };\n`;
    await emitContractSpaceArtifacts(migrationsDir, 'cipherstash', {
      contract: makeContract(HASH_V1),
      contractDts: dts,
      headRef: { hash: HASH_V1, invariants: [] },
    });

    const raw = await readFile(
      join(contractSnapshotDir(migrationsDir, HASH_V1), 'contract.d.ts'),
      'utf-8',
    );
    expect(raw).toBe(dts);
  });

  it('serialises refs/head.json with sorted invariants and trailing newline', async () => {
    await emitContractSpaceArtifacts(migrationsDir, 'cipherstash', {
      contract: makeContract(HASH_V1),
      contractDts: '\n',
      headRef: {
        hash: HASH_V1,
        invariants: ['z-inv', 'a-inv', 'm-inv'],
      },
    });

    const raw = await readFile(join(migrationsDir, 'cipherstash', 'refs', 'head.json'), 'utf-8');
    expect(raw.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(raw);
    expect(parsed).toEqual({
      hash: HASH_V1,
      invariants: ['a-inv', 'm-inv', 'z-inv'],
    });
  });

  it('advances refs/head.json to the new hash while the prior snapshot entry is left intact (write-if-absent)', async () => {
    const dir = join(migrationsDir, 'cipherstash');
    await emitContractSpaceArtifacts(migrationsDir, 'cipherstash', {
      contract: makeContract(HASH_V1, { v: 1 }),
      contractDts: 'v1\n',
      headRef: { hash: HASH_V1, invariants: ['inv-v1'] },
    });

    await emitContractSpaceArtifacts(migrationsDir, 'cipherstash', {
      contract: makeContract(HASH_V2, { v: 2 }),
      contractDts: 'v2\n',
      headRef: { hash: HASH_V2, invariants: ['inv-v2'] },
    });

    expect(
      await readFile(join(contractSnapshotDir(migrationsDir, HASH_V1), 'contract.json'), 'utf-8'),
    ).toBe(`${canonicalizeJson(makeContract(HASH_V1, { v: 1 }))}\n`);
    expect(
      await readFile(join(contractSnapshotDir(migrationsDir, HASH_V2), 'contract.json'), 'utf-8'),
    ).toBe(`${canonicalizeJson(makeContract(HASH_V2, { v: 2 }))}\n`);

    const headRaw = await readFile(join(dir, 'refs', 'head.json'), 'utf-8');
    expect(JSON.parse(headRaw)).toEqual({
      hash: HASH_V2,
      invariants: ['inv-v2'],
    });
  });

  it('re-emitting the same hash leaves refs/head.json reflecting the latest invariants (write-if-absent is a no-op on identical content)', async () => {
    const dir = join(migrationsDir, 'cipherstash');
    await emitContractSpaceArtifacts(migrationsDir, 'cipherstash', {
      contract: makeContract(HASH_V1),
      contractDts: '\n',
      headRef: { hash: HASH_V1, invariants: ['old'] },
    });

    await emitContractSpaceArtifacts(migrationsDir, 'cipherstash', {
      contract: makeContract(HASH_V1),
      contractDts: '\n',
      headRef: { hash: HASH_V1, invariants: [] },
    });

    const headRaw = await readFile(join(dir, 'refs', 'head.json'), 'utf-8');
    expect(JSON.parse(headRaw)).toEqual({ hash: HASH_V1, invariants: [] });
  });

  it('leaves a formatted refs/head.json that already holds the same head untouched', async () => {
    const headPath = join(migrationsDir, 'pgvector', 'refs', 'head.json');
    const formatted = `{\n  "hash": "${HASH_V1}",\n  "invariants": ["b", "a"]\n}\n`;
    await mkdir(join(migrationsDir, 'pgvector', 'refs'), { recursive: true });
    await writeFile(headPath, formatted);

    await emitContractSpaceArtifacts(migrationsDir, 'pgvector', {
      contract: makeContract(HASH_V1),
      contractDts: '\n',
      headRef: { hash: HASH_V1, invariants: ['a', 'b'] },
    });

    expect(await readFile(headPath, 'utf-8')).toBe(formatted);
  });

  it.each([
    ['unparseable', 'not json'],
    ['without an invariants list', `{"hash":"${HASH_V1}"}`],
  ])('rewrites a refs/head.json that is %s', async (_label, content) => {
    const headPath = join(migrationsDir, 'pgvector', 'refs', 'head.json');
    await mkdir(join(migrationsDir, 'pgvector', 'refs'), { recursive: true });
    await writeFile(headPath, content);

    await emitContractSpaceArtifacts(migrationsDir, 'pgvector', {
      contract: makeContract(HASH_V1),
      contractDts: '\n',
      headRef: { hash: HASH_V1, invariants: [] },
    });

    expect(JSON.parse(await readFile(headPath, 'utf-8'))).toEqual({
      hash: HASH_V1,
      invariants: [],
    });
  });

  it('produces byte-identical snapshot output across two writes of the same artifact (idempotency)', async () => {
    const dirA = join(migrationsDir, 'a');
    const dirB = join(migrationsDir, 'b');
    const args = {
      contract: makeContract(HASH_V1, { z: 1, a: { y: 2 } }),
      contractDts: 'export type X = number;\n',
      headRef: { hash: HASH_V1, invariants: ['b', 'a'] },
    };

    await emitContractSpaceArtifacts(dirA, 'cipherstash', args);
    await emitContractSpaceArtifacts(dirB, 'cipherstash', args);

    const aContract = await readFile(
      join(contractSnapshotDir(dirA, HASH_V1), 'contract.json'),
      'utf-8',
    );
    const bContract = await readFile(
      join(contractSnapshotDir(dirB, HASH_V1), 'contract.json'),
      'utf-8',
    );
    expect(aContract).toBe(bContract);

    const aDts = await readFile(join(contractSnapshotDir(dirA, HASH_V1), 'contract.d.ts'), 'utf-8');
    const bDts = await readFile(join(contractSnapshotDir(dirB, HASH_V1), 'contract.d.ts'), 'utf-8');
    expect(aDts).toBe(bDts);

    const aHead = await readFile(join(dirA, 'cipherstash', 'refs', 'head.json'), 'utf-8');
    const bHead = await readFile(join(dirB, 'cipherstash', 'refs', 'head.json'), 'utf-8');
    expect(aHead).toBe(bHead);
  });

  it('does not mutate the supplied invariants array', async () => {
    const invariants = ['z', 'a', 'm'];
    const snapshot = [...invariants];

    await emitContractSpaceArtifacts(migrationsDir, 'cipherstash', {
      contract: makeContract(HASH_V1),
      contractDts: '\n',
      headRef: { hash: HASH_V1, invariants },
    });

    expect(invariants).toEqual(snapshot);
  });

  it('accepts the app space and writes under migrations/<APP_SPACE_ID>/', async () => {
    // The layout is uniform — every space, including the app, gets the same
    // on-disk shape under `migrations/<spaceId>/`.
    await emitContractSpaceArtifacts(migrationsDir, APP_SPACE_ID, {
      contract: makeContract(HASH_APP, { kind: 'app' }),
      contractDts: 'export type AppContract = unknown;\n',
      headRef: { hash: HASH_APP, invariants: [] },
    });

    const dir = join(migrationsDir, APP_SPACE_ID);
    const entries = (await readdir(dir)).sort();
    expect(entries).toEqual(['refs']);

    const head = JSON.parse(await readFile(join(dir, 'refs', 'head.json'), 'utf-8'));
    expect(head).toEqual({ hash: HASH_APP, invariants: [] });
  });

  it('rejects an invalid space id', async () => {
    let captured: unknown;
    try {
      await emitContractSpaceArtifacts(migrationsDir, 'INVALID', {
        contract: makeContract(HASH_V1),
        contractDts: '\n',
        headRef: { hash: HASH_V1, invariants: [] },
      });
    } catch (err) {
      captured = err;
    }

    expect(MigrationToolsError.is(captured)).toBe(true);
    expect((captured as MigrationToolsError).code).toBe('MIGRATION.INVALID_SPACE_ID');
  });

  it('creates the migrations dir + space dir + refs dir if they do not yet exist', async () => {
    const fresh = join(migrationsDir, 'fresh-project', 'migrations');

    await emitContractSpaceArtifacts(fresh, 'cipherstash', {
      contract: makeContract(HASH_V1),
      contractDts: '\n',
      headRef: { hash: HASH_V1, invariants: [] },
    });

    const entries = (await readdir(join(fresh, 'cipherstash'))).sort();
    expect(entries).toEqual(['refs']);

    const snapshotEntries = (await readdir(contractSnapshotDir(fresh, HASH_V1))).sort();
    expect(snapshotEntries).toEqual(['contract.d.ts', 'contract.json']);
  });

  it('preserves user-authored migration directories alongside the refs dir', async () => {
    const dir = join(migrationsDir, 'cipherstash');
    const userMigration = join(dir, '20260101T0000_baseline');
    await writeFile(`${dir}-marker`, 'noop');
    await mkdir(userMigration, { recursive: true });
    await writeFile(join(userMigration, 'migration.json'), '{}');

    await emitContractSpaceArtifacts(migrationsDir, 'cipherstash', {
      contract: makeContract(HASH_V1),
      contractDts: '\n',
      headRef: { hash: HASH_V1, invariants: [] },
    });

    const entries = (await readdir(dir)).sort();
    expect(entries).toContain('20260101T0000_baseline');
    expect(entries).toContain('refs');
  });
});
