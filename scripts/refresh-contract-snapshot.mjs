/**
 * `writeContractSnapshot` is write-if-absent: a store entry whose hash already
 * exists is never rewritten, so its `contract.d.ts` (which is not part of the
 * hash) drifts when the type printer changes. The regen scripts call this
 * wrapper instead: it drops an existing entry whose files no longer match the
 * fresh emit, then writes it again.
 */

import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  contractSnapshotDir,
  contractSnapshotFiles,
  writeContractSnapshot,
} from '@internal/migration-tools/contract-snapshot-store';

function readIfPresent(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
}

export async function refreshContractSnapshot(migrationsDir, storageHash, input) {
  const dir = contractSnapshotDir(migrationsDir, storageHash);
  if (existsSync(dir)) {
    const fresh = contractSnapshotFiles(input);
    const upToDate =
      readIfPresent(join(dir, 'contract.json')) === fresh.contractJson &&
      readIfPresent(join(dir, 'contract.d.ts')) === fresh.contractDts;
    if (upToDate) return { written: false, dir };
    rmSync(dir, { recursive: true, force: true });
  }
  return writeContractSnapshot(migrationsDir, storageHash, input);
}
