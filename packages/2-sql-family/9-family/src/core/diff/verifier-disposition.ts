import type { ControlPolicy } from '@internal/contract/types';
import type {
  SchemaDiffIssue,
  VerifierIssueCategory,
  VerifierOutcome,
} from '@internal/framework-components/control';
import { dispositionForCategory, issueOutcome } from '@internal/framework-components/control';

/**
 * Classifies a codec `verifyType` hook finding into the target-neutral
 * categories the framework grades. A storage type is a named type instance
 * (e.g. a native enum); the only shape divergence it can carry is a change
 * to its value set, so a paired mismatch always classifies as `valueDrift`.
 */
export function classifyStorageTypeDiffIssue(issue: SchemaDiffIssue): VerifierIssueCategory {
  if (issueOutcome(issue) === 'not-found') {
    return 'declaredMissing';
  }
  if (issueOutcome(issue) === 'not-expected') {
    return 'extraAuxiliary';
  }
  return 'valueDrift';
}

export function verifierDisposition(
  controlPolicy: ControlPolicy,
  issue: SchemaDiffIssue,
): VerifierOutcome {
  return dispositionForCategory(controlPolicy, classifyStorageTypeDiffIssue(issue));
}
