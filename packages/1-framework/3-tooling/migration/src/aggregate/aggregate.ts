import type { Contract, StorageNamespace } from '@internal/contract/types';
import type { SchemaEntityCoordinate } from '@internal/framework-components/control';
import { coordinateKey, elementCoordinates } from '@internal/framework-components/ir';
import { InternalError } from '@internal/utils/internal-error';
import { join } from 'pathe';
import type { SnapshotContentVerifier } from '../contract-snapshot-store';
import {
  contractSnapshotDir,
  readContractSnapshotDts,
  readContractSnapshotJson,
} from '../contract-snapshot-store';
import {
  errorBundleNotFoundForGraphNode,
  errorContractDeserializationFailed,
  errorHashNotInGraph,
  errorRefNotResolvable,
  MigrationToolsError,
} from '../errors';
import type { MigrationGraph } from '../graph';
import { isGraphNode } from '../graph-membership';
import type { IntegrityQueryOptions, IntegrityViolation } from '../integrity-violation';
import { reconstructGraph } from '../migration-graph';
import type { OnDiskMigrationPackage } from '../package';
import type { RefEntry, Refs } from '../refs';
import { readRef } from '../refs';
import type { ContractSpaceHeadRecord } from '../verify-contract-spaces';
import type {
  AggregateContractSpace,
  ContractAtOptions,
  ContractAtResult,
  ContractSpaceAggregate,
} from './types';

function contractAtMemoKey(hash: string, refName: string | undefined): string {
  return `${hash}\0${refName ?? ''}`;
}

function deserializeContractAtPath(
  filePath: string,
  contractJson: unknown,
  deserializeContract: (raw: unknown) => Contract,
): Contract {
  try {
    return deserializeContract(contractJson);
  } catch (error) {
    if (MigrationToolsError.is(error)) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw errorContractDeserializationFailed(filePath, message);
  }
}

async function readContractSnapshotEntry(
  migrationsDir: string,
  hash: string,
  deserializeContract: (raw: unknown) => Contract,
  verifySnapshotContent: SnapshotContentVerifier | undefined,
): Promise<{ contractJson: unknown; contractDts: string; contract: Contract }> {
  const contractJson = await readContractSnapshotJson(migrationsDir, hash, verifySnapshotContent);
  const contractDts = await readContractSnapshotDts(migrationsDir, hash);
  const jsonPath = join(contractSnapshotDir(migrationsDir, hash), 'contract.json');
  const contract = deserializeContractAtPath(jsonPath, contractJson, deserializeContract);
  return { contractJson, contractDts, contract };
}

async function resolveContractAt(args: {
  readonly hash: string;
  readonly opts: ContractAtOptions | undefined;
  readonly refsDir: string;
  readonly migrationsDir: string;
  readonly packages: readonly OnDiskMigrationPackage[];
  readonly graph: MigrationGraph;
  readonly deserializeContract: (raw: unknown) => Contract;
  readonly verifySnapshotContent: SnapshotContentVerifier | undefined;
}): Promise<ContractAtResult> {
  const {
    hash,
    opts,
    refsDir,
    migrationsDir,
    packages,
    graph,
    deserializeContract,
    verifySnapshotContent,
  } = args;
  const refName = opts?.refName;

  if (refName !== undefined) {
    let refEntry: RefEntry | undefined;
    try {
      refEntry = await readRef(refsDir, refName);
    } catch (error) {
      if (MigrationToolsError.is(error) && error.code === 'MIGRATION.UNKNOWN_REF') {
        refEntry = undefined;
      } else {
        throw error;
      }
    }

    if (refEntry) {
      const { contractJson, contractDts, contract } = await readContractSnapshotEntry(
        migrationsDir,
        refEntry.hash,
        deserializeContract,
        verifySnapshotContent,
      );
      return {
        hash: refEntry.hash,
        contractJson,
        contractDts,
        contract,
        provenance: 'ref',
      };
    }

    if (isGraphNode(hash, graph)) {
      return resolveGraphNodeContractAt({
        hash,
        migrationsDir,
        packages,
        deserializeContract,
        verifySnapshotContent,
        explicitLabel: refName,
      });
    }

    throw errorRefNotResolvable(refName);
  }

  if (isGraphNode(hash, graph)) {
    return resolveGraphNodeContractAt({
      hash,
      migrationsDir,
      packages,
      deserializeContract,
      verifySnapshotContent,
    });
  }

  throw errorHashNotInGraph(hash, graph);
}

