import {
  type DiffableNode,
  type DiffSubjectGranularity,
  type SchemaDiffIssue,
  VERIFY_CODE_SCHEMA_FAILURE,
  type VerifyDatabaseSchemaResult,
} from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { ifDefined } from '@internal/utils/defined';
import { describe, expect, it } from 'vitest';
import type {
  SchemaEntityKindClassifier,
  SchemaSubjectClassifier,
} from '../../src/aggregate/unclaimed-elements';
import {
  collectExtraElementCoordinates,
  stripExtraFindings,
  UNCLASSIFIED_ENTITY_KIND,
} from '../../src/aggregate/unclaimed-elements';

/**
 * A minimal diff node carrying a fake `kind` discriminator — the strip never
 * reads it directly, only via the injected `classify` capability below,
 * mirroring how a real family/target classifier resolves granularity from a
 * node's `nodeKind`.
 */
function diffNode(id: string, kind?: string): DiffableNode & { readonly kind?: string } {
  return {
    id,
    nodeKind: kind ?? 'unclassified',
    isEqualTo: () => true,
    children: () => [],
    ...ifDefined('kind', kind),
  };
}

/** A fake classifier keyed on the fixture nodes' `kind`, standing in for a real family/target one. */
const classify: SchemaSubjectClassifier = (issue) => {
  const node = issue.actual ?? issue.expected;
  const kind = (node as { readonly kind?: string } | undefined)?.kind;
  const granularity: Readonly<Record<string, DiffSubjectGranularity>> = {
    table: 'entity',
    column: 'field',
    policy: 'structural',
  };
  return kind !== undefined ? granularity[kind] : undefined;
};

/** A fake entity-kind classifier keyed on the fixture nodes' `kind`, sibling of `classify` above. */
const classifyEntityKind: SchemaEntityKindClassifier = (issue) => {
  const node = issue.actual ?? issue.expected;
  const kind = (node as { readonly kind?: string } | undefined)?.kind;
  return kind === 'table' ? 'table' : undefined;
};

function extraTableIssue(name: string): SchemaDiffIssue {
  return {
    path: ['database', 'public', name],
    actual: diffNode(name, 'table'),
  };
}

function extraColumnIssueUnder(tableName: string, columnName: string): SchemaDiffIssue {
  return {
    path: ['database', 'public', tableName, `column:${columnName}`],
    actual: diffNode(`column:${columnName}`, 'column'),
  };
}

function extraPolicyIssue(tableName: string, policyName: string): SchemaDiffIssue {
  return {
    path: ['database', 'public', tableName, policyName],
    actual: diffNode(policyName, 'policy'),
  };
}

/** A document-family extra-collection issue: no classifiable kind, path is the bare name. */
function extraCollectionIssue(name: string): SchemaDiffIssue {
  return {
    path: [name],
    actual: diffNode(name),
  };
}

function makeResult(args: {
  ok: boolean;
  issues?: VerifyDatabaseSchemaResult['schema']['issues'];
}): VerifyDatabaseSchemaResult {
  return {
    ok: args.ok,
    ...(args.ok ? {} : { code: VERIFY_CODE_SCHEMA_FAILURE }),
    summary: args.ok ? 'Database schema satisfies contract' : 'does not satisfy',
    contract: { storageHash: 'x' },
    target: { expected: 'postgres' },
    schema: {
      issues: args.issues ?? [],
    },
    timings: { total: 0 },
  };
}

