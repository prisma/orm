import {
  PRISMA_TABLES_SPACE_ID,
  type SchemaEntityCoordinate,
  type VerifyDatabaseSchemaResult,
} from '@internal/framework-components/control';
import { coordinateKey } from '@internal/framework-components/ir';
import type { Result } from '@internal/utils/result';
import { notOk, ok } from '@internal/utils/result';
import { requireHeadRef } from './aggregate';
import type { ContractMarkerRecordLike } from './marker-types';
import type { AggregateContractSpace, ContractSpaceAggregate } from './types';
import {
  collectExtraElementCoordinates,
  type SchemaEntityKindClassifier,
  type SchemaSubjectClassifier,
  stripExtraFindings,
} from './unclaimed-elements';

/**
 * Caller policy for the verifier. Today's only knob is
 * `mode`: `strict` treats unclaimed elements (live tables declared by
 * no contract space) as errors; `lenient` treats them as
 * informational. Maps directly to `db verify --strict`.
 */
export interface VerifierInput {
  readonly aggregate: ContractSpaceAggregate;
  readonly markersBySpaceId: ReadonlyMap<string, ContractMarkerRecordLike | null>;
  readonly schemaIntrospection: unknown;
  readonly mode: 'strict' | 'lenient';
  /**
   * Caller-supplied per-space schema verifier. The CLI wires this to the
   * family's `verifySchema`, run against the **full** introspected schema. The
   * verifier then produces two outputs from the per-space results: each space's
   * contract-satisfaction view (extras stripped) and one deduplicated list of
   * live elements no contract space declares. It touches no storage shape.
   */
  readonly verifySchemaForSpace: (
    schema: unknown,
    space: AggregateContractSpace,
    mode: 'strict' | 'lenient',
  ) => VerifyDatabaseSchemaResult;
  /**
   * Classifies a diff issue's subject granularity on demand — the injected
   * capability the caller reads off the family instance (via
   * `hasSchemaSubjectClassifier`) when it has one. Absent for families that
   * classify nothing; the unclaimed-elements sweep falls back to path shape
   * in that case. Never stamped onto the issue or the node.
   */
  readonly classifySubjectGranularity?: SchemaSubjectClassifier;
  /**
   * Classifies a diff issue's subject storage `entityKind` on demand — the
   * sibling injected capability read off the family instance alongside
   * `classifySubjectGranularity`. Absent for families that classify
   * nothing; the unclaimed-elements sweep falls back to a placeholder in
   * that case. Never stamped onto the issue or the node.
   */
  readonly classifyEntityKind?: SchemaEntityKindClassifier;
}

/**
 * Marker-check result per contract space. Mirrors the four cases the
 * `verifyContractSpaces` primitive surfaces today, plus an `'absent'`
 * case for greenfield spaces (no marker row written yet — `db init`
 * not run).
 */
export type MarkerCheckResult =
  | { readonly kind: 'ok' }
  | { readonly kind: 'absent' }
  | {
      readonly kind: 'hashMismatch';
      readonly markerHash: string;
      readonly expected: string;
    }
  | { readonly kind: 'missingInvariants'; readonly missing: readonly string[] };

export interface MarkerCheckSection {
  readonly perSpace: ReadonlyMap<string, MarkerCheckResult>;
  readonly orphanMarkers: readonly {
    readonly spaceId: string;
    readonly row: ContractMarkerRecordLike;
  }[];
}

export interface SchemaCheckSection {
  /**
   * Per contract space, its contract-satisfaction view: the space's
   * declared nodes only, each pass/fail by whether a missing/mismatch issue
   * concerns it. Extras are stripped; the space's verdict is missing/mismatch
   * only.
   */
  readonly perSpace: ReadonlyMap<string, VerifyDatabaseSchemaResult>;
  /**
   * One deduplicated, sorted list of live element names no contract
   * space declares (built from the diffs' extra findings, filtered by the
   * passive aggregate's ownership query). Reported once for the whole database,
   * not per space. Strict callers fail on a non-empty list; lenient callers show
   * it informationally.
   */
  readonly unclaimed: readonly string[];
}

export interface VerifierSuccess {
  readonly markerCheck: MarkerCheckSection;
  readonly schemaCheck: SchemaCheckSection;
}

export type VerifierError = {
  readonly kind: 'introspectionFailure';
  readonly detail: string;
};

export type VerifierOutput = Result<VerifierSuccess, VerifierError>;

