import type { Contract } from '@internal/contract/types';
import type {
  SchemaDiffIssue,
  VerifyDatabaseSchemaResult,
} from '@internal/framework-components/control';
import { issueOutcome } from '@internal/framework-components/control';
import { elementCoordinates } from '@internal/framework-components/ir';

/**
 * The bare entity names the given contracts declare, unioned. The Mongo runner
 * asks this of every OTHER contract space in a multi-space apply, so each
 * space's post-apply verify can drop the extras those siblings claim.
 */
export function entityNamesDeclaredBy(contracts: ReadonlyArray<Contract>): Set<string> {
  const owned = new Set<string>();
  for (const contract of contracts) {
    for (const { entityName } of elementCoordinates(contract.storage)) {
      owned.add(entityName);
    }
  }
  return owned;
}

/**
 * True when an issue reports a whole collection present in the database but
 * declared by no contract (an extra) — its path is exactly the collection
 * name, never a deeper index/validator/options auxiliary.
 */
function extraCollectionName(issue: SchemaDiffIssue): string | undefined {
  if (issueOutcome(issue) !== 'not-expected' || issue.path.length !== 1) return undefined;
  return issue.path[0];
}

/**
 * Scope a per-space post-apply verify result to the contract space's own
 * elements: drop the `extra` findings for collections another contract space
 * claims. The runner verifies the destination contract against the full live
 * database, which holds sibling spaces' collections — without the scoping a
 * multi-space apply could never pass strict verify. Extras claimed by NO space
 * survive, so genuine drift still fails the runner's verdict.
 *
 * The result is issue-based, so the verdict recomputes directly from the
 * surviving list: `ok` holds exactly when it is empty.
 */
export function scopeVerifyResultToSpace(
  result: VerifyDatabaseSchemaResult,
  ownedByOtherSpaces: ReadonlySet<string>,
): VerifyDatabaseSchemaResult {
  if (ownedByOtherSpaces.size === 0) return result;

  const issues = result.schema.issues.filter((issue) => {
    const name = extraCollectionName(issue);
    return name === undefined || !ownedByOtherSpaces.has(name);
  });
  if (issues.length === result.schema.issues.length) return result;

  const ok = issues.length === 0;
  const { code: staleCode, ...envelope } = result;
  void staleCode;
  return {
    ...envelope,
    ok,
    ...(ok ? {} : { code: result.code ?? 'CONTRACT.MARKER_REQUIRED' }),
    summary: ok ? 'Database schema satisfies contract' : result.summary,
    schema: { ...result.schema, issues },
  };
}
