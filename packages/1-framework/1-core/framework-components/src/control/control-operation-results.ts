import type { Contract } from '@internal/contract/types';
import type { SchemaDiffIssue } from './schema-diff';

export const VERIFY_CODE_MARKER_MISSING = 'CONTRACT.MARKER_MISSING';
export const VERIFY_CODE_HASH_MISMATCH = 'CONTRACT.MARKER_MISMATCH';
export const VERIFY_CODE_TARGET_MISMATCH = 'CONTRACT.TARGET_MISMATCH';
export const VERIFY_CODE_SCHEMA_FAILURE = 'CONTRACT.SCHEMA_VERIFICATION_FAILED';

export interface OperationContext {
  readonly contractPath?: string;
  readonly configPath?: string;
  readonly meta?: Readonly<Record<string, unknown>>;
}

export interface VerifyDatabaseResult {
  readonly ok: boolean;
  readonly code?: string;
  readonly summary: string;
  readonly contract: {
    readonly storageHash: string;
    readonly profileHash?: string;
  };
  readonly marker?: {
    readonly storageHash?: string;
    readonly profileHash?: string;
  };
  readonly target: {
    readonly expected: string;
    readonly actual?: string;
  };
  readonly missingCodecs?: readonly string[];
  readonly codecCoverageSkipped?: boolean;
  readonly meta?: {
    readonly configPath?: string;
    readonly contractPath: string;
  };
  readonly timings: {
    readonly total: number;
  };
}

/**
 * The issue-based schema-verify result. `ok` derives from the FAILURE list
 * only: a verify passes exactly when `schema.issues` is empty, post
 * strict-gating and control-policy disposition.
 *
 * `schema.warnings` carries warn-graded issues (an `observed`-policy
 * subject's drift, and any other `warn` disposition) in the same shape.
 * Warnings are informational — they never affect `ok` — but they MUST be
 * surfaced: an `observed` table that drifted yields `ok: true` with a
 * non-empty warnings channel, which is what distinguishes "watch without
 * failing" from full suppression.
 */
export interface VerifyDatabaseSchemaResult {
  readonly ok: boolean;
  readonly code?: string;
  readonly summary: string;
  readonly contract: {
    readonly storageHash: string;
    readonly profileHash?: string;
  };
  readonly target: {
    readonly expected: string;
    readonly actual?: string;
  };
  readonly schema: {
    readonly issues: readonly SchemaDiffIssue[];
    readonly warnings?: {
      readonly issues: readonly SchemaDiffIssue[];
    };
  };
  readonly meta?: {
    readonly configPath?: string;
    readonly contractPath?: string;
    readonly strict: boolean;
  };
  readonly timings: {
    readonly total: number;
  };
}

export interface EmitContractResult {
  readonly contractJson: string;
  readonly contractDts: string;
  readonly storageHash: string;
  readonly executionHash?: string;
  readonly profileHash: string;
}

export interface IntrospectSchemaResult<TSchemaIR> {
  readonly ok: true;
  readonly summary: string;
  readonly target: {
    readonly familyId: string;
    readonly id: string;
  };
  readonly schema: TSchemaIR;
  readonly meta?: {
    readonly configPath?: string;
    readonly dbUrl?: string;
  };
  readonly timings: {
    readonly total: number;
  };
}

/** The two hashes a contract marker holds. */
export interface MarkerHashes {
  readonly storageHash: string;
  readonly profileHash: string;
}

/** Whether two markers hold the same hashes, `null` standing for no marker. */
export function sameMarkerHashes(a: MarkerHashes | null, b: MarkerHashes | null): boolean {
  if (a === null || b === null) return a === b;
  return a.storageHash === b.storageHash && a.profileHash === b.profileHash;
}

/** A contract space whose marker is to be written with its contract's hashes. */
export interface SpaceToSign {
  readonly space: string;
  readonly contract: Contract;
  /**
   * The space's marker as the caller read it before verifying the space, or `null` when it had none. The marker is written only while it still holds these hashes.
   */
  readonly verifiedMarker: MarkerHashes | null;
}

/**
 * A space whose marker now holds its contract's hashes: `created` when it had no marker, `updated` when it held the hashes in `previous`, `unchanged` when it already held the contract's.
 */
export type SpaceSigned =
  | {
      readonly status: 'created' | 'unchanged';
      readonly space: string;
      readonly contract: MarkerHashes;
    }
  | {
      readonly status: 'updated';
      readonly space: string;
      readonly contract: MarkerHashes;
      readonly previous: MarkerHashes;
    };

/**
 * A space whose marker did not hold `expected`, the hashes the caller read before it verified the space, when the family came to write it. `found` is what the marker held instead. The marker was left as it was.
 */
export interface SpaceMarkerConflict {
  readonly status: 'conflict';
  readonly space: string;
  readonly contract: MarkerHashes;
  readonly expected: MarkerHashes | null;
  readonly found: MarkerHashes | null;
}

/** What signing did to one contract space's marker. */
export type SpaceSignature = SpaceSigned | SpaceMarkerConflict;