async function resolveGraphNodeContractAt(args: {
  readonly hash: string;
  readonly migrationsDir: string;
  readonly packages: readonly OnDiskMigrationPackage[];
  readonly deserializeContract: (raw: unknown) => Contract;
  readonly verifySnapshotContent: SnapshotContentVerifier | undefined;
  readonly explicitLabel?: string;
}): Promise<ContractAtResult> {
  const {
    hash,
    migrationsDir,
    packages,
    deserializeContract,
    verifySnapshotContent,
    explicitLabel,
  } = args;
  const matchingBundle = packages.find((pkg) => pkg.metadata.to === hash);
  if (!matchingBundle) {
    throw errorBundleNotFoundForGraphNode(hash, explicitLabel);
  }

  const { contractJson, contractDts, contract } = await readContractSnapshotEntry(
    migrationsDir,
    hash,
    deserializeContract,
    verifySnapshotContent,
  );
  return {
    hash,
    contractJson,
    contractDts,
    contract,
    provenance: 'graph-node',
  };
}

/**
 * Resolve a contract space's head ref, asserting it is present. The apply/verify
 * engine only runs after `checkIntegrity` has refused on `headRefMissing`,
 * so a space reaching the planner / verifier without a head ref is a
 * programming error (the integrity gate was skipped), not a user-facing
 * state. The app space's head ref is always synthesised, so this only
 * ever guards an ungated extension space.
 */
export function requireHeadRef(space: AggregateContractSpace): ContractSpaceHeadRecord {
  if (space.headRef === null) {
    throw new InternalError(
      `Contract space "${space.spaceId}" has no head ref; the integrity gate must refuse a missing head ref before planning or verifying.`,
    );
  }
  return space.headRef;
}

/**
 * Build a {@link AggregateContractSpace} with lazily-memoised `graph()`,
 * `contract()`, and `contractAt()` facets.
 *
 * `graph()` reconstructs the migration graph from `packages` on first
 * call and caches it. `contract()` calls `resolveContract` on first call
 * and caches the result; a throwing `resolveContract` (e.g. a missing or
 * undeserializable on-disk contract) re-throws on each call rather than
 * caching a value — `checkIntegrity` surfaces that as `contractUnreadable`.
 * `contractAt()` materializes the contract at an arbitrary graph node with
 * the same resolution order as plan-time ref resolution: the ref's pointer
 * plus the store entry keyed by the pointer's hash first (when
 * `opts.refName` is set), else the contract snapshot store entry keyed by
 * the matching package's `to` hash.
 */
export function createAggregateContractSpace(args: {
  readonly spaceId: string;
  readonly packages: readonly OnDiskMigrationPackage[];
  readonly refs: Refs;
  readonly headRef: ContractSpaceHeadRecord | null;
  readonly refsDir: string;
  readonly migrationsDir: string;
  readonly resolveContract: () => Contract;
  readonly deserializeContract: (raw: unknown) => Contract;
  readonly verifySnapshotContent?: SnapshotContentVerifier;
}): AggregateContractSpace {
  const {
    spaceId,
    packages,
    refs,
    headRef,
    refsDir,
    migrationsDir,
    resolveContract,
    deserializeContract,
    verifySnapshotContent,
  } = args;
  let graphMemo: MigrationGraph | undefined;
  let contractMemo: Contract | undefined;
  const contractAtMemo = new Map<string, ContractAtResult>();

  function spaceGraph(): MigrationGraph {
    graphMemo ??= reconstructGraph(packages);
    return graphMemo;
  }

  return {
    spaceId,
    packages,
    refs,
    headRef,
    graph: spaceGraph,
    contract() {
      contractMemo ??= resolveContract();
      return contractMemo;
    },
    async contractAt(hash, opts) {
      const key = contractAtMemoKey(hash, opts?.refName);
      const cached = contractAtMemo.get(key);
      if (cached) {
        return cached;
      }

      const result = await resolveContractAt({
        hash,
        opts,
        refsDir,
        migrationsDir,
        packages,
        graph: spaceGraph(),
        deserializeContract,
        verifySnapshotContent,
      });
      contractAtMemo.set(key, result);
      return result;
    },
  };
}

