import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { CONTRACT_SNAPSHOTS_DIRNAME, storageHashHex } from '@internal/framework-components/control';
import { canonicalizeJson } from '@internal/framework-components/utils';
import { blindCast } from '@internal/utils/casts';
import { join, relative } from 'pathe';
import {
  errorContractSnapshotContentMismatch,
  errorContractSnapshotHashMismatch,
  errorContractSnapshotMissing,
  errorInvalidJson,
  MigrationToolsError,
} from './errors';
import type { SnapshotCanonicalizationHooks } from './hash';
import { recomputePublishedStorageHash } from './hash';

export type { SnapshotCanonicalizationHooks } from './hash';

const CONTRACT_JSON_FILE = 'contract.json';
const CONTRACT_DTS_FILE = 'contract.d.ts';

function hasErrnoCode(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    blindCast<
      { code?: string },
      'Node fs errors carry an errno string `code` absent from the Error type'
    >(error).code === code
  );
}

async function directoryExists(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch (error) {
    if (hasErrnoCode(error, 'ENOENT')) return false;
    throw error;
  }
}

export function contractSnapshotDir(migrationsDir: string, storageHash: string): string {
  return join(migrationsDir, CONTRACT_SNAPSHOTS_DIRNAME, storageHashHex(storageHash));
}

/**
 * Recompute-and-compare integrity check for loaded contract snapshots,
 * mirroring `verifyMigrationHash` for migration packages and
 * `assertDescriptorSelfConsistency` for extension descriptors: the store is
 * content-addressed, so the JSON read back for a hash must reproduce that
 * hash. Verified hashes are memoised per instance, so a snapshot resolved
 * repeatedly in one command run is hashed once. The recompute is coupled to
 * the emit-time canonicalization: a release that changes the family hooks
 * or hash canonicalization rules must regenerate (or migrate) existing
 * snapshot stores, or every pre-existing snapshot reads as tampered.
 */
export interface SnapshotContentVerifier {
  /**
   * Throws `MIGRATION.CONTRACT_SNAPSHOT_CONTENT_MISMATCH` when
   * `contractJson`'s content does not recompute to `storageHash` — the hash
   * the snapshot at `jsonPath` was addressed by.
   */
  assertSnapshotContentMatches(contractJson: unknown, storageHash: string, jsonPath: string): void;
}

export function createSnapshotContentVerifier(
  hooks?: SnapshotCanonicalizationHooks,
): SnapshotContentVerifier {
  const verified = new Set<string>();

  return {
    assertSnapshotContentMatches(contractJson, storageHash, jsonPath) {
      if (verified.has(storageHash)) {
        return;
      }
      const record = blindCast<
        { target?: unknown; targetFamily?: unknown; storage?: unknown },
        'contractJson is unknown JSON; only the identity fields the hash covers are read here'
      >(contractJson ?? {});
      const computedHash = recomputePublishedStorageHash({
        target: record.target,
        targetFamily: record.targetFamily,
        storage: record.storage,
        hooks,
      });
      if (computedHash !== storageHash) {
        throw errorContractSnapshotContentMismatch({ storageHash, computedHash, jsonPath });
      }
      verified.add(storageHash);
    },
  };
}

export interface ContractSnapshotInput {
  readonly contractJson: unknown;
  readonly contractDts: string;
}

export async function writeContractSnapshot(
  migrationsDir: string,
  storageHash: string,
  input: ContractSnapshotInput,
): Promise<{ readonly written: boolean; readonly dir: string }> {
  const dir = contractSnapshotDir(migrationsDir, storageHash);

  // contractJson is unknown JSON; only storage.storageHash is read, to check
  // it against the hash the snapshot is being written under.
  const contractStorage = blindCast<
    { storage?: { storageHash?: unknown } },
    'contractJson is unknown JSON; only the storage.storageHash field is read here'
  >(input.contractJson);
  const actualStorageHash = contractStorage.storage?.storageHash;
  if (actualStorageHash !== storageHash) {
    throw errorContractSnapshotHashMismatch(
      storageHash,
      typeof actualStorageHash === 'string' ? actualStorageHash : String(actualStorageHash),
      dir,
    );
  }

  if (await directoryExists(dir)) {
    return { written: false, dir };
  }

  const snapshotsDir = join(migrationsDir, CONTRACT_SNAPSHOTS_DIRNAME);
  const tmpDir = join(
    snapshotsDir,
    `.tmp-${storageHashHex(storageHash)}-${Date.now()}-${randomBytes(4).toString('hex')}`,
  );
  await mkdir(tmpDir, { recursive: true });

  const jsonContent = `${canonicalizeJson(input.contractJson)}\n`;
  const dtsContent = input.contractDts.endsWith('\n')
    ? input.contractDts
    : `${input.contractDts}\n`;

  try {
    await writeFile(join(tmpDir, CONTRACT_JSON_FILE), jsonContent);
    await writeFile(join(tmpDir, CONTRACT_DTS_FILE), dtsContent);
    await rename(tmpDir, dir);
  } catch (error) {
    await rm(tmpDir, { recursive: true, force: true });
    if (hasErrnoCode(error, 'EEXIST') || hasErrnoCode(error, 'ENOTEMPTY')) {
      return { written: false, dir };
    }
    throw error;
  }

  return { written: true, dir };
}

