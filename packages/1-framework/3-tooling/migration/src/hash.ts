import { createHash } from 'node:crypto';
import type { PreserveEmptyPredicate, StorageSort } from '@internal/contract/hashing';
import { computeStorageHash } from '@internal/contract/hashing';
import { canonicalizeJson } from '@internal/framework-components/utils';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import type { MigrationMetadata } from './metadata';
import type { MigrationOps, OnDiskMigrationPackage } from './package';

/**
 * The canonicalization hooks a family's emit pipeline computes storage
 * hashes with. Sourced from the target serializer's
 * `hashCanonicalizationHooks` — never from its serialization-preserve
 * hooks, which may be broader (Postgres preserves required entity-kind
 * fields at default values on disk that the published hash canonicalized
 * away).
 */
export interface SnapshotCanonicalizationHooks {
  readonly shouldPreserveEmpty?: PreserveEmptyPredicate;
  readonly sortStorage?: StorageSort;
}

/**
 * Recompute the storage hash a contract's content publishes as its
 * identity. The published `storage.storageHash` is the output of the emit
 * pipeline's `computeStorageHash` call over a storage object that did not
 * yet carry `storageHash`, so the field is stripped before recomputing.
 * Shared by snapshot content verification and descriptor
 * self-consistency — the one place this invariant lives.
 */
export function recomputePublishedStorageHash(args: {
  readonly target: unknown;
  readonly targetFamily: unknown;
  readonly storage: unknown;
  readonly hooks: SnapshotCanonicalizationHooks | undefined;
}): string {
  const storageRecord = blindCast<
    Record<string, unknown>,
    'the storage subtree is hashed as an opaque record; a non-record value simply fails the comparison'
  >(args.storage ?? {});
  const { storageHash: _published, ...storageWithoutHash } = storageRecord;
  return computeStorageHash({
    target: typeof args.target === 'string' ? args.target : '',
    targetFamily: typeof args.targetFamily === 'string' ? args.targetFamily : '',
    storage: storageWithoutHash,
    ...ifDefined('shouldPreserveEmpty', args.hooks?.shouldPreserveEmpty),
    ...ifDefined('sortStorage', args.hooks?.sortStorage),
  });
}

export interface VerifyResult {
  readonly ok: boolean;
  readonly reason?: 'mismatch';
  readonly storedHash: string;
  readonly computedHash: string;
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Content-addressed migration hash over (metadata envelope, ops). See
 * ADR 199 — Storage-only migration identity for the rationale: the
 * storage-hash bookends (`from`, `to`) inside the envelope anchor the
 * contract identity by hash. The full contract IRs are not part of the
 * manifest — they live in sibling `*-contract.json` files authored
 * alongside the migration, never inlined here.
 *
 * The integrity check is purely structural, not semantic. The function
 * canonicalizes its inputs via `sortKeys` (recursive) + `JSON.stringify`
 * and hashes the result. Target-specific operation payloads (`step.sql`,
 * Mongo's pipeline AST, …) are hashed verbatim — no per-target
 * normalization is required, because what's being verified is "do the
 * on-disk bytes still produce their recorded hash", not "do two
 * semantically-equivalent migrations hash the same". The latter is an
 * emit-drift concern (ADR 192 step 2).
 *
 * The symmetry across write and read holds because `JSON.parse(
 * JSON.stringify(x))` round-trips JSON-safe values losslessly and
 * `sortKeys` is idempotent and deterministic — write-time and read-time
 * canonicalization produce the same canonical bytes regardless of
 * source-side key ordering or whitespace.
 *
 * The `migrationHash` field on the metadata is stripped before hashing
 * so the function can be used both at write time (when no hash exists
 * yet) and at verify time (rehashing an already-attested record).
 */
export function computeMigrationHash(
  metadata: Omit<MigrationMetadata, 'migrationHash'> & { readonly migrationHash?: string },
  ops: MigrationOps,
): string {
  const { migrationHash: _migrationHash, ...strippedMeta } = metadata;

  const canonicalMetadata = canonicalizeJson(strippedMeta);
  const canonicalOps = canonicalizeJson(ops);

  const partHashes = [canonicalMetadata, canonicalOps].map(sha256Hex);
  return sha256Hex(canonicalizeJson(partHashes));
}

/**
 * Re-hash an in-memory migration package and compare against the stored
 * `migrationHash`. See `computeMigrationHash` for the canonicalization rules.
 *
 * Returns `{ ok: true }` when the package is internally consistent, or
 * `{ ok: false, reason: 'mismatch', storedHash, computedHash }` when it is
 * not — typically a sign of FS corruption, partial writes, or a post-emit
 * hand edit.
 */
export function verifyMigrationHash(pkg: OnDiskMigrationPackage): VerifyResult {
  const computed = computeMigrationHash(pkg.metadata, pkg.ops);

  if (pkg.metadata.migrationHash === computed) {
    return {
      ok: true,
      storedHash: pkg.metadata.migrationHash,
      computedHash: computed,
    };
  }

  return {
    ok: false,
    reason: 'mismatch',
    storedHash: pkg.metadata.migrationHash,
    computedHash: computed,
  };
}
