import type { Contract } from '@internal/contract/types';
import type {
  SchemaEntityCoordinate,
  SchemaOwnership,
} from '@internal/framework-components/control';
import type { MigrationGraph } from '../graph';
import type { IntegrityQueryOptions, IntegrityViolation } from '../integrity-violation';
import type { OnDiskMigrationPackage } from '../package';
import type { Refs } from '../refs';
import type { ContractSpaceHeadRecord } from '../verify-contract-spaces';

export interface ContractAtOptions {
  readonly refName?: string;
}

export type ContractAtResult =
  | {
      readonly provenance: 'ref';
      readonly hash: string;
      readonly contractJson: unknown;
      readonly contract: Contract;
    }
  | {
      readonly provenance: 'graph-node';
      readonly hash: string;
      readonly contractJson: unknown;
      readonly contract: Contract;
    };

/**
 * One contract space — app or extension — as the aggregate holds it.
 * Every space in a {@link ContractSpaceAggregate} has the same shape.
 *
 * A value of this type is a tolerant snapshot of one space's on-disk state, not a
 * validated value: `packages` is the raw migration-package list as read
 * from disk (a hash- or invariants-mismatched package is retained here;
 * a genuinely unparseable one is omitted), and integrity is judged
 * separately by {@link ContractSpaceAggregate.checkIntegrity}.
 *
 * - `spaceId`: `'app'` for the application, otherwise the extension's
 *   id (validated against `[a-z][a-z0-9_-]{0,63}`).
 * - `packages`: raw on-disk migration packages, as read; never
 *   integrity-validated at load.
 * - `refs`: the user-authored refs under `migrations/<spaceId>/refs/*.json`.
 * - `headRef`: the system head ref read from
 *   `migrations/<spaceId>/refs/head.json`, or `null` when absent
 *   (represented as a `headRefMissing` violation, never fatal). The app
 *   space's head ref is always synthesised from its live contract's
 *   storage hash, so it is never `null`.
 * - `graph()`: the migration graph this space's packages induce —
 *   lazily reconstructed on first call and memoised. Pure structure: a
 *   `from === to` self-edge is represented, not rejected.
 * - `contract()`: the deserialized contract for this space — lazily
 *   produced on first call and memoised. For the app it is the live
 *   contract the caller supplied; for an extension it is the contract
 *   snapshot store entry keyed by the space's head ref hash, run through
 *   the family's `deserializeContract`. Throws if the store entry is
 *   missing or undeserializable (surfaced as `contractUnreadable` by
 *   `checkIntegrity` under `checkContracts`); callers gate before
 *   querying it.
 * - `contractAt(hash, opts?)`: materializes the contract at an arbitrary
 *   graph node — when `opts.refName` is set, resolve the ref's pointer
 *   and read the contract snapshot store entry keyed by the pointer's
 *   hash; else find the package whose `metadata.to === hash` and read
 *   the contract snapshot store entry keyed by that hash. Lazy per
 *   `(hash, refName?)` memoisation; throws typed {@link MigrationToolsError}
 *   values compatible with CLI mappers.
 */
export interface AggregateContractSpace {
  readonly spaceId: string;
  readonly packages: readonly OnDiskMigrationPackage[];
  readonly refs: Refs;
  readonly headRef: ContractSpaceHeadRecord | null;
  graph(): MigrationGraph;
  contract(): Contract;
  contractAt(hash: string, opts?: ContractAtOptions): Promise<ContractAtResult>;
}

/**
 * Tolerant, queryable snapshot of a project's on-disk migration state:
 * the app contract space plus every extension contract space, each a
 * {@link AggregateContractSpace}.
 *
 * Produced once per CLI invocation by `loadContractSpaceAggregate`.
 * Building the aggregate never throws on disk content; every consumer
 * obtains spaces / packages / refs / graphs from this one value rather
 * than re-deriving them from disk.
 *
 * - `targetId`: the app contract's target; every space is expected to
 *   share it (a mismatch surfaces as a `targetMismatch` violation under
 *   `checkContracts`).
 * - `app` / `extensions`: retained as fields for the existing planner /
 *   verifier / runner consumers. `extensions` is sorted alphabetically
 *   by `spaceId` (the apply-ordering convention).
 * - `listSpaces()` / `hasSpace()` / `space()` / `spaces()`: the query
 *   surface the read commands consume — `app` first, then extension ids
 *   lex-ascending.
 * - `declaresEntity(coordinate)` / `declaringSpaces(coordinate)`: ownership
 *   queries — does any contract space declare a storage entity at this
 *   coordinate (namespace, entity kind, and name), and which spaces do? The verifier's
 *   unclaimed-elements pass asks these of the diff's extra findings; the
 *   migration planner asks `declaresEntity` per live extra node to decide
 *   whether some space owns it (the aggregate satisfies the framework
 *   {@link SchemaOwnership} oracle). The passive aggregate answers both; it
 *   runs no diff.
 * - `checkIntegrity()`: judges the loaded model and returns every
 *   violation (never bailing at the first). Config/contract-dependent
 *   checks run only when the matching {@link IntegrityQueryOptions} opt
 *   is set.
 */
export interface ContractSpaceAggregate extends SchemaOwnership {
  readonly targetId: string;
  readonly app: AggregateContractSpace;
  readonly extensions: readonly AggregateContractSpace[];
  listSpaces(): readonly string[];
  hasSpace(id: string): boolean;
  space(id: string): AggregateContractSpace | undefined;
  spaces(): readonly AggregateContractSpace[];
  declaresEntity(coordinate: SchemaEntityCoordinate): boolean;
  declaringSpaces(coordinate: SchemaEntityCoordinate): readonly string[];
  checkIntegrity(opts?: IntegrityQueryOptions): readonly IntegrityViolation[];
}
