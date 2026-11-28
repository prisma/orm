import { createHash } from 'node:crypto';
import { blindCast, castAs } from '@internal/utils/casts';
import { canonicalizeSections, type NormalizeStorage } from './canonicalization';
import { contractError } from './contract-errors';
import { isPlainRecord } from './is-plain-record';
import type { ExecutionHashBase, ProfileHashBase, StorageHashBase } from './types';

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

const storageAsGiven: NormalizeStorage = (storage) => storage;

function hashSection(
  input: { readonly target: string; readonly targetFamily: string } & Record<string, unknown>,
  normalizeStorage: NormalizeStorage,
): string {
  const asJson = castAs<Record<string, unknown>>(JSON.parse(JSON.stringify(input)));
  const canonical = canonicalizeSections(asJson, normalizeStorage);
  return sha256(JSON.stringify(canonical, null, 2));
}

export type ComputeStorageHashArgs = {
  target: string;
  targetFamily: string;
  storage: Record<string, unknown>;
  /** The family's normal form of `storage`, the same function the family writes `storage` with. */
  readonly normalizeStorage: NormalizeStorage;
};

export function computeStorageHash(args: ComputeStorageHashArgs): StorageHashBase<string> {
  return blindCast<StorageHashBase<string>, 'sha256 digest of canonicalized storage'>(
    hashSection(
      {
        targetFamily: args.targetFamily,
        target: args.target,
        storage: omitNamespaceKindsForHash(args.storage),
      },
      args.normalizeStorage,
    ),
  );
}

export function computeExecutionHash(args: {
  target: string;
  targetFamily: string;
  execution: Record<string, unknown>;
}): ExecutionHashBase<string> {
  return blindCast<ExecutionHashBase<string>, 'sha256 digest of canonicalized execution'>(
    hashSection(
      {
        targetFamily: args.targetFamily,
        target: args.target,
        execution: args.execution,
      },
      storageAsGiven,
    ),
  );
}

/** The capabilities that are on: a flag that is `false` means the same as an absent one. */
function capabilitiesThatAreOn(
  capabilities: Record<string, Record<string, boolean>>,
): Record<string, Record<string, true>> {
  return Object.fromEntries(
    Object.entries(capabilities).flatMap(([namespace, flags]) => {
      const on = Object.keys(flags).filter((flag) => flags[flag] === true);
      return on.length === 0
        ? []
        : [[namespace, Object.fromEntries(on.map((flag) => [flag, true]))]];
    }),
  );
}

export function computeProfileHash(args: {
  target: string;
  targetFamily: string;
  capabilities: Record<string, Record<string, boolean>>;
}): ProfileHashBase<string> {
  return blindCast<ProfileHashBase<string>, 'sha256 digest of canonicalized profile'>(
    hashSection(
      {
        targetFamily: args.targetFamily,
        target: args.target,
        capabilities: capabilitiesThatAreOn(args.capabilities),
      },
      storageAsGiven,
    ),
  );
}

/**
 * The sections of a saved `contract.json` that its hashes cover. The `storageHash` and `executionHash` it stores are ignored.
 */
export interface HashedContractSections {
  readonly target: string;
  readonly targetFamily: string;
  readonly storage: Record<string, unknown>;
  readonly capabilities: Record<string, Record<string, boolean>>;
  readonly execution?: Record<string, unknown>;
}

export interface ExpectedContractHashes {
  readonly name: string;
  readonly contract: HashedContractSections;
  readonly storageHash: string;
  readonly profileHash: string;
  readonly executionHash?: string;
}

export interface AssertContractHashesOptions {
  readonly contracts: readonly ExpectedContractHashes[];
  /** The family's normal form of `storage`. */
  readonly normalizeStorage: NormalizeStorage;
}

/**
 * Throws when the hash rules give any saved contract a storage, profile or execution hash other than the one expected, naming each contract and hash that differs. Families and targets call it from their tests, with their family's normal form of `storage`, to hold their hashes fixed within a major. It holds only what its saved contracts contain, so they must cover every field the family's normal form names.
 */
export function assertContractHashes(options: AssertContractHashesOptions): void {
  const failing = options.contracts
    .map((expected) => ({
      name: expected.name,
      differences: contractHashDifferences(expected, options),
    }))
    .filter(({ differences }) => differences.length > 0);
  if (failing.length === 0) return;
  throw contractError(
    'CONTRACT.HASH_MISMATCH',
    [
      `The hash rules give different hashes for ${failing.length} saved contract${failing.length === 1 ? '' : 's'}:`,
      ...failing.flatMap(({ name, differences }) =>
        differences.map((difference) => `Contract "${name}": ${difference}`),
      ),
    ].join('\n'),
    { meta: { contracts: failing.map(({ name }) => name) } },
  );
}

function contractHashDifferences(
  expected: ExpectedContractHashes,
  options: AssertContractHashesOptions,
): string[] {
  const { contract } = expected;
  const { storageHash: _storedStorageHash, ...storage } = contract.storage;
  const differences: string[] = [];
  const compare = (label: string, actual: string, wanted: string) => {
    if (actual !== wanted) {
      differences.push(`the ${label} hash is ${actual}, but ${wanted} was expected.`);
    }
  };
  compare(
    'storage',
    computeStorageHash({
      target: contract.target,
      targetFamily: contract.targetFamily,
      storage,
      normalizeStorage: options.normalizeStorage,
    }),
    expected.storageHash,
  );
  compare(
    'profile',
    computeProfileHash({
      target: contract.target,
      targetFamily: contract.targetFamily,
      capabilities: contract.capabilities,
    }),
    expected.profileHash,
  );
  if (contract.execution === undefined) {
    if (expected.executionHash !== undefined) {
      differences.push(
        `the contract has no execution section, but execution hash ${expected.executionHash} was expected.`,
      );
    }
    return differences;
  }
  const { executionHash: _storedExecutionHash, ...execution } = contract.execution;
  const executionHash = computeExecutionHash({
    target: contract.target,
    targetFamily: contract.targetFamily,
    execution,
  });
  if (expected.executionHash === undefined) {
    differences.push(`the execution hash is ${executionHash}, but no execution hash was expected.`);
  } else {
    compare('execution', executionHash, expected.executionHash);
  }
  return differences;
}
