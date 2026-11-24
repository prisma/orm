import { createHash } from 'node:crypto';
import { blindCast, castAs } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import {
  canonicalizeSections,
  type PreserveEmptyPredicate,
  type StorageSort,
} from './canonicalization';
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

interface CanonicalizationHooks {
  readonly shouldPreserveEmpty?: PreserveEmptyPredicate | undefined;
  readonly sortStorage?: StorageSort | undefined;
}

function hashSection(
  input: { readonly target: string; readonly targetFamily: string } & Record<string, unknown>,
  hooks: CanonicalizationHooks = {},
): string {
  const asJson = castAs<Record<string, unknown>>(JSON.parse(JSON.stringify(input)));
  const canonical = canonicalizeSections(asJson, {
    ...ifDefined('shouldPreserveEmpty', hooks.shouldPreserveEmpty),
    ...ifDefined('sortStorage', hooks.sortStorage),
  });
  return sha256(JSON.stringify(canonical, null, 2));
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
    hashSection(
      {
        targetFamily: args.targetFamily,
        target: args.target,
        storage: omitNamespaceKindsForHash(args.storage),
      },
      args,
    ),
  );
}

export function computeExecutionHash(args: {
  target: string;
  targetFamily: string;
  execution: Record<string, unknown>;
}): ExecutionHashBase<string> {
  return blindCast<ExecutionHashBase<string>, 'sha256 digest of canonicalized execution'>(
    hashSection({
      targetFamily: args.targetFamily,
      target: args.target,
      execution: args.execution,
    }),
  );
}

export function computeProfileHash(args: {
  target: string;
  targetFamily: string;
  capabilities: Record<string, Record<string, boolean>>;
}): ProfileHashBase<string> {
  return blindCast<ProfileHashBase<string>, 'sha256 digest of canonicalized profile'>(
    hashSection({
      targetFamily: args.targetFamily,
      target: args.target,
      capabilities: args.capabilities,
    }),
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

/** The capabilities a family computes a contract's profile hash from. */
export type ProfileHashCapabilities = (
  contract: HashedContractSections,
) => Record<string, Record<string, boolean>>;

export interface AssertContractHashesOptions {
  readonly contracts: readonly ExpectedContractHashes[];
  readonly shouldPreserveEmpty?: PreserveEmptyPredicate;
  readonly sortStorage?: StorageSort;
  /**
   * The capabilities the family computes the profile hash from. Defaults to the contract's `capabilities`.
   */
  readonly profileHashCapabilities?: ProfileHashCapabilities;
}

/**
 * Throws when the hash rules give any saved contract a storage, profile or execution hash other than the one expected, naming each contract and hash that differs. Families and targets call it from their tests, with their own canonicalization hooks and profile-hash capabilities, to hold their hashes fixed within a major.
 */
export function assertContractHashes(options: AssertContractHashesOptions): void {
  const failing = options.contracts
    .map((expected) => ({
      name: expected.name,
      differences: contractHashDifferences(expected, options),
    }))
    .filter(({ differences }) => differences.length > 0);
  if (failing.length === 0) return;
  throw new Error(
    [
      `The hash rules give different hashes for ${failing.length} saved contract${failing.length === 1 ? '' : 's'}:`,
      ...failing.flatMap(({ name, differences }) =>
        differences.map((difference) => `Contract "${name}": ${difference}`),
      ),
    ].join('\n'),
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
      ...ifDefined('shouldPreserveEmpty', options.shouldPreserveEmpty),
      ...ifDefined('sortStorage', options.sortStorage),
    }),
    expected.storageHash,
  );
  compare(
    'profile',
    computeProfileHash({
      target: contract.target,
      targetFamily: contract.targetFamily,
      capabilities: options.profileHashCapabilities?.(contract) ?? contract.capabilities,
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
