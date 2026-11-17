import type { Contract } from '@internal/contract/types';
import type { AggregateContractSpace } from '@internal/migration-tools/aggregate';
import { MigrationToolsError } from '@internal/migration-tools/errors';
import type { MigrationGraph } from '@internal/migration-tools/graph';
import { assertHashIsGraphNode, isGraphNode } from '@internal/migration-tools/migration-graph';
import type { ContractRef } from '@internal/migration-tools/ref-resolution';
import { parseContractRef } from '@internal/migration-tools/ref-resolution';
import type { Refs } from '@internal/migration-tools/refs';
import { notOk, ok, type Result } from '@internal/utils/result';
import {
  CliStructuredError,
  errorPlanForgotTheFlag,
  errorPlanOriginUnknown,
  errorSnapshotMissing,
  mapRefResolutionError,
} from '../../utils/cli-errors';
import { mapContractAtError } from './contract-at-errors';

const FULL_HASH_PATTERN = /^([0-9a-f]{64}|empty)$/;

export function looksLikeFullHash(input: string): boolean {
  return FULL_HASH_PATTERN.test(input);
}

/**
 * Set when the origin was derived from the `db` ref by default (no `--from`)
 * and that node already has outgoing edges. Planning from it forks the
 * graph, so the caller must surface it to the user.
 */
export interface DefaultOriginForks {
  readonly refName: string;
  readonly refHash: string;
  readonly outgoingTo: readonly string[];
}

export type FromResolution =
  | { kind: 'greenfield'; fromHash: null; fromContract: null; defaulted: boolean }
  | {
      kind: 'graph-node';
      fromHash: string;
      fromContract: Contract;
      defaultOriginForks?: DefaultOriginForks;
    }
  | {
      kind: 'ref';
      fromHash: string;
      fromContract: Contract;
      defaultOriginForks?: DefaultOriginForks;
    }
  | { kind: 'auto-baseline'; fromHash: string; fromContract: Contract };

export interface ResolveFromForPlanInput {
  readonly optionsFrom?: string | undefined;
  readonly space: AggregateContractSpace;
}

function graphIsEmpty(space: AggregateContractSpace): boolean {
  return space.packages.length === 0;
}

function outgoingDestinations(graph: MigrationGraph, hash: string): readonly string[] {
  return [...new Set((graph.forwardChain.get(hash) ?? []).map((edge) => edge.to))].sort();
}

