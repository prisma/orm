import type {
  CanonicalizeContractOptions,
  PreserveEmptyPredicate,
} from '@internal/contract/hashing';
import {
  createPreserveEmptyPredicate,
  createStorageSort,
  type NamedArraySortTarget,
  type PathPattern,
} from '@internal/contract/hashing-utils';
import type { Contract, CrossReference } from '@internal/contract/types';
import type { EmissionSpi } from '@internal/framework-components/emission';
import type { JsonObject } from '@internal/utils/json';
import { createContract } from '@repo/test-utils/contract-factories';
import type { EmitOptions, EmitResult, EmitStackInput } from '../src/exports';
import { emit as emitImpl } from '../src/exports';

const identitySerialize = (c: Contract): JsonObject => c as unknown as JsonObject;
const identityDeserialize = (json: Record<string, unknown>): Contract =>
  json as unknown as Contract;

const sqlPreserveEmptyPatterns = [
  ['storage', 'namespaces', '*', 'entries', 'table'],
  ['storage', 'namespaces', '*', 'entries', 'table', '*'],
  ['storage', 'namespaces', '*', 'entries', 'table', '*', ['uniques', 'indexes', 'foreignKeys']],
  ['storage', 'namespaces', '*', 'entries', 'table', '*', 'foreignKeys', ['constraint', 'index']],
] as const satisfies readonly PathPattern[];

const sqlSortTargets = [
  { path: ['namespaces', '*', 'entries', 'table', '*'], arrayKeys: ['indexes', 'uniques'] },
] as const satisfies readonly NamedArraySortTarget[];

const sqlPreserveEmpty = createPreserveEmptyPredicate(sqlPreserveEmptyPatterns);
const sqlSortStorage = createStorageSort(sqlSortTargets);

const SQL_EMIT_HOOKS = {
  shouldPreserveEmpty: sqlPreserveEmpty satisfies PreserveEmptyPredicate,
  sortStorage: sqlSortStorage,
} satisfies Pick<CanonicalizeContractOptions, 'shouldPreserveEmpty' | 'sortStorage'>;

/**
 * Tests author JSON-clean contracts directly, so the canonicalisation
 * hook trivially passes through. Production callers thread the target
 * descriptor's `contractSerializer.serializeContract` instead.
 */
export function emit(
  contract: Contract,
  stack: EmitStackInput,
  family: EmissionSpi,
  options?: Omit<EmitOptions, 'serializeContract' | 'deserializeContract'>,
): Promise<EmitResult> {
  return emitImpl(contract, stack, family, {
    ...SQL_EMIT_HOOKS,
    ...options,
    serializeContract: identitySerialize,
    deserializeContract: identityDeserialize,
  });
}

type TestContractOverrides = {
  target?: string;
  targetFamily?: string;
  roots?: Record<string, CrossReference>;
  models?: Record<string, unknown>;
  /** Named domain namespaces; replaces the single unbound namespace `models` fills. */
  namespaces?: Record<string, unknown>;
  /** SQL storage tables keyed by namespace id, then table name; builds `storage.namespaces`. */
  tables?: Record<string, Record<string, unknown>>;
  valueObjects?: Record<string, unknown>;
  enum?: Record<string, unknown>;
  storage?: Record<string, unknown>;
  capabilities?: Record<string, Record<string, boolean>>;
  extensions?: Record<string, unknown>;
  execution?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  storageHash?: string;
  schemaVersion?: string;
  sources?: Record<string, unknown>;
};

/** Models map from canonical contract JSON (`domain.namespaces`, single namespace only). */
export function modelsFromCanonicalContract(
  json: Record<string, unknown>,
): Record<string, unknown> {
  const domain = json['domain'] as Record<string, unknown> | undefined;
  const namespaces = domain?.['namespaces'] as Record<string, unknown> | undefined;
  if (namespaces === undefined) {
    return {};
  }
  const namespaceIds = Object.keys(namespaces);
  if (namespaceIds.length !== 1) {
    throw new Error(
      `expected exactly one domain namespace in canonical JSON, found ${namespaceIds.length}`,
    );
  }
  const slice = namespaces[namespaceIds[0]!] as Record<string, unknown> | undefined;
  const models = slice?.['models'];
  if (models !== undefined && typeof models === 'object' && models !== null) {
    return models as Record<string, unknown>;
  }
  return {};
}

export function createTestContract(overrides: TestContractOverrides = {}): Contract {
  const {
    storageHash: _sh,
    schemaVersion: _sv,
    sources: _src,
    storage,
    tables,
    ...rest
  } = overrides;
  const cleanStorage = storage
    ? (() => {
        const { storageHash: _innerSh, ...storageRest } = storage as Record<string, unknown>;
        return storageRest;
      })()
    : tables
      ? {
          namespaces: Object.fromEntries(
            Object.entries(tables).map(([id, table]) => [id, { id, entries: { table } }]),
          ),
        }
      : undefined;
  return createContract({
    ...rest,
    ...(cleanStorage ? { storage: cleanStorage } : {}),
  } as Parameters<typeof createContract>[0]);
}
