import type {
  ExpectationFailureReason,
  MismatchCause,
  SchemaDiffIssue,
} from '@internal/framework-components/control';
import { issueOutcome } from '@internal/framework-components/control';

const OUTCOME_LABEL: Record<ExpectationFailureReason, string> = {
  'not-found': 'missing',
  'not-expected': 'extra',
  'not-equal': 'mismatch',
};

const MISMATCH_CAUSES: Record<MismatchCause, true> = {
  'expected-refused': true,
  'possibly-equivalent': true,
};

/** What a diff issue says, in the words the commander shell used. */
export function issueLabel(issue: SchemaDiffIssue): string {
  const label = `${OUTCOME_LABEL[issueOutcome(issue)]}: ${issue.path.join('/')}`;
  return issue.explanation === undefined ? label : `${label}. ${issue.explanation.text}`;
}

/** The issues of a failed schema check, as one sentence for a diagnostic's why, after `opening`. */
export function schemaIssuesWhy(opening: string, issues: readonly SchemaDiffIssue[]): string {
  const labels = issues.map((issue) => issueLabel(issue).replace(/\.$/, ''));
  return `${opening}: ${labels.join('; ')}.`;
}

/**
 * The issues a runner failure of its schema check after apply carries in its meta, or `undefined`
 * for another failure, or when the meta holds no issue the CLI can read.
 */
export function runnerSchemaIssues(
  meta: Record<string, unknown> | undefined,
): readonly SchemaDiffIssue[] | undefined {
  if (meta?.['runnerErrorCode'] !== 'MIGRATION.SCHEMA_VERIFY_FAILED') return undefined;
  const issues = meta['issues'];
  return Array.isArray(issues) && issues.length > 0 && issues.every(isSchemaDiffIssue)
    ? issues
    : undefined;
}

/** The why of a runner failure of its schema check after apply, listing the issues as `db verify` does. */
export function runnerSchemaCheckWhy(
  meta: Record<string, unknown> | undefined,
): string | undefined {
  const issues = runnerSchemaIssues(meta);
  return issues === undefined
    ? undefined
    : schemaIssuesWhy('The schema check after apply found', issues);
}

function isSchemaDiffIssue(value: unknown): value is SchemaDiffIssue {
  if (typeof value !== 'object' || value === null) return false;
  if (!('path' in value) || !Array.isArray(value.path)) return false;
  if (!value.path.every((step) => typeof step === 'string')) return false;
  const expected = 'expected' in value ? value.expected : undefined;
  const actual = 'actual' in value ? value.actual : undefined;
  if (expected === undefined && actual === undefined) return false;
  return !('explanation' in value) || isMismatchExplanation(value.explanation);
}

function isMismatchExplanation(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'text' in value &&
    typeof value.text === 'string' &&
    'cause' in value &&
    typeof value.cause === 'string' &&
    Object.hasOwn(MISMATCH_CAUSES, value.cause)
  );
}
