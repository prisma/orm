/**
 * Every structural problem the migration model can carry.
 *
 * Violations come in three groups:
 *
 * - **Recoverable**: the package or space is retained in the model;
 *   the violation is surfaced for policy (report, refuse, or ignore
 *   depending on the command).
 * - **Config/contract-dependent**: produced only when the matching
 *   `IntegrityQueryOptions` opt is set (declaredExtensions /
 *   checkContracts). The model is built without them; they surface
 *   when the caller explicitly asks for the broader integrity view.
 * - **Unloadable**: the package is omitted from the model entirely
 *   (its on-disk content cannot be parsed into an `OnDiskMigrationPackage`).
 *
 * `checkIntegrity()` on `ContractSpaceAggregate` returns the full set —
 * all violations across all spaces — never bailing at the first hit.
 */
export type IntegrityViolation =
  // recoverable — package/space retained, surfaced for policy
  | {
      readonly kind: 'sameSourceAndTarget';
      readonly spaceId: string;
      readonly dirName: string;
      readonly hash: string;
    }
  | {
      readonly kind: 'hashMismatch';
      readonly spaceId: string;
      readonly dirName: string;
      readonly stored: string;
      readonly computed: string;
    }
  | {
      readonly kind: 'providedInvariantsMismatch';
      readonly spaceId: string;
      readonly dirName: string;
    }
  | { readonly kind: 'headRefMissing'; readonly spaceId: string }
  | { readonly kind: 'headRefNotInGraph'; readonly spaceId: string; readonly hash: string }
  | {
      readonly kind: 'duplicateMigrationHash';
      readonly spaceId: string;
      readonly migrationHash: string;
      readonly dirNames: readonly string[];
    }
  | {
      readonly kind: 'refUnreadable';
      readonly spaceId: string;
      readonly refName: string;
      /** The ref file that could not be read. */
      readonly path: string;
      readonly detail: string;
    }
  // config/contract-dependent — produced only when the matching opt is set
  | { readonly kind: 'orphanSpaceDir'; readonly spaceId: string }
  | { readonly kind: 'declaredButUnmigrated'; readonly spaceId: string }
  | {
      readonly kind: 'targetMismatch';
      readonly spaceId: string;
      readonly expected: string;
      readonly actual: string;
    }
  | {
      readonly kind: 'disjointness';
      readonly element: string;
      readonly claimedBy: readonly string[];
    }
  | { readonly kind: 'contractUnreadable'; readonly spaceId: string; readonly detail: string }
  // genuinely unloadable — package omitted from space.packages
  | {
      readonly kind: 'packageUnloadable';
      readonly spaceId: string;
      readonly dirName: string;
      readonly detail: string;
    };

/**
 * One declared extension entry, drawn from `Config.extensions`.
 *
 * The integrity layer needs only:
 *
 * - `id` — the space id (also the directory name under `migrations/`),
 *   used for the layout-drift checks (`orphanSpaceDir` /
 *   `declaredButUnmigrated`).
 * - `targetId` — the target the declaring extension was configured for.
 *
 * Typed structurally so the migration-tools layer stays framework-neutral.
 */
export interface DeclaredExtensionEntry {
  readonly id: string;
  readonly targetId: string;
}

/**
 * Options controlling which config/contract-dependent violation checks
 * `checkIntegrity()` runs.
 *
 * Both opts default to disabled: a caller without the app contract or
 * declared extensions still gets the structurally-derivable violations
 * (hashMismatch, providedInvariantsMismatch, headRefMissing,
 * headRefNotInGraph, refUnreadable, sameSourceAndTarget, packageUnloadable).
 */
export interface IntegrityQueryOptions {
  /**
   * When provided, enables layout-drift checks: `orphanSpaceDir`
   * (a directory exists on disk for an extension not in the list) and
   * `declaredButUnmigrated` (an extension in the list has no on-disk dir).
   */
  readonly declaredExtensions?: readonly DeclaredExtensionEntry[];
  /**
   * When true, enables contract/disjointness/target checks:
   * `contractUnreadable`, `targetMismatch`, `disjointness`.
   */
  readonly checkContracts?: boolean;
}
