import type { FailedCheck } from './control-migration-types';
import { type ExpectationFailureReason, issueOutcome, type SchemaDiffIssue } from './schema-diff';

const OUTCOME_LABEL: Record<ExpectationFailureReason, string> = {
  'not-found': 'missing',
  'not-expected': 'extra',
  'not-equal': 'mismatch',
};

/** What a diff issue says: its outcome, its path, and its explanation when it has one. */
export function issueLabel(issue: SchemaDiffIssue): string {
  const label = `${OUTCOME_LABEL[issueOutcome(issue)]}: ${issue.path.join('/')}`;
  return issue.explanation === undefined ? label : `${label}. ${issue.explanation.text}`;
}

/** The issues of a failed schema check, as one sentence after `opening`. */
export function schemaIssuesWhy(opening: string, issues: readonly SchemaDiffIssue[]): string {
  const labels = issues.map((issue) => issueLabel(issue).replace(/\.$/, ''));
  return `${opening}: ${labels.join('; ')}.`;
}

/** The why of a failed schema check after apply, listing its issues when it found any. */
export function schemaCheckWhy(issues: readonly SchemaDiffIssue[]): string {
  return issues.length === 0
    ? 'The resulting database schema does not satisfy the destination contract.'
    : schemaIssuesWhy('The schema check after apply found', issues);
}

/** What a failed check before an operation means: the operation, the check description as written, and what the check's expectation says of the database when it has one. */
export function failedPrecheckWhy(check: FailedCheck): string {
  const checked = `Before operation ${check.operationId} runs, it checks: ${check.description}.`;
  const { expectation } = check;
  if (expectation === undefined) return `${checked} That check failed on this database.`;
  return expectation.expects === 'absent'
    ? `${checked} That check failed: the database already has ${expectation.object}.`
    : `${checked} That check failed: the database has no ${expectation.object}.`;
}

/** What a failed check after an operation means: the operation, the check description as written, and what the check's expectation says of the database when it has one. */
export function failedPostcheckWhy(check: FailedCheck): string {
  const checked = `After operation ${check.operationId} ran, it checks: ${check.description}.`;
  const { expectation } = check;
  if (expectation === undefined) return `${checked} That check failed on this database.`;
  return expectation.expects === 'absent'
    ? `${checked} That check failed: the database still has ${expectation.object}.`
    : `${checked} That check failed: the database has no ${expectation.object}.`;
}
