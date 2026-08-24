import { readdir, stat } from 'node:fs/promises';
import { join } from 'pathe';
import { MANIFEST_FILE } from './io';
import { APP_SPACE_ID, RESERVED_SPACE_SUBDIR_NAMES } from './space-layout';

function hasErrnoCode(error: unknown, code: string): boolean {
  return error instanceof Error && (error as { code?: string }).code === code;
}

/**
 * List the per-space subdirectories under
 * `<projectRoot>/migrations/`. Returns space-id directory names (sorted
 * alphabetically) — i.e. any non-dot-prefixed, non-reserved
 * ({@link RESERVED_SPACE_SUBDIR_NAMES}) subdirectory whose root does
 * **not** contain a `migration.json` manifest. The manifest is the
 * structural marker of a user-authored migration directory (see
 * `readMigrationsDir` in `./io`); directory names themselves belong to
 * the user and are not part of the contract. The reserved-name filter
 * keeps `migrations/snapshots/` (the contract snapshot store) from ever
 * being enumerated as a phantom contract space.
 *
 * Returns `[]` if the migrations directory does not exist (greenfield
 * project).
 *
 * Reads only the user's repo. **No descriptor import.** The caller
 * (verifier) feeds the result into {@link verifyContractSpaces} alongside
 * the loaded-space set and the marker rows.
 */
export async function listContractSpaceDirectories(
  projectMigrationsDir: string,
): Promise<readonly string[]> {
  let entries: { readonly name: string; readonly isDirectory: boolean }[];
  try {
    const dirents = await readdir(projectMigrationsDir, { withFileTypes: true });
    entries = dirents.map((d) => ({ name: d.name, isDirectory: d.isDirectory() }));
  } catch (error) {
    if (hasErrnoCode(error, 'ENOENT')) {
      return [];
    }
    throw error;
  }

  const namedCandidates = entries
    .filter((e) => e.isDirectory)
    .map((e) => e.name)
    .filter((name) => !name.startsWith('.'))
    .filter((name) => !RESERVED_SPACE_SUBDIR_NAMES.has(name))
    .sort();

  const manifestChecks = await Promise.all(
    namedCandidates.map(async (name) => {
      try {
        await stat(join(projectMigrationsDir, name, MANIFEST_FILE));
        return { name, isMigrationDir: true };
      } catch (error) {
        if (hasErrnoCode(error, 'ENOENT')) {
          return { name, isMigrationDir: false };
        }
        throw error;
      }
    }),
  );

  return manifestChecks.filter((c) => !c.isMigrationDir).map((c) => c.name);
}

/**
 * On-disk head value (`(hash, invariants)`) for one contract space.
 * The verifier compares this against the marker row for the same space
 * to detect drift between the user-emitted artifacts and the live DB
 * marker.
 */
export interface ContractSpaceHeadRecord {
  readonly hash: string;
  readonly invariants: readonly string[];
}

/**
 * Marker row read from `prisma_contract.marker` (one per `space`).
 * Caller resolves these via the family runtime's marker reader before
 * invoking {@link verifyContractSpaces}.
 */
export interface SpaceMarkerRecord {
  readonly hash: string;
  readonly invariants: readonly string[];
}

export interface VerifyContractSpacesInputs {
  /**
   * Set of contract spaces the project declares: `'app'` plus each
   * extension space in `extensions`. The caller's discovery path
   * never reads the extension descriptor module — it walks the
   * `extensions` configuration in `prisma.config.ts` for the
   * space ids.
   */
  readonly loadedSpaces: ReadonlySet<string>;

  /**
   * Per-space subdirectories observed under
   * `<projectRoot>/migrations/`. Resolved via
   * {@link listContractSpaceDirectories}.
   */
  readonly spaceDirsOnDisk: readonly string[];

  /**
   * Head ref per space, keyed by space id. Caller reads
   * `<projectRoot>/migrations/<space-id>/contract.json` and
   * `<projectRoot>/migrations/<space-id>/refs/head.json` to construct
   * this map. Spaces with no contract-space dir on disk simply omit a
   * map entry.
   */
  readonly headRefsBySpace: ReadonlyMap<string, ContractSpaceHeadRecord>;

  /**
   * Marker rows keyed by `space`. Caller reads them from the
   * `prisma_contract.marker` table.
   */
  readonly markerRowsBySpace: ReadonlyMap<string, SpaceMarkerRecord>;
}

export type SpaceVerifierViolation =
  | {
      readonly kind: 'declaredButUnmigrated';
      readonly spaceId: string;
      readonly remediation: string;
    }
  | {
      readonly kind: 'orphanMarker';
      readonly spaceId: string;
      readonly remediation: string;
    }
  | {
      readonly kind: 'orphanSpaceDir';
      readonly spaceId: string;
      readonly remediation: string;
    }
  | {
      readonly kind: 'hashMismatch';
      readonly spaceId: string;
      readonly priorHeadHash: string;
      readonly markerHash: string;
      readonly remediation: string;
    }
  | {
      readonly kind: 'invariantsMismatch';
      readonly spaceId: string;
      readonly onDiskInvariants: readonly string[];
      readonly markerInvariants: readonly string[];
      readonly remediation: string;
    };

