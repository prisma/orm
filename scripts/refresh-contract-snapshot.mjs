/**
 * `writeContractSnapshot` is write-if-absent: a store entry whose hash already
 * exists is never rewritten, so its `contract.d.ts` (which is not part of the
 * hash) drifts when the type printer changes. The regen scripts call this
 * wrapper instead: it drops an existing entry whose files no longer match the
 * fresh emit, then writes it again.
 */

import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalizeJson } from '@internal/framework-components/utils';
import {
  contractSnapshotDir,
  writeContractSnapshot,
} from '@internal/migration-tools/contract-snapshot-store';

function readIfPresent(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
}

export async function refreshContractSnapshot(migrationsDir, storageHash, input) {
  const dir = contractSnapshotDir(migrationsDir, storageHash);
  if (existsSync(dir)) {
    const freshJson = `${canonicalizeJson(input.contractJson)}\n`;
    const freshDts = input.contractDts.endsWith('\n')
      ? input.contractDts
      : `${input.contractDts}\n`;
    const upToDate =
      readIfPresent(join(dir, 'contract.json')) === freshJson &&
      readIfPresent(join(dir, 'contract.d.ts')) === freshDts;
    if (upToDate) return { written: false, dir };
    rmSync(dir, { recursive: true, force: true });
  }
  return writeContractSnapshot(migrationsDir, storageHash, input);
}
