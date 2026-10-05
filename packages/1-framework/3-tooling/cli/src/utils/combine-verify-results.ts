import {
  VERIFY_CODE_SCHEMA_FAILURE,
  type VerifyDatabaseSchemaResult,
} from '@internal/framework-components/control';
import { InternalError } from '@internal/utils/internal-error';

/**
 * The combined per-space contract-satisfaction result plus the standalone
 * unclaimed-elements list, reported once. The CLI renders
 * both; `unclaimed` is never folded into the combined tree or its issues.
 */
export interface CombinedVerifyResult {
  readonly result: VerifyDatabaseSchemaResult;
  readonly unclaimed: readonly string[];
}

/**
 * Collapse the aggregate verifier's per-space contract-satisfaction results
 * into a single {@link VerifyDatabaseSchemaResult} for the CLI display
 * surface, and carry the deduplicated unclaimed-elements list alongside it.
 * Concatenates the issue lists across spaces; uses the app space's result as
 * the structural envelope (storage hash, target). Extras are already
 * stripped from each per-space result, so nothing here duplicates an
 * unclaimed element per space.
 *
 * **Unclaimed disposition.** In strict mode a non-empty `unclaimed` list fails
 * the combined verdict (`ok: false`); in lenient mode it is carried for
 * informational rendering only. The list itself is returned unchanged for the
 * renderer.
 *
 * **Summary policy.** Preserve the per-family phrasing whenever the
 * combined `ok` flag agrees with the app space's `ok` flag — this is
 * the common case (single-family deployments, single-app deployments)
 * and the family's "satisfies / does not satisfy contract" phrasing
 * stays user-visible. When the app passes but an extension fails (or
 * vice versa) the app's summary contradicts the envelope, so fall back
 * to the first failing space's summary. This keeps family phrasing
 * intact and the envelope internally consistent (`ok: false` ↔ failure
 * summary).
 */
export function combineVerifyResults(
  perSpace: ReadonlyMap<string, VerifyDatabaseSchemaResult>,
  appSpaceId: string,
  strict: boolean,
  unclaimed: readonly string[],
): CombinedVerifyResult {
  const appResult = perSpace.get(appSpaceId) ?? perSpace.values().next().value;
  if (appResult === undefined) {
    throw new InternalError(
      'Aggregate verifier returned no per-space verify results — this is a wiring bug.',
    );
  }

  let okAll = true;
  let firstFailure: VerifyDatabaseSchemaResult | undefined;
  let issues: VerifyDatabaseSchemaResult['schema']['issues'] = [];
  let warningIssues: VerifyDatabaseSchemaResult['schema']['issues'] = [];
  for (const [, result] of perSpace) {
    if (!result.ok) {
      okAll = false;
      if (firstFailure === undefined) firstFailure = result;
    }
    issues = [...issues, ...result.schema.issues];
    warningIssues = [...warningIssues, ...(result.schema.warnings?.issues ?? [])];
  }

  const unclaimedFails = strict && unclaimed.length > 0;
  const ok = okAll && !unclaimedFails;
  const unclaimedOnlyFailure = okAll && unclaimedFails;
  const failingSpace = appResult.ok ? firstFailure : appResult;
  const failureCode = unclaimedOnlyFailure
    ? VERIFY_CODE_SCHEMA_FAILURE
    : (failingSpace?.code ?? VERIFY_CODE_SCHEMA_FAILURE);

  // Prefer a failing space's family phrasing; else, when only the unclaimed list
  // fails the verdict, say so; else keep the app space's phrasing. When `okAll`
  // is false the loop assigned `firstFailure`, so the `?? appResult.summary`
  // fallback is unreachable — it exists only to keep the read cast-free.
  const summary = okAll
    ? unclaimedFails
      ? `Database schema has ${unclaimed.length} unclaimed element${unclaimed.length === 1 ? '' : 's'} (not in any contract)`
      : appResult.summary
    : appResult.ok
      ? (firstFailure?.summary ?? appResult.summary)
      : appResult.summary;

  return {
    result: {
      ok,
      ...(ok ? {} : { code: failureCode }),
      summary,
      contract: appResult.contract,
      target: appResult.target,
      schema: {
        issues,
        warnings: { issues: warningIssues },
      },
      meta: { strict },
      timings: { total: 0 },
    },
    unclaimed,
  };
}
