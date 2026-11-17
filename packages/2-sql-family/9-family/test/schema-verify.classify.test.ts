import type {
  DiffableNode,
  DiffSubjectGranularity,
  ExpectationFailureReason,
} from '@internal/framework-components/control';
import {
  SqlCheckConstraintIR,
  SqlColumnIR,
  SqlIndexIR,
  SqlTableIR,
} from '@internal/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { classifySqlDiffIssue, computeSqlDiffVerdict } from '../src/core/diff/schema-verify';

/**
 * Classification and strict gating key on the granularity a `granularityOf`
 * classifier resolves from the issue's node `nodeKind` — never on a
 * `nodeKind` naming convention and never on anything stamped on the issue or
 * the node. Each fixture's classifier ignores the real node kind and returns
 * whatever granularity the test wants to exercise, decoupling "which
 * granularity classifies as what" from "which real node maps to which
 * granularity" (pinned separately by the relational/Postgres node-kind maps).
 */
const table = new SqlTableIR({ name: 't', columns: {}, foreignKeys: [], uniques: [], indexes: [] });
const column = new SqlColumnIR({ name: 'c', typeText: 'int4', nullable: false });
const index = new SqlIndexIR({
  naming: { kind: 'exact', name: 't_c_idx' },
  columns: ['c'],
  where: undefined,
  unique: false,
  partial: false,
  type: undefined,
  options: undefined,
  annotations: undefined,
  dependsOn: undefined,
});
const check = new SqlCheckConstraintIR({
  naming: { kind: 'exact', name: 'chk' },
  expression: `"c" IN ('a')`,
  dependsOn: undefined,
});

function issueOf(change: ExpectationFailureReason, node: DiffableNode) {
  return {
    path: ['database', node.id],
    ...(change !== 'not-expected' ? { expected: node } : {}),
    ...(change !== 'not-found' ? { actual: node } : {}),
  };
}

/** A `granularityOf` classifier that always resolves to `granularity`, regardless of `nodeKind`. */
function fixedGranularity(
  granularity: DiffSubjectGranularity,
): (nodeKind: string) => DiffSubjectGranularity {
  return () => granularity;
}

describe('classifySqlDiffIssue keys on subject granularity', () => {
  it('not-found is declaredMissing for every granularity', () => {
    expect(classifySqlDiffIssue(issueOf('not-found', table), fixedGranularity('entity'))).toBe(
      'declaredMissing',
    );
    expect(classifySqlDiffIssue(issueOf('not-found', index), fixedGranularity('auxiliary'))).toBe(
      'declaredMissing',
    );
    expect(classifySqlDiffIssue(issueOf('not-found', table), fixedGranularity('namespace'))).toBe(
      'declaredMissing',
    );
  });

  it.each([
    ['entity granularity', 'entity', 'extraTopLevelObject'],
    ['namespace granularity', 'namespace', 'extraTopLevelObject'],
    ['field granularity', 'field', 'extraNestedElement'],
    ['auxiliary granularity', 'auxiliary', 'extraAuxiliary'],
    ['structural granularity', 'structural', 'extraAuxiliary'],
  ] as const)('not-expected with %s classifies as %s', (_label, granularity, category) => {
    expect(
      classifySqlDiffIssue(issueOf('not-expected', table), fixedGranularity(granularity)),
    ).toBe(category);
  });

  it('not-equal on a check node is declaredIncompatible, like every other paired divergence', () => {
    expect(classifySqlDiffIssue(issueOf('not-equal', check), fixedGranularity('auxiliary'))).toBe(
      'declaredIncompatible',
    );
    expect(classifySqlDiffIssue(issueOf('not-equal', column), fixedGranularity('field'))).toBe(
      'declaredIncompatible',
    );
  });
});

describe('strict gating keys on subject granularity', () => {
  function verdictFor(granularity: DiffSubjectGranularity, strict: boolean) {
    return computeSqlDiffVerdict({
      issues: [issueOf('not-expected', table)],
      resolveControlPolicy: () => undefined,
      strict,
      defaultControlPolicy: undefined,
      granularityOf: fixedGranularity(granularity),
    });
  }

  it.each([['namespace'], ['entity'], ['field'], ['auxiliary']] as const)(
    'a not-expected %s extra is strict-only',
    (granularity) => {
      expect(verdictFor(granularity, true).failures).toHaveLength(1);
      expect(verdictFor(granularity, false).failures).toHaveLength(0);
    },
  );

  it('a not-expected structural extra fails in both modes', () => {
    expect(verdictFor('structural', true).failures).toHaveLength(1);
    expect(verdictFor('structural', false).failures).toHaveLength(1);
  });
});
