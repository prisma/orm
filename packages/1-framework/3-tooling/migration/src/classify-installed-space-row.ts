import type { ContractSpace } from '@internal/framework-components/control';
import type { ContractMarkerRecordLike } from './aggregate/marker-types';
import { reconstructGraph } from './migration-graph';

/**
 * Where a database's row of a contract space that an installed package carries stands against that space.
 *
 * - `atHead`: the row records the space's head and every invariant the head requires.
 * - `behind`: there is no row, or the row records a contract the installed migrations lead on from; applying them brings it to the head.
 * - `ahead`: the row records a contract the installed migrations never reach, every invariant on it is one they provide, and the space's ledger shows the database passed through the head. A later release of the same major version brought it further, and within a major version the space's migrations only add, so this release can use it as it is.
 * - `unreachable`: this release cannot use the database. `laterMajor`: the row carries an invariant the installed migrations never provide, which only a release of a later major version writes. `unknownContract`: the row records a contract the installed migrations never reach and the ledger never recorded the head.
 */
export type InstalledSpacePosition =
  | { readonly kind: 'atHead' }
  | { readonly kind: 'behind' }
  | { readonly kind: 'ahead' }
  | {
      readonly kind: 'unreachable';
      readonly reason: 'laterMajor' | 'unknownContract';
      readonly markerHash: string;
    };

export interface ClassifyInstalledSpaceRowInputs {
  readonly contractSpace: ContractSpace;
  readonly row: ContractMarkerRecordLike | null;
  /** The space's ledger rows. Consulted only when {@link classificationNeedsLedger} says so; pass `[]` otherwise. */
  readonly ledger: readonly { readonly to: string }[];
}

function recordsHead(contractSpace: ContractSpace, row: ContractMarkerRecordLike): boolean {
  const { headRef } = contractSpace;
  return (
    row.storageHash === headRef.hash &&
    headRef.invariants.every((invariant) => row.invariants.includes(invariant))
  );
}

function reachedByInstalledMigrations(
  contractSpace: ContractSpace,
  row: ContractMarkerRecordLike,
): boolean {
  return reconstructGraph(contractSpace.migrations).nodes.has(row.storageHash);
}

/** Whether {@link classifyInstalledSpaceRow} needs the space's ledger for this row: only a row at a contract the installed migrations never reach does. */
export function classificationNeedsLedger(
  contractSpace: ContractSpace,
  row: ContractMarkerRecordLike | null,
): boolean {
  return (
    row !== null &&
    !recordsHead(contractSpace, row) &&
    !reachedByInstalledMigrations(contractSpace, row)
  );
}

export function classifyInstalledSpaceRow(
  inputs: ClassifyInstalledSpaceRowInputs,
): InstalledSpacePosition {
  const { contractSpace, row, ledger } = inputs;
  if (row === null) return { kind: 'behind' };
  if (recordsHead(contractSpace, row)) return { kind: 'atHead' };
  if (reachedByInstalledMigrations(contractSpace, row)) return { kind: 'behind' };

  const providedInvariants = new Set(
    contractSpace.migrations.flatMap((pkg) => pkg.metadata.providedInvariants),
  );
  if (!row.invariants.every((invariant) => providedInvariants.has(invariant))) {
    return { kind: 'unreachable', reason: 'laterMajor', markerHash: row.storageHash };
  }
  if (ledger.some((entry) => entry.to === contractSpace.headRef.hash)) return { kind: 'ahead' };
  return { kind: 'unreachable', reason: 'unknownContract', markerHash: row.storageHash };
}