describe('stripExtraFindings', () => {
  it('returns the result unchanged when there are no extras', () => {
    const result = makeResult({ ok: true });
    expect(stripExtraFindings(result, classify)).toBe(result);
  });

  it('strict extras-only failure passes after the strip (table + its descendants dropped)', () => {
    const result = makeResult({
      ok: false,
      issues: [extraTableIssue('legacy'), extraColumnIssueUnder('legacy', 'id')],
    });

    const stripped = stripExtraFindings(result, classify);

    expect(stripped.schema.issues).toEqual([]);
    expect(stripped.ok).toBe(true);
    expect(stripped.summary).toBe('Database schema satisfies contract');
  });

  it('a Mongo-shape extra collection issue is stripped the same way (no classifier injected)', () => {
    const result = makeResult({
      ok: false,
      issues: [extraCollectionIssue('a'), extraCollectionIssue('b')],
    });

    const stripped = stripExtraFindings(result);

    expect(stripped.schema.issues).toEqual([]);
    expect(stripped.ok).toBe(true);
  });

  it('a real missing/mismatch failure survives the strip', () => {
    const missingColumn: SchemaDiffIssue = {
      path: ['database', 'public', 'user', 'column:email'],
      expected: diffNode('column:email', 'column'),
    };
    const result = makeResult({
      ok: false,
      issues: [missingColumn, extraTableIssue('legacy')],
    });

    const stripped = stripExtraFindings(result, classify);

    expect(stripped.ok).toBe(false);
    expect(stripped.schema.issues).toEqual([missingColumn]);
  });

  it('reports a surviving failure that carried no code under the schema-verification code', () => {
    const missingColumn: SchemaDiffIssue = {
      path: ['database', 'public', 'user', 'column:email'],
      expected: diffNode('column:email', 'column'),
    };
    const { code: _code, ...withoutCode } = makeResult({
      ok: false,
      issues: [missingColumn, extraTableIssue('legacy')],
    });

    const stripped = stripExtraFindings(withoutCode, classify);

    expect(stripped).toMatchObject({ ok: false, code: VERIFY_CODE_SCHEMA_FAILURE });
  });

  it('keeps an extra column on a declared table as the space’s own drift', () => {
    // The extra column's path is not under any dropped table, so it stays and
    // the verdict stays consistent with the surviving evidence.
    const result = makeResult({
      ok: false,
      issues: [extraColumnIssueUnder('user', 'stale')],
    });

    const stripped = stripExtraFindings(result, classify);

    expect(stripped).toBe(result);
    expect(stripped.ok).toBe(false);
  });

  it('keeps failing on an extra RLS policy when a sibling extra table is dropped', () => {
    // The policy is structural: it survives the strip even though its subject
    // sits under the space's own table, so live policy drift never false-passes.
    const policyIssue = extraPolicyIssue('user', 'policy_rogue');
    const result = makeResult({
      ok: false,
      issues: [extraTableIssue('cipher_state'), policyIssue],
    });

    const stripped = stripExtraFindings(result, classify);

    expect(stripped.schema.issues).toEqual([policyIssue]);
    expect(stripped.ok).toBe(false);
  });

  it('a structural policy extra under a DROPPED stray table still survives the strip', () => {
    const policyIssue = extraPolicyIssue('cipher_state', 'policy_rogue');
    const result = makeResult({
      ok: false,
      issues: [
        extraTableIssue('cipher_state'),
        extraColumnIssueUnder('cipher_state', 'id'),
        policyIssue,
      ],
    });

    const stripped = stripExtraFindings(result, classify);

    expect(stripped.schema.issues).toEqual([policyIssue]);
    expect(stripped.ok).toBe(false);
  });

  it('keeps an extra-policy issue as the space’s own drift (nothing else stripped)', () => {
    const result = makeResult({
      ok: false,
      issues: [extraPolicyIssue('user', 'policy_rogue')],
    });

    const stripped = stripExtraFindings(result, classify);

    expect(stripped).toBe(result);
    expect(stripped.schema.issues).toHaveLength(1);
    expect(stripped.ok).toBe(false);
  });
});

describe('collectExtraElementCoordinates', () => {
  it('gathers extra coordinates from whole-table-role nodes and Mongo-shape whole-collection issues', () => {
    const result = makeResult({
      ok: false,
      issues: [
        extraTableIssue('stray'),
        extraCollectionIssue('legacy'),
        extraPolicyIssue('audit', 'p'),
      ],
    });

    const coordinates = [
      ...collectExtraElementCoordinates(result, classify, classifyEntityKind),
    ].sort((a, b) => a.entityName.localeCompare(b.entityName));
    expect(coordinates).toEqual([
      {
        namespaceId: UNBOUND_NAMESPACE_ID,
        entityKind: UNCLASSIFIED_ENTITY_KIND,
        entityName: 'legacy',
      },
      { namespaceId: 'public', entityKind: 'table', entityName: 'stray' },
    ]);
  });

  it('does not conflate the same bare name declared in two different namespaces', () => {
    const result = makeResult({
      ok: false,
      issues: [
        extraTableIssue('orphan_table'),
        {
          path: ['database', 'tenant_b', 'orphan_table'],
          actual: diffNode('orphan_table', 'table'),
        },
      ],
    });

    const coordinates = [
      ...collectExtraElementCoordinates(result, classify, classifyEntityKind),
    ].sort((a, b) => a.namespaceId.localeCompare(b.namespaceId));
    expect(coordinates).toEqual([
      { namespaceId: 'public', entityKind: 'table', entityName: 'orphan_table' },
      { namespaceId: 'tenant_b', entityKind: 'table', entityName: 'orphan_table' },
    ]);
  });

  it('falls back to the unclassified placeholder when no entity-kind classifier is injected', () => {
    const result = makeResult({
      ok: false,
      issues: [extraTableIssue('stray')],
    });

    const coordinates = [...collectExtraElementCoordinates(result, classify)];
    expect(coordinates).toEqual([
      { namespaceId: 'public', entityKind: UNCLASSIFIED_ENTITY_KIND, entityName: 'stray' },
    ]);
  });
});
