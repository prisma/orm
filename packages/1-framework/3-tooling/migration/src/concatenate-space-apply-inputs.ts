import { errorDuplicateSpaceId } from './errors';
import { APP_SPACE_ID } from './space-layout';

/**
 * Per-space input the runner consumes when applying a migration.
 *
 * The shape is target-agnostic: callers (today the SQL family; later
 * any other family) bind `TOp` to their own per-target operation type
 * (e.g. `SqlMigrationPlanOperation<TTargetDetails>` for the SQL family)
 * and the helper preserves it through the concatenation.
 *
 * - `migrationDirectory` is the on-disk migration directory for the
 *   space — `<projectRoot>/migrations/<space-id>` (uniform; the app
 *   subspaces under its own `<APP_SPACE_ID>/` directory).
 * - `currentMarkerHash` and `currentMarkerInvariants` are the values
 *   read from the marker row (in `_prisma.marker` on PostgreSQL) keyed by `space = <space-id>`
 *   (T1.1). `null` hash = no marker row yet.
 * - `path` is the per-space operation list resolved from
 *   `findPathWithDecision(currentMarker, ref.hash, effectiveRequired)`
 *   per ADR 208, materialised against the on-disk migration packages.
 *
 * @see specs/framework-mechanism.spec.md § 4 — Runner.
 */
export interface SpaceApplyInput<TOp> {
  readonly spaceId: string;
  readonly migrationDirectory: string;
  readonly currentMarkerHash: string | null;
  readonly currentMarkerInvariants: readonly string[];
  readonly path: readonly TOp[];
}

/**
 * Order a set of per-space apply inputs into the canonical cross-space
 * sequence the runner applies under a single transaction.
 *
 * Cross-space ordering convention (sub-spec § 4):
 *
 * 1. **Extension spaces first**, alphabetically by `spaceId`.
 * 2. **App space last** — only one `'app'` entry expected, at most.
 *
 * Rationale: extensions install their own structural objects (types,
 * functions, helper tables) before the app's structural ops reference
 * them. Putting app-space last lets app-space ops freely depend on any
 * extension-space declaration in the same transaction.
 *
 * Determinism (NFR6): the output order is independent of the input
 * order, so two callers with the same set of `extensions` produce
 * identical apply sequences.
 *
 * Atomicity: rejects duplicate `spaceId`s with
 * `MIGRATION.DUPLICATE_SPACE_ID` before producing any output. This
 * mirrors {@link import('./plan-all-spaces').planAllSpaces} so the
 * planner-side and runner-side helpers reject malformed inputs the same
 * way (callers don't need a separate dedup pass).
 *
 * Synchronous, pure, no I/O: callers resolve marker rows and `path`
 * before invoking this helper. The actual DB application — driving the
 * transaction, committing marker writes, recording the per-space marker
 * rows — happens at the SQL-family consumption site (per the
 * helper-location convention from R3).
 */
export function concatenateSpaceApplyInputs<TOp>(
  inputs: readonly SpaceApplyInput<TOp>[],
): readonly SpaceApplyInput<TOp>[] {
  const seen = new Set<string>();
  for (const input of inputs) {
    if (seen.has(input.spaceId)) {
      throw errorDuplicateSpaceId(input.spaceId);
    }
    seen.add(input.spaceId);
  }

  const extensions: SpaceApplyInput<TOp>[] = [];
  let appSpace: SpaceApplyInput<TOp> | undefined;
  for (const input of inputs) {
    if (input.spaceId === APP_SPACE_ID) {
      appSpace = input;
    } else {
      extensions.push(input);
    }
  }

  extensions.sort((a, b) => {
    if (a.spaceId < b.spaceId) return -1;
    if (a.spaceId > b.spaceId) return 1;
    return 0;
  });

  return appSpace ? [...extensions, appSpace] : extensions;
}
