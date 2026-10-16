import type { DiffableNode, SchemaDiffIssue } from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import { issueLabel, runnerSchemaCheckWhy, schemaIssuesWhy } from '../../src/utils/schema-issues';

const node: DiffableNode = {
  id: 'default',
  nodeKind: 'sql-column-default',
  isEqualTo: () => false,
  children: () => [],
};

const explained: SchemaDiffIssue = {
  path: ['public', 'event', 'at', 'default'],
  expected: node,
  actual: node,
  explanation: { text: 'Re-emit the contract, then try again.', cause: 'expected-refused' },
};
const plain: SchemaDiffIssue = { path: ['public', 'event', 'id'], expected: node };

describe('issueLabel', () => {
  it('names the outcome and the path', () => {
    expect(
      issueLabel({ path: ['public', 'event', 'at', 'default'], expected: node, actual: node }),
    ).toBe('mismatch: public/event/at/default');
  });

  it('adds the explanation a mismatch carries', () => {
    expect(issueLabel(explained)).toBe(
      'mismatch: public/event/at/default. Re-emit the contract, then try again.',
    );
  });
});

describe('schemaIssuesWhy', () => {
  it('joins the labels after the opening without doubling a full stop', () => {
    expect(schemaIssuesWhy('The live schema differs', [explained, plain])).toBe(
      'The live schema differs: mismatch: public/event/at/default. Re-emit the contract, then try again; missing: public/event/id.',
    );
  });
});

describe('runnerSchemaCheckWhy', () => {
  const failed = (issues: unknown) => ({
    runnerErrorCode: 'MIGRATION.SCHEMA_VERIFY_FAILED',
    issues,
  });

  it('lists the issues of a failed schema check', () => {
    expect(runnerSchemaCheckWhy(failed([explained, plain]))).toBe(
      'The schema check after apply found: mismatch: public/event/at/default. Re-emit the contract, then try again; missing: public/event/id.',
    );
  });

  it('gives nothing for another runner failure', () => {
    expect(
      runnerSchemaCheckWhy({ runnerErrorCode: 'MIGRATION.PRECHECK_FAILED', issues: [plain] }),
    ).toBeUndefined();
  });

  it('gives nothing for no issues', () => {
    expect(runnerSchemaCheckWhy(failed([]))).toBeUndefined();
  });

  it.each([
    ['a path that is not text', { path: [1], expected: node }],
    ['no path', { expected: node }],
    ['neither side', { path: ['public', 'event'] }],
    ['an explanation that is text', { ...plain, explanation: 'text' }],
    [
      'an explanation whose text is not text',
      { ...plain, explanation: { text: 1, cause: 'expected-refused' } },
    ],
    ['an unknown cause', { ...plain, explanation: { text: 'text', cause: 'other' } }],
  ])('gives nothing for an issue with %s', (_, issue) => {
    expect(runnerSchemaCheckWhy(failed([plain, issue]))).toBeUndefined();
  });
});
