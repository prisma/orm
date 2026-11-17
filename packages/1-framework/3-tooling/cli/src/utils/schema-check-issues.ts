import type {
  MigrationRunnerFailure,
  SchemaDiffIssue,
} from '@internal/framework-components/control';

/** The issues a failed schema check after apply reported; a check that reported none counts as none. */
export function schemaCheckIssues(
  failure: MigrationRunnerFailure,
): readonly SchemaDiffIssue[] | undefined {
  const issues = failure.meta.schemaIssues;
  return issues === undefined || issues.length === 0 ? undefined : issues;
}