/**
 * Verify a {@link ContractSpaceAggregate} against the live database
 * state. Bundles two checks:
 *
 * - `markerCheck` per contract space: compare the live marker row against the
 *   space's `headRef.hash` + `headRef.invariants`. Absence is a
 *   distinct kind, not an error (callers — `db verify` strict vs
 *   `db init` precondition — choose how to interpret it).
 * - `schemaCheck`: two distinct outputs from the per-space diffs.
 *   `perSpace` — each space verified against the **full**
 *   introspected schema, then its extras stripped, leaving the space's
 *   declared nodes (its contract-satisfaction view; verdict is
 *   missing/mismatch only). `unclaimed` — the extras gathered
 *   across every space, deduplicated, and filtered to the names no contract
 *   space declares (via the passive aggregate's ownership query); reported
 *   once for the database. No schema is pruned before verifying.
 *
 * `markerCheck.orphanMarkers` lists every marker row whose `space` is
 * not a contract space of the aggregate. `db verify` callers reject orphans;
 * future tooling may not.
 *
 * Pure synchronous function; no I/O. The caller (CLI) gathers
 * `markersBySpaceId` and `schemaIntrospection` ahead of the call.
 */
export function verifyMigration(input: VerifierInput): VerifierOutput {
  try {
    return runVerifyMigration(input);
  } catch (error) {
    return notOk({
      kind: 'introspectionFailure',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

function runVerifyMigration(input: VerifierInput): VerifierOutput {
  const {
    aggregate,
    markersBySpaceId,
    schemaIntrospection,
    mode,
    verifySchemaForSpace,
    classifySubjectGranularity,
    classifyEntityKind,
  } = input;
  const allSpaces: ReadonlyArray<AggregateContractSpace> = [aggregate.app, ...aggregate.extensions];
  const declaredSpaceIds = new Set([PRISMA_TABLES_SPACE_ID, ...allSpaces.map((m) => m.spaceId)]);

  // Marker check per contract space.
  const markerPerSpace = new Map<string, MarkerCheckResult>();
  for (const space of allSpaces) {
    const marker = markersBySpaceId.get(space.spaceId) ?? null;
    if (marker === null) {
      markerPerSpace.set(space.spaceId, { kind: 'absent' });
      continue;
    }
    const headRef = requireHeadRef(space);
    if (marker.storageHash !== headRef.hash) {
      markerPerSpace.set(space.spaceId, {
        kind: 'hashMismatch',
        markerHash: marker.storageHash,
        expected: headRef.hash,
      });
      continue;
    }
    const markerInvariants = new Set(marker.invariants);
    const missing = headRef.invariants.filter((id) => !markerInvariants.has(id));
    if (missing.length > 0) {
      markerPerSpace.set(space.spaceId, {
        kind: 'missingInvariants',
        missing: [...missing].sort(),
      });
      continue;
    }
    markerPerSpace.set(space.spaceId, { kind: 'ok' });
  }

  // Orphan markers: entries in markersBySpaceId whose spaceId is not a
  // contract space of the aggregate, nor the space of Prisma's own tables,
  // which the installed target package carries.
  const orphanMarkers: { spaceId: string; row: ContractMarkerRecordLike }[] = [];
  for (const [spaceId, row] of markersBySpaceId) {
    if (row !== null && !declaredSpaceIds.has(spaceId)) {
      orphanMarkers.push({ spaceId, row });
    }
  }
  orphanMarkers.sort((a, b) => a.spaceId.localeCompare(b.spaceId));

  // Schema check: verify each space against the full schema, then split the
  // results in two: each space's contract-satisfaction view (extras
  // stripped), and every extra coordinate across all spaces, deduplicated
  // and kept only when no contract space declares it at that coordinate.
  const schemaPerSpace = new Map<string, VerifyDatabaseSchemaResult>();
  const extraCoordinates = new Map<string, SchemaEntityCoordinate>();
  for (const space of allSpaces) {
    const result = verifySchemaForSpace(schemaIntrospection, space, mode);
    schemaPerSpace.set(space.spaceId, stripExtraFindings(result, classifySubjectGranularity));
    for (const coordinate of collectExtraElementCoordinates(
      result,
      classifySubjectGranularity,
      classifyEntityKind,
    )) {
      extraCoordinates.set(coordinateKey(coordinate), coordinate);
    }
  }
  const unclaimed = [
    ...new Set(
      [...extraCoordinates.values()]
        .filter((coordinate) => !aggregate.declaresEntity(coordinate))
        .map((coordinate) => coordinate.entityName),
    ),
  ].sort((a, b) => a.localeCompare(b));

  return ok({
    markerCheck: {
      perSpace: markerPerSpace,
      orphanMarkers,
    },
    schemaCheck: {
      perSpace: schemaPerSpace,
      unclaimed,
    },
  });
}
