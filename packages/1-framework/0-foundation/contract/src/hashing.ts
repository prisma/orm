import { createHash } from 'node:crypto';
import { blindCast, castAs } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import type { JsonObject } from '@internal/utils/json';
import {
  canonicalizeContract,
  type PreserveEmptyPredicate,
  type StorageSort,
} from './canonicalization';
import type { Contract } from './contract-types';
import { isPlainRecord } from './is-plain-record';
import type { ExecutionHashBase, ProfileHashBase, StorageHashBase } from './types';

const SCHEMA_VERSION = '1';

// Storage hashes fingerprint table/column layout, not which target pack emitted a
// namespace. Persisted contract.json carries namespace `kind` discriminators;
// authoring-time hashes never included them (IR `kind` is non-enumerable).
function omitNamespaceKindsForHash(storage: unknown): unknown {
  if (!isPlainRecord(storage)) {
    return storage;
  }
  const namespaces = storage['namespaces'];
  if (!isPlainRecord(namespaces)) {
    return storage;
  }
  const stripped = Object.fromEntries(
    Object.entries(namespaces).map(([nsId, ns]) => {
      if (!isPlainRecord(ns)) return [nsId, ns];
      const { kind: _kind, ...rest } = ns;
      return [nsId, rest];
    }),
  );
  return { ...storage, namespaces: stripped };
}

function sha256(content: string): string {
  const hash = createHash('sha256');
  hash.update(content);
  return hash.digest('hex');
}

type HashContractSection = Record<string, unknown> & {
  readonly shouldPreserveEmpty?: PreserveEmptyPredicate;
  readonly sortStorage?: StorageSort;
};

function hashContract(section: HashContractSection): string {
  const { shouldPreserveEmpty, sortStorage, ...sectionData } = section;
  const storageForHash = omitNamespaceKindsForHash(sectionData['storage'] ?? {});
  const contract = blindCast<Contract, 'hash-only partial contract for canonicalizeContract'>({
    targetFamily: sectionData['targetFamily'],
    target: sectionData['target'],
    roots: {},
    domain: { namespaces: {} },
    execution: sectionData['execution'],
    extensions: {},
    capabilities: sectionData['capabilities'] ?? {},
    meta: {},
    profileHash: '',
    ...sectionData,
    storage: storageForHash,
  });
  return canonicalizeContract(contract, {
    schemaVersion: SCHEMA_VERSION,
    serializeContract: (c) => castAs<JsonObject>(JSON.parse(JSON.stringify(c))),
    ...ifDefined('shouldPreserveEmpty', shouldPreserveEmpty),
    ...ifDefined('sortStorage', sortStorage),
  });
}

export type ComputeStorageHashArgs = {
  target: string;
  targetFamily: string;
  storage: Record<string, unknown>;
  readonly shouldPreserveEmpty?: PreserveEmptyPredicate;
  readonly sortStorage?: StorageSort;
};

export function computeStorageHash(args: ComputeStorageHashArgs): StorageHashBase<string> {
  return blindCast<StorageHashBase<string>, 'sha256 digest of canonicalized storage'>(
    sha256(hashContract(args)),
  );
}

export function computeExecutionHash(args: {
  target: string;
  targetFamily: string;
  execution: Record<string, unknown>;
}): ExecutionHashBase<string> {
  return blindCast<ExecutionHashBase<string>, 'sha256 digest of canonicalized execution'>(
    sha256(hashContract(args)),
  );
}

export function computeProfileHash(args: {
  target: string;
  targetFamily: string;
  capabilities: Record<string, Record<string, boolean>>;
}): ProfileHashBase<string> {
  return blindCast<ProfileHashBase<string>, 'sha256 digest of canonicalized profile'>(
    sha256(hashContract(args)),
  );
}
