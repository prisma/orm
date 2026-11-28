import { readdirSync } from 'node:fs';
import {
  createSnapshotContentVerifier,
  readContractSnapshotJson,
} from '@internal/migration-tools/contract-snapshot-store';
import { normalizeMongoStorage } from '@internal/mongo-contract/normal-form';
import { blindCast } from '@internal/utils/casts';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { MongoContractSerializer } from '../src/core/ir/mongo-contract-serializer';

const EXAMPLES = join(import.meta.dirname, '../../../../examples');
const SAVED_MIGRATION_DIRS = [
  join(EXAMPLES, 'retail-store/migrations'),
  join(EXAMPLES, 'mongo-demo/migrations'),
];

function savedSnapshots(): readonly { readonly migrationsDir: string; readonly hash: string }[] {
  return SAVED_MIGRATION_DIRS.flatMap((migrationsDir) =>
    readdirSync(join(migrationsDir, 'snapshots')).map((hash) => ({ migrationsDir, hash })),
  );
}

describe('MongoContractSerializer normal form of storage', () => {
  const serializer = new MongoContractSerializer();
  const verifier = createSnapshotContentVerifier(serializer.normalizeStorage);

  it("is the MongoDB family's", () => {
    expect(serializer.normalizeStorage).toBe(normalizeMongoStorage);
  });

  it('reads every saved MongoDB snapshot with its content verified', async () => {
    const snapshots = savedSnapshots();
    expect(snapshots.length).toBeGreaterThanOrEqual(8);
    for (const { migrationsDir, hash } of snapshots) {
      await expect(readContractSnapshotJson(migrationsDir, hash, verifier)).resolves.toMatchObject({
        storage: { storageHash: hash },
      });
    }
  });

  it('refuses a saved MongoDB snapshot whose storage was changed', async () => {
    const [first] = savedSnapshots();
    if (first === undefined) throw new Error('no saved MongoDB snapshot');
    const snapshot = blindCast<
      { storage: { namespaces: Record<string, unknown> } },
      'a saved contract snapshot'
    >(await readContractSnapshotJson(first.migrationsDir, first.hash));
    const tampered = {
      ...snapshot,
      storage: { ...snapshot.storage, namespaces: { ...snapshot.storage.namespaces, extra: {} } },
    };
    expect(() =>
      verifier.assertSnapshotContentMatches(tampered, first.hash, 'contract.json'),
    ).toThrow(expect.objectContaining({ code: 'MIGRATION.CONTRACT_SNAPSHOT_CONTENT_MISMATCH' }));
  });
});