function getReachableRefs(
  refs: Refs,
  graph: MigrationGraph,
): ReadonlyArray<{ name: string; hash: string }> {
  return Object.entries(refs)
    .flatMap(([name, entry]) =>
      entry && isGraphNode(entry.hash, graph) ? [{ name, hash: entry.hash }] : [],
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function assertFromIsGraphNode(fromHash: string, graph: MigrationGraph, refs: Refs): void {
  try {
    assertHashIsGraphNode(fromHash, graph);
  } catch (error) {
    if (MigrationToolsError.is(error) && error.code === 'MIGRATION.HASH_NOT_IN_GRAPH') {
      throw errorPlanForgotTheFlag(fromHash, getReachableRefs(refs, graph), { cause: error });
    }
    throw error;
  }
}

export type DefaultOriginHash =
  | { kind: 'greenfield'; fromHash: null }
  | { kind: 'ref'; refName: 'db'; fromHash: string }
  | { kind: 'ref-needs-baseline'; refName: 'db'; fromHash: string };

/**
 * The origin a command uses when `--from` is omitted, as a hash only. An empty
 * graph with no `db` ref plans from the empty database. An empty graph with a
 * `db` ref is `ref-needs-baseline`: the ref names a real contract that is not
 * a graph node yet (`migration plan` handles this by writing a baseline first).
 * Otherwise the `db` ref must exist and point at a graph node. `migration
 * plan` materialises the contract on top of this; `migration new` needs only
 * the hash.
 */
export function resolveDefaultOriginHash(
  space: AggregateContractSpace,
): Result<DefaultOriginHash, CliStructuredError> {
  const refs = space.refs;
  const dbRef = refs['db'];
  if (graphIsEmpty(space)) {
    return ok(
      dbRef
        ? { kind: 'ref-needs-baseline', refName: 'db', fromHash: dbRef.hash }
        : { kind: 'greenfield', fromHash: null },
    );
  }
  const graph = space.graph();
  if (!dbRef) {
    return notOk(errorPlanOriginUnknown(getReachableRefs(refs, graph)));
  }
  try {
    assertFromIsGraphNode(dbRef.hash, graph, refs);
  } catch (error) {
    if (CliStructuredError.is(error)) {
      return notOk(error);
    }
    throw error;
  }
  return ok({ kind: 'ref', refName: 'db', fromHash: dbRef.hash });
}

type RefContractResolution =
  | { kind: 'ref'; hash: string; contract: Contract }
  | { kind: 'graph-node'; hash: string; contract: Contract };

async function resolveContractRef(
  parsed: ContractRef,
  space: AggregateContractSpace,
  options?: { readonly explicitLabel?: string; readonly artifactRole?: 'from' | 'to' },
): Promise<Result<RefContractResolution, CliStructuredError>> {
  const { hash, provenance } = parsed;
  const refName = provenance.kind === 'ref' ? provenance.refName : undefined;

  try {
    const at = await space.contractAt(hash, refName !== undefined ? { refName } : undefined);

    if (at.provenance === 'ref') {
      return ok({
        kind: 'ref',
        hash: at.hash,
        contract: at.contract,
      });
    }

    return ok({
      kind: 'graph-node',
      hash: at.hash,
      contract: at.contract,
    });
  } catch (error) {
    return mapContractAtError(
      error,
      options?.artifactRole !== undefined ? { artifactRole: options.artifactRole } : undefined,
    );
  }
}

async function resolveFromPolicy(
  parsed: ContractRef,
  input: ResolveFromForPlanInput,
  refs: Refs,
  explicitFromLabel?: string,
): Promise<Result<FromResolution, CliStructuredError>> {
  const resolution = await resolveContractRef(parsed, input.space, {
    ...(explicitFromLabel !== undefined ? { explicitLabel: explicitFromLabel } : {}),
    artifactRole: 'from',
  });
  if (!resolution.ok) {
    return resolution;
  }

  if (resolution.value.kind === 'graph-node') {
    return ok({
      kind: 'graph-node',
      fromHash: resolution.value.hash,
      fromContract: resolution.value.contract,
    });
  }

  const { hash, contract } = resolution.value;
  if (graphIsEmpty(input.space)) {
    return ok({
      kind: 'auto-baseline',
      fromHash: hash,
      fromContract: contract,
    });
  }

  const graph = input.space.graph();
  try {
    assertFromIsGraphNode(hash, graph, refs);
  } catch (error) {
    if (CliStructuredError.is(error)) {
      return notOk(error);
    }
    throw error;
  }
  return ok({
    kind: 'ref',
    fromHash: hash,
    fromContract: contract,
  });
}

export async function resolveFromForPlan(
  input: ResolveFromForPlanInput,
): Promise<Result<FromResolution, CliStructuredError>> {
  const { optionsFrom, space } = input;
  const graph = space.graph();
  const refs = space.refs;

  if (optionsFrom === undefined) {
    const dbRef = refs['db'];
    if (!dbRef) {
      if (graphIsEmpty(space)) {
        return ok({ kind: 'greenfield', fromHash: null, fromContract: null, defaulted: true });
      }
      return notOk(errorPlanOriginUnknown(getReachableRefs(refs, graph)));
    }
    const resolved = await resolveFromPolicy(
      { hash: dbRef.hash, provenance: { kind: 'ref', refName: 'db' } },
      input,
      refs,
    );
    if (!resolved.ok) {
      return resolved;
    }
    const value = resolved.value;
    if (value.kind === 'ref' || value.kind === 'graph-node') {
      const outgoingTo = outgoingDestinations(graph, value.fromHash);
      if (outgoingTo.length > 0) {
        return ok({
          ...value,
          defaultOriginForks: { refName: 'db', refHash: value.fromHash, outgoingTo },
        });
      }
    }
    return resolved;
  }

  const refResult = parseContractRef(optionsFrom, { graph, refs });
  if (!refResult.ok) {
    if (looksLikeFullHash(optionsFrom)) {
      if (graphIsEmpty(space)) {
        return notOk(errorSnapshotMissing(optionsFrom, { viaRef: false }));
      }
      return notOk(errorPlanForgotTheFlag(optionsFrom, getReachableRefs(refs, graph)));
    }
    return notOk(mapRefResolutionError(refResult.failure));
  }

  if (refResult.value.provenance.kind === 'reserved-empty') {
    return ok({ kind: 'greenfield', fromHash: null, fromContract: null, defaulted: false });
  }

  return resolveFromPolicy(refResult.value, input, refs, optionsFrom);
}

export interface ResolveToForPlanInput {
  readonly space: AggregateContractSpace;
}

export interface ResolvedContractRef {
  readonly hash: string;
  readonly contract: Contract;
}

export async function resolveToForPlan(
  optionsTo: string,
  input: ResolveToForPlanInput,
): Promise<Result<ResolvedContractRef, CliStructuredError>> {
  const { space } = input;
  const graph = space.graph();
  const refs = space.refs;

  const refResult = parseContractRef(optionsTo, { graph, refs });
  if (!refResult.ok) {
    return notOk(mapRefResolutionError(refResult.failure));
  }

  if (refResult.value.provenance.kind === 'reserved-empty') {
    return notOk(
      mapRefResolutionError({
        kind: 'wrong-grammar',
        input: optionsTo,
        expectedGrammar: 'contract',
        message:
          '`@empty` is only valid as an origin (`--from`); planning a migration to the empty contract is not supported through this shortcut',
        fix: 'Pass `--to` a contract hash, ref name, or migration directory name. To plan starting from an empty database, use `--from @empty`.',
      }),
    );
  }

  const resolution = await resolveContractRef(refResult.value, space, {
    explicitLabel: optionsTo,
    artifactRole: 'to',
  });
  if (!resolution.ok) {
    return resolution;
  }

  const { hash, contract } = resolution.value;
  return ok({ hash, contract });
}
