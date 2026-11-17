import {
  type DiffableNode,
  migrationRunnerFailure,
  type SchemaDiffIssue,
} from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import { schemaCheckIssues } from '../../src/utils/schema-check-issues';

const node: DiffableNode = {
  id: 'id',
  nodeKind: 'sql-column',
  isEqualTo: () => false,
  children: () => [],
};
const issue: SchemaDiffIssue = { path: ['public', 'event', 'id'], expected: node };

describe('schemaCheckIssues', () => {
  it('reads the issues from meta, and counts an empty list or none as no issues', () => {
    const failed = (schemaIssues: readonly SchemaDiffIssue[] | undefined) =>
      migrationRunnerFailure('MIGRATION.SCHEMA_VERIFY_FAILED', 'Schema differs', {
        meta: schemaIssues === undefined ? {} : { schemaIssues },
      });
    expect([failed([issue]), failed([]), failed(undefined)].map(schemaCheckIssues)).toEqual([
      [issue],
      undefined,
      undefined,
    ]);
  });
});
