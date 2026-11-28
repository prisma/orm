import { InternalError } from '@internal/utils/internal-error';
import { join } from 'pathe';
import { EMPTY_CONTRACT_HASH } from './constants';
import { readMigrationPackage, readMigrationsDir } from './io';
import { findPathWithDecision, reconstructGraph } from './migration-graph';
import type { MigrationOps } from './package';
import {
  type ContractSpaceHeadRef,
  readContractSpaceHeadRef,
} from './read-contract-space-head-ref';
import { spaceMigrationDirectory } from './space-layout';

/**
 * Outcome of {@link computeExtensionSpaceApplyPath} — a discriminated union
 * mirroring {@link import('./migration-graph').FindPathOutcome} so callers
 * can map structural / invariant failures to their preferred CLI envelope
 * without re-running pathfinding.
 */
export type ExtensionSpaceApplyPathOutcome =
  | {
      readonly kind: 'ok';
      readonly contractSpaceHeadRef: ContractSpaceHeadRef;
      /**
       * Sorted, deduplicated invariant ids covered by the walked path.
       * Mirrors the on-disk `providedInvariants` summed across edges and
       * canonicalised — what the runner stamps on the marker after apply.
       */
      readonly providedInvariants: readonly string[];
      /**
       * Path operations in apply order. Empty when the marker is already
       * at the recorded head (no-op).
       */
      readonly pathOps: MigrationOps;
      /**
       * Migration directory names walked, in order. Mirrors `pathOps`'s
       * structure but at the package granularity — useful for surfacing
       * "applied N migration(s)" messages.
       */
      readonly walkedMigrationDirs: readonly string[];
    }
  | { readonly kind: 'unreachable'; readonly contractSpaceHeadRef: ContractSpaceHeadRef }
  | {
      readonly kind: 'unsatisfiable';
      readonly contractSpaceHeadRef: ContractSpaceHeadRef;
      readonly missing: readonly string[];
      readonly structuralPath: readonly { readonly dirName: string; readonly to: string }[];
    }
  | { readonly kind: 'contractSpaceHeadRefMissing' };

/**
 * Inputs to {@link computeExtensionSpaceApplyPath}. The helper is
 * deliberately framework-neutral and consumes only on-disk state:
 *
 * - `projectMigrationsDir` is the project's top-level `migrations/` dir.
 * - `spaceId` selects the per-space subdirectory under it.
 * - `currentMarkerHash` / `currentMarkerInvariants` come from the live
 *   marker row keyed by `space = <spaceId>`. `null` hash = no marker yet
 *   (the pathfinder treats this as the empty-contract sentinel per ADR
 *   208).
 */
export interface ComputeExtensionSpaceApplyPathInputs {
  readonly projectMigrationsDir: string;
  readonly spaceId: string;
  readonly currentMarkerHash: string | null;
  readonly currentMarkerInvariants: readonly string[];
}

/**
 * Compute the apply path for an extension contract space — the shortest
 * sequence of on-disk migration packages that walks the live marker
 * forward to the on-disk head ref hash, covering every required
 * invariant.
 *
 * Reads only on-disk artifacts (`migrations/<spaceId>/refs/head.json`
 * and the per-space migration packages). **Does not import any
 * extension descriptor module** — `db init` / `db update` must remain
 * runnable without the descriptor source on disk.
 *
 * Behaviour:
 * - Returns `{ kind: 'ok', pathOps: [], … }` when the marker is already
 *   at the recorded head and no required invariants are missing.
 * - Returns `{ kind: 'unreachable' }` when the marker hash is not
 *   structurally connected to the recorded head in the graph.
 * - Returns `{ kind: 'unsatisfiable', missing, … }` when the marker is
 *   reachable but no path covers the required invariants.
 * - Returns `{ kind: 'contractSpaceHeadRefMissing' }` when the per-space
 *   `refs/head.json` is absent — the precheck verifier should already
 *   have rejected this case, but the helper is defensive so callers can
 *   surface a coherent error rather than throw.
 */
export async function computeExtensionSpaceApplyPath(
  inputs: ComputeExtensionSpaceApplyPathInputs,
): Promise<ExtensionSpaceApplyPathOutcome> {
  const { projectMigrationsDir, spaceId, currentMarkerHash, currentMarkerInvariants } = inputs;

  const contractSpaceHeadRef = await readContractSpaceHeadRef(projectMigrationsDir, spaceId);
  if (contractSpaceHeadRef === null) {
    return { kind: 'contractSpaceHeadRefMissing' };
  }

  const spaceDir = spaceMigrationDirectory(projectMigrationsDir, spaceId);
  const { packages, problems } = await readMigrationsDir(spaceDir, {
    migrationsDir: projectMigrationsDir,
  });
  const [problem] = problems;
  if (problem !== undefined) {
    await readMigrationPackage(join(spaceDir, problem.dirName), {
      migrationsDir: projectMigrationsDir,
    });
  }
  const graph = reconstructGraph(packages);

  // Live-marker layer encodes "no prior state" as EMPTY_CONTRACT_HASH;
  // mirror the `migrate` flow so a fresh-marker initial walk
  // hits the baseline migration whose `from` is EMPTY_CONTRACT_HASH.
  const fromHash = currentMarkerHash ?? EMPTY_CONTRACT_HASH;
  const required = new Set(
    contractSpaceHeadRef.invariants.filter((id) => !currentMarkerInvariants.includes(id)),
  );

  const outcome = findPathWithDecision(graph, fromHash, contractSpaceHeadRef.hash, { required });

  if (outcome.kind === 'unreachable') {
    return { kind: 'unreachable', contractSpaceHeadRef };
  }
  if (outcome.kind === 'unsatisfiable') {
    return {
      kind: 'unsatisfiable',
      contractSpaceHeadRef,
      missing: outcome.missing,
      structuralPath: outcome.structuralPath.map(({ dirName, to }) => ({ dirName, to })),
    };
  }

  const packagesByHash = new Map(packages.map((pkg) => [pkg.metadata.migrationHash, pkg]));

  const pathOps: MigrationOps[number][] = [];
  const walkedMigrationDirs: string[] = [];
  const providedInvariantsSet = new Set<string>();
  for (const edge of outcome.decision.selectedPath) {
    const pkg = packagesByHash.get(edge.migrationHash);
    if (!pkg) {
      // Path edges always come from the same `packages` array, so this
      // is only reachable when the graph is internally inconsistent —
      // surface it loudly rather than silently truncating the path.
      throw new InternalError(
        `Migration package missing for edge ${edge.migrationHash} in space "${spaceId}"`,
      );
    }
    walkedMigrationDirs.push(pkg.dirName);
    for (const op of pkg.ops) pathOps.push(op);
    for (const invariant of pkg.metadata.providedInvariants) providedInvariantsSet.add(invariant);
  }

  return {
    kind: 'ok',
    contractSpaceHeadRef,
    providedInvariants: [...providedInvariantsSet].sort(),
    pathOps,
    walkedMigrationDirs,
  };
}