/**
 * Collect the union of every namespace declared across all contract spaces of an
 * aggregate (app + extensions) and return a minimal object with the shape
 * `{ storage: { namespaces } }` suitable for passing to
 * `familyInstance.introspect`.
 *
 * Callers invoke this after the integrity gate (`buildContractSpaceAggregate`
 * with `checkContracts: true`), so every `space.contract()` call is safe —
 * no try/catch is needed here.
 */
export function collectAggregateNamespaces(aggregate: ContractSpaceAggregate): {
  readonly storage: { readonly namespaces: Readonly<Record<string, StorageNamespace>> };
} {
  const merged: Record<string, StorageNamespace> = {};
  for (const space of aggregate.spaces()) {
    for (const [key, ns] of Object.entries(space.contract().storage.namespaces)) {
      const existing = merged[key];
      merged[key] = existing === undefined ? ns : mergeNamespaceEntries(existing, ns);
    }
  }
  return { storage: { namespaces: merged } };
}

/**
 * Union two contract spaces' declarations for the same namespace id, per
 * entity kind. Two spaces may legitimately share a namespace (e.g. both
 * declaring tables in `public`); element-level disjointness is enforced by
 * `checkIntegrity`, so the kind maps never collide on a name — replacing the
 * whole namespace would silently drop the earlier space's entities.
 */
function mergeNamespaceEntries(a: StorageNamespace, b: StorageNamespace): StorageNamespace {
  const entries: Record<string, Readonly<Record<string, unknown>>> = { ...a.entries };
  for (const [entityKind, kindMap] of Object.entries(b.entries)) {
    entries[entityKind] = { ...entries[entityKind], ...kindMap };
  }
  return { ...a, entries };
}

/**
 * Assemble a {@link ContractSpaceAggregate} value from its contract spaces and a
 * `checkIntegrity` implementation. The query methods (`listSpaces` /
 * `hasSpace` / `space` / `spaces`) are derived here so every aggregate —
 * loader-built or test-built — shares one query surface: `app` first,
 * then `extensions` in the order supplied (the loader sorts them
 * lex-ascending by `spaceId`).
 */
export function createContractSpaceAggregate(args: {
  readonly targetId: string;
  readonly app: AggregateContractSpace;
  readonly extensions: readonly AggregateContractSpace[];
  readonly checkIntegrity: (opts?: IntegrityQueryOptions) => readonly IntegrityViolation[];
}): ContractSpaceAggregate {
  const { targetId, app, extensions, checkIntegrity } = args;
  const ordered: readonly AggregateContractSpace[] = [app, ...extensions];
  const byId = new Map(ordered.map((m) => [m.spaceId, m]));
  const spaceDeclares = (
    space: AggregateContractSpace,
    coordinate: SchemaEntityCoordinate,
  ): boolean => {
    const key = coordinateKey(coordinate);
    for (const coord of elementCoordinates(space.contract().storage)) {
      if (coordinateKey(coord) === key) return true;
    }
    return false;
  };
  return {
    targetId,
    app,
    extensions,
    listSpaces: () => ordered.map((m) => m.spaceId),
    hasSpace: (id) => byId.has(id),
    space: (id) => byId.get(id),
    spaces: () => ordered,
    declaresEntity: (coordinate) => ordered.some((space) => spaceDeclares(space, coordinate)),
    declaringSpaces: (coordinate) =>
      ordered.filter((space) => spaceDeclares(space, coordinate)).map((s) => s.spaceId),
    checkIntegrity,
  };
}
