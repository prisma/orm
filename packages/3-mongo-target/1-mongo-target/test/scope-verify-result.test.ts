import type { Contract } from '@internal/contract/types';
import type {
  SchemaDiffIssue,
  VerifyDatabaseSchemaResult,
} from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import {
  entityNamesDeclaredBy,
  scopeVerifyResultToSpace,
} from '../src/core/migrations/scope-verify-result';

const NODE = { id: 'x', nodeKind: 'mongo-collection', isEqualTo: () => true, children: () => [] };
/** An extra (live-only) finding — a drop, by presence. */
const extra = (path: readonly string[]): SchemaDiffIssue => ({ path, actual: NODE });
/** A missing (declared-only) finding — a create, by presence. */
const missing = (path: readonly string[]): SchemaDiffIssue => ({ path, expected: NODE });

function makeContract(collections: readonly string[]): Contract {
  const entries: Record<string, Record<string, unknown>> = {
    collection: Object.fromEntries(collections.map((name) => [name, {}])),
  };
  return {
    storage: { namespaces: { mongo: { id: 'mongo', entries } } },
  } as unknown as Contract;
}

function makeResult(args: {
  ok: boolean;
  issues: readonly SchemaDiffIssue[];
}): VerifyDatabaseSchemaResult {
  return {
    ok: args.ok,
    ...(args.ok ? {} : { code: 'CONTRACT.MARKER_REQUIRED' }),
    summary: args.ok ? 'Database schema satisfies contract' : 'does not satisfy',
    contract: { storageHash: 'x' },
    target: { expected: 'mongo' },
    schema: { issues: args.issues },
    timings: { total: 0 },
  };
}

describe('entityNamesDeclaredBy', () => {
  it('unions entity names across the given contracts', () => {
    const names = entityNamesDeclaredBy([
      makeContract(['cipher_state']),
      makeContract(['audit_log', 'cipher_state']),
    ]);
    expect([...names].sort()).toEqual(['audit_log', 'cipher_state']);
  });
});

describe('scopeVerifyResultToSpace', () => {
  it('returns the input unchanged when no names are owned by other spaces', () => {
    const result = makeResult({ ok: true, issues: [] });
    expect(scopeVerifyResultToSpace(result, new Set())).toBe(result);
  });

  it('returns the input unchanged when a non-empty owned set drops nothing', () => {
    const result = makeResult({ ok: true, issues: [] });
    expect(scopeVerifyResultToSpace(result, new Set(['cipher_state']))).toBe(result);
  });

  it('drops a sibling space’s extra collection, keeps the undeclared extra, and stays failing', () => {
    const result = makeResult({
      ok: false,
      issues: [extra(['cipher_state']), extra(['junk'])],
    });

    const scoped = scopeVerifyResultToSpace(result, new Set(['cipher_state']));

    // The sibling's collection is dropped; the truly undeclared `junk` stays,
    // so the runner still fails on genuine drift.
    expect(scoped.schema.issues).toEqual([expect.objectContaining({ path: ['junk'] })]);
    expect(scoped.ok).toBe(false);
    expect(scoped.code).toBe('CONTRACT.MARKER_REQUIRED');
  });

  it('flips ok to true when the only failures were sibling collections', () => {
    const result = makeResult({
      ok: false,
      issues: [extra(['cipher_state'])],
    });

    const scoped = scopeVerifyResultToSpace(result, new Set(['cipher_state']));

    expect(scoped.ok).toBe(true);
    expect(scoped.summary).toBe('Database schema satisfies contract');
    expect(scoped.schema.issues).toEqual([]);
  });

  it('never drops a non-extra issue even when its table name matches a sibling', () => {
    // Only whole-collection `not-expected` issues are droppable — a genuine
    // drift finding (e.g. a missing column) on a table that happens to share
    // a name with a sibling-owned collection must survive, so the space
    // still fails on its own drift.
    const result = makeResult({
      ok: false,
      issues: [missing(['cipher_state', 'column:ssn'])],
    });

    const scoped = scopeVerifyResultToSpace(result, new Set(['cipher_state']));

    expect(scoped).toBe(result);
    expect(scoped.ok).toBe(false);
  });

  it('never drops a nested (auxiliary-depth) not-expected issue, even under a sibling-named collection', () => {
    // A nested extra (e.g. an extra index) only ever appears on a collection
    // THIS space's own contract declares — Mongo's diff only descends into
    // index/validator/options comparisons when both sides declare the
    // collection, so a whole-collection extra never carries children. The
    // depth check is what protects a same-named nested finding from ever
    // being mistaken for the sibling's whole-collection extra.
    const result = makeResult({
      ok: false,
      issues: [extra(['cipher_state', 'index:secret:1']), missing(['user', 'column:email'])],
    });

    const scoped = scopeVerifyResultToSpace(result, new Set(['cipher_state']));

    expect(scoped).toBe(result);
    expect(scoped.ok).toBe(false);
  });
});