export type VerifyContractSpacesResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly violations: readonly SpaceVerifierViolation[] };

/**
 * Pure structural verifier for the per-space mechanism. Aggregates the
 * three orphan / missing checks plus per-space hash and invariant
 * comparison.
 *
 * Algorithm:
 *
 * - For every extension space declared in `loadedSpaces` (`'app'`
 *   excluded — the per-space verifier is scoped to extension spaces;
 *   the app is verified through the aggregate path):
 *   - If no contract-space dir on disk → `declaredButUnmigrated`.
 *   - Else if `markerRowsBySpace` lacks an entry → no violation here;
 *     the live-DB compare done outside this helper is where the
 *     absence shows up.
 *   - Else compare marker hash / invariants vs. on-disk head hash /
 *     invariants → `hashMismatch` / `invariantsMismatch` on drift.
 * - For every contract-space dir on disk that is not in `loadedSpaces` →
 *   `orphanSpaceDir`.
 * - For every marker row whose `space` is not in `loadedSpaces` →
 *   `orphanMarker`. The app-space marker is always loaded (`'app'` is
 *   in `loadedSpaces` by definition).
 *
 * Output is deterministic: violations are sorted first by `kind`
 * (`declaredButUnmigrated` → `orphanMarker` → `orphanSpaceDir` →
 * `hashMismatch` → `invariantsMismatch`) then by `spaceId`. Two callers
 * passing equivalent inputs see byte-identical violation lists.
 *
 * Synchronous, pure, no I/O. **Does not import the extension descriptor**
 * (the inputs are pre-resolved by the caller); the verifier reads only
 * the user repo, not `node_modules`.
 */
export function verifyContractSpaces(
  inputs: VerifyContractSpacesInputs,
): VerifyContractSpacesResult {
  const violations: SpaceVerifierViolation[] = [];

  for (const spaceId of [...inputs.loadedSpaces].sort()) {
    if (spaceId === APP_SPACE_ID) continue;

    if (!inputs.spaceDirsOnDisk.includes(spaceId)) {
      violations.push({
        kind: 'declaredButUnmigrated',
        spaceId,
        remediation: `Extension '${spaceId}' is declared in extensions but has not been emitted; run \`{bin} db migrate\`.`,
      });
      continue;
    }

    const head = inputs.headRefsBySpace.get(spaceId);
    const marker = inputs.markerRowsBySpace.get(spaceId);
    if (!head || !marker) {
      continue;
    }

    if (head.hash !== marker.hash) {
      violations.push({
        kind: 'hashMismatch',
        spaceId,
        priorHeadHash: head.hash,
        markerHash: marker.hash,
        remediation: `Marker row for space '${spaceId}' is keyed at ${marker.hash}, but the on-disk ${join('migrations', spaceId, 'contract.json')} resolves to ${head.hash}. Run \`{bin} db update\` to advance the database, or \`{bin} db migrate\` if the descriptor was bumped without re-emitting.`,
      });
      continue;
    }

    const onDiskInvariants = [...head.invariants].sort();
    const markerInvariants = new Set(marker.invariants);
    const missing = onDiskInvariants.filter((id) => !markerInvariants.has(id));
    if (missing.length > 0) {
      violations.push({
        kind: 'invariantsMismatch',
        spaceId,
        onDiskInvariants,
        markerInvariants: [...marker.invariants].sort(),
        remediation: `Marker row for space '${spaceId}' is missing invariants [${missing.map((s) => JSON.stringify(s)).join(', ')}]. Run \`{bin} db update\` to apply the corresponding data-transform migrations.`,
      });
    }
  }

  for (const dir of [...inputs.spaceDirsOnDisk].sort()) {
    if (!inputs.loadedSpaces.has(dir)) {
      violations.push({
        kind: 'orphanSpaceDir',
        spaceId: dir,
        remediation: `Orphan contract-space directory \`${join('migrations', dir)}/\` for an extension not in extensions; remove the directory or re-add the extension.`,
      });
    }
  }

  for (const space of [...inputs.markerRowsBySpace.keys()].sort()) {
    if (!inputs.loadedSpaces.has(space)) {
      violations.push({
        kind: 'orphanMarker',
        spaceId: space,
        remediation: `Orphan marker row for space '${space}' (no longer in extensions); remediation: manually delete the row from \`prisma_contract.marker\`.`,
      });
    }
  }

  if (violations.length === 0) {
    return { ok: true };
  }

  const kindOrder: Record<SpaceVerifierViolation['kind'], number> = {
    declaredButUnmigrated: 0,
    orphanMarker: 1,
    orphanSpaceDir: 2,
    hashMismatch: 3,
    invariantsMismatch: 4,
  };

  violations.sort((a, b) => {
    const k = kindOrder[a.kind] - kindOrder[b.kind];
    if (k !== 0) return k;
    if (a.spaceId < b.spaceId) return -1;
    if (a.spaceId > b.spaceId) return 1;
    return 0;
  });

  return { ok: false, violations };
}
