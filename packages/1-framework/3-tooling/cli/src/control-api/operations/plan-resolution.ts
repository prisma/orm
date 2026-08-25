import type { Contract } from '@internal/contract/types';
import type { AggregateContractSpace } from '@internal/migration-tools/aggregate';
import { MigrationToolsError } from '@internal/migration-tools/errors';
import type { MigrationGraph } from '@internal/migration-tools/graph';
import {
  assertHashIsGraphNode,
  findLatestMigration,
  isGraphNode,
} from '@internal/migration-tools/migration-graph';
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

export type FromResolution =
  | { kind: 'greenfield'; fromHash: null; fromContract: null }
  | { kind: 'graph-node'; fromHash: string; fromContract: Contract }
  | {
      kind: 'ref';
      fromHash: string;
      fromContract: Contract;
      contractDts: string;
      contractJson: unknown;
    }
  | {
      kind: 'auto-baseline';
      fromHash: string;
      fromContract: Contract;
      contractDts: string;
      contractJson: unknown;
    };

export interface ResolveFromForPlanInput {
  readonly optionsFrom?: string | undefined;
  readonly space: AggregateContractSpace;
}

function graphIsEmpty(space: AggregateContractSpace): boolean {
  return space.packages.length === 0;
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

export function assertFromIsGraphNode(
  fromHash: string,
  graph: MigrationGraph,
  refs: Refs,
  graphTipHash: string | null,
): void {
  try {
    assertHashIsGraphNode(fromHash, graph);
  } catch (error) {
    if (MigrationToolsError.is(error) && error.code === 'MIGRATION.HASH_NOT_IN_GRAPH') {
      throw errorPlanForgotTheFlag(fromHash, getReachableRefs(refs, graph), graphTipHash, {
        cause: error,
      });
    }
    throw error;
  }
}

type RefContractResolution =
  | {
      kind: 'ref';
      hash: string;
      contract: Contract;
      contractJson: unknown;
      contractDts: string;
    }
  | {
      kind: 'graph-node';
      hash: string;
      contract: Contract;
      contractJson: unknown;
      contractDts: string;
    };

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
        contractJson: at.contractJson,
        contractDts: at.contractDts,
      });
    }

    return ok({
      kind: 'graph-node',
      hash: at.hash,
      contract: at.contract,
      contractJson: at.contractJson,
      contractDts: at.contractDts,
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

  const { hash, contract, contractJson, contractDts } = resolution.value;
  if (graphIsEmpty(input.space)) {
    return ok({
      kind: 'auto-baseline',
      fromHash: hash,
      fromContract: contract,
      contractDts,
      contractJson,
    });
  }

  const graph = input.space.graph();
  const graphTip = findLatestMigration(graph)?.to ?? null;
  try {
    assertFromIsGraphNode(hash, graph, refs, graphTip);
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
    contractDts,
    contractJson,
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
        return ok({ kind: 'greenfield', fromHash: null, fromContract: null });
      }
      return notOk(
        errorPlanOriginUnknown(
          getReachableRefs(refs, graph),
          findLatestMigration(graph)?.to ?? null,
        ),
      );
    }
    return resolveFromPolicy(
      { hash: dbRef.hash, provenance: { kind: 'ref', refName: 'db' } },
      input,
      refs,
    );
  }

  const refResult = parseContractRef(optionsFrom, { graph, refs });
  if (!refResult.ok) {
    if (looksLikeFullHash(optionsFrom)) {
      const empty = graphIsEmpty(space);
      const graphTip = findLatestMigration(graph)?.to ?? null;
      if (empty) {
        return notOk(errorSnapshotMissing(optionsFrom, { viaRef: false }));
      }
      return notOk(errorPlanForgotTheFlag(optionsFrom, getReachableRefs(refs, graph), graphTip));
    }
    return notOk(mapRefResolutionError(refResult.failure));
  }

  if (refResult.value.provenance.kind === 'reserved-empty') {
    return ok({ kind: 'greenfield', fromHash: null, fromContract: null });
  }

  return resolveFromPolicy(refResult.value, input, refs, optionsFrom);
}

export interface ResolveToForPlanInput {
  readonly space: AggregateContractSpace;
}

export interface ResolvedContractRef {
  readonly hash: string;
  readonly contract: Contract;
  readonly contractJson: unknown;
  readonly contractDts: string;
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

  const resolution = await resolveContractRef(refResult.value, space, {
    explicitLabel: optionsTo,
    artifactRole: 'to',
  });
  if (!resolution.ok) {
    return resolution;
  }

  const { hash, contract, contractJson, contractDts } = resolution.value;
  return ok({ hash, contract, contractJson, contractDts });
}