/**
 * When `verifyContent` is supplied, the parsed snapshot's content is checked
 * against the hash it was addressed by before being returned — the store is
 * content-addressed, and a snapshot edited in place under an unchanged hash
 * would otherwise flow into planning as if it were the recorded contract.
 */
export async function readContractSnapshotJson(
  migrationsDir: string,
  storageHash: string,
  verifyContent?: SnapshotContentVerifier,
): Promise<unknown> {
  const jsonPath = join(contractSnapshotDir(migrationsDir, storageHash), CONTRACT_JSON_FILE);

  let raw: string;
  try {
    raw = await readFile(jsonPath, 'utf-8');
  } catch (error) {
    if (hasErrnoCode(error, 'ENOENT')) {
      throw errorContractSnapshotMissing(storageHash, jsonPath);
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw errorInvalidJson(jsonPath, e instanceof Error ? e.message : String(e));
  }
  verifyContent?.assertSnapshotContentMatches(parsed, storageHash, jsonPath);
  return parsed;
}

/**
 * Tolerant read: a missing store entry (ENOENT), an unparseable
 * `contract.json`, the JSON literal `null`, or a `storageHash` that isn't a
 * well-formed 64-hex value all resolve to `undefined` rather than
 * throwing — parity with the catch-all tolerance of the pre-store
 * `readEndContractJson` (`io.ts`), which never validated the hash it was
 * keyed by either. Any other fs error (e.g. `EACCES` on a present-but-
 * unreadable file) propagates rather than silently loading a contract-less
 * package. When `verifyContent` is supplied, an entry whose content does not
 * recompute to its address also resolves to `undefined` — tampered content
 * must not flow onward, and the strict store reads report the same file
 * loudly as `MIGRATION.CONTRACT_SNAPSHOT_CONTENT_MISMATCH`.
 */
export async function readContractSnapshotJsonTolerant(
  migrationsDir: string,
  storageHash: string,
  verifyContent?: SnapshotContentVerifier,
): Promise<unknown | undefined> {
  let jsonPath: string;
  try {
    jsonPath = join(contractSnapshotDir(migrationsDir, storageHash), CONTRACT_JSON_FILE);
  } catch {
    return undefined;
  }

  let raw: string;
  try {
    raw = await readFile(jsonPath, 'utf-8');
  } catch (error) {
    if (hasErrnoCode(error, 'ENOENT')) {
      return undefined;
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (parsed === null) {
    return undefined;
  }
  try {
    verifyContent?.assertSnapshotContentMatches(parsed, storageHash, jsonPath);
  } catch (error) {
    if (
      MigrationToolsError.is(error) &&
      error.code === 'MIGRATION.CONTRACT_SNAPSHOT_CONTENT_MISMATCH'
    ) {
      return undefined;
    }
    throw error;
  }
  return parsed;
}

export async function readContractSnapshotDts(
  migrationsDir: string,
  storageHash: string,
): Promise<string> {
  const dtsPath = join(contractSnapshotDir(migrationsDir, storageHash), CONTRACT_DTS_FILE);

  try {
    return await readFile(dtsPath, 'utf-8');
  } catch (error) {
    if (hasErrnoCode(error, 'ENOENT')) {
      throw errorContractSnapshotMissing(storageHash, dtsPath);
    }
    throw error;
  }
}

export function snapshotsImportPathFrom(packageDir: string, migrationsDir: string): string {
  const storeDir = join(migrationsDir, CONTRACT_SNAPSHOTS_DIRNAME);
  return relative(packageDir, storeDir).split('\\').join('/');
}
