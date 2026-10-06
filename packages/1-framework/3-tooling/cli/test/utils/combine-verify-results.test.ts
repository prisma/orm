import {
  type SchemaDiffIssue,
  VERIFY_CODE_SCHEMA_FAILURE,
  type VerifyDatabaseSchemaResult,
} from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import { combineVerifyResults } from '../../src/utils/combine-verify-results';

function makeResult(overrides: {
  spaceId: string;
  ok: boolean;
  summary: string;
  issues?: readonly SchemaDiffIssue[];
}): VerifyDatabaseSchemaResult {
  const defaultIssues: readonly SchemaDiffIssue[] = overrides.ok
    ? []
    : [{ path: [overrides.spaceId] }];
  const result: VerifyDatabaseSchemaResult = {
    ok: overrides.ok,
    summary: overrides.summary,
    contract: { storageHash: `${overrides.spaceId}-storage` },
    target: { expected: 'postgres' },
    schema: {
      issues: overrides.issues ?? defaultIssues,
    },
    timings: { total: 0 },
  };
  if (!overrides.ok) {
    return { ...result, code: VERIFY_CODE_SCHEMA_FAILURE };
  }
  return result;
}

describe('combineVerifyResults', () => {
  it('preserves the per-family summary when every space passes', () => {
    const perSpace = new Map<string, VerifyDatabaseSchemaResult>([
      [
        'app',
        makeResult({ spaceId: 'app', ok: true, summary: 'Database schema satisfies contract' }),
      ],
      ['cipher', makeResult({ spaceId: 'cipher', ok: true, summary: 'Schema matches contract' })],
    ]);

    const combined = combineVerifyResults(perSpace, 'app', false, []);

    expect(combined.result).toMatchObject({
      ok: true,
      summary: 'Database schema satisfies contract',
    });
    expect(combined.result.schema).toEqual({
      issues: [],
      warnings: { issues: [] },
    });
    expect(combined.unclaimed).toEqual([]);
  });

  it('preserves the per-family failure summary when every space fails', () => {
    const perSpace = new Map<string, VerifyDatabaseSchemaResult>([
      [
        'app',
        makeResult({
          spaceId: 'app',
          ok: false,
          summary: 'Database schema does not satisfy contract (1 failure)',
        }),
      ],
    ]);

    const combined = combineVerifyResults(perSpace, 'app', false, []);

    expect(combined.result).toMatchObject({
      ok: false,
      summary: 'Database schema does not satisfy contract (1 failure)',
    });
    expect(combined.result.schema.issues).toHaveLength(1);
  });

  it('falls back to the failing space summary when the app passes but an extension fails', () => {
    const perSpace = new Map<string, VerifyDatabaseSchemaResult>([
      [
        'app',
        makeResult({ spaceId: 'app', ok: true, summary: 'Database schema satisfies contract' }),
      ],
      [
        'cipher',
        makeResult({
          spaceId: 'cipher',
          ok: false,
          summary: 'Database schema does not satisfy contract (1 failure)',
        }),
      ],
    ]);

    const combined = combineVerifyResults(perSpace, 'app', false, []);

    expect(combined.result).toMatchObject({
      ok: false,
      summary: 'Database schema does not satisfy contract (1 failure)',
      code: VERIFY_CODE_SCHEMA_FAILURE,
    });
    expect(combined.result.schema.issues).toHaveLength(1);
  });

  it('keeps the failing extension space code when the app passes', () => {
    const perSpace = new Map<string, VerifyDatabaseSchemaResult>([
      ['app', makeResult({ spaceId: 'app', ok: true, summary: 'Schema matches contract' })],
      [
        'cipher',
        {
          ...makeResult({ spaceId: 'cipher', ok: false, summary: 'cipher failure' }),
          code: 'CONTRACT.EXTENSION_DRIFT',
        },
      ],
    ]);

    const combined = combineVerifyResults(perSpace, 'app', false, []);

    expect(combined.result.code).toBe('CONTRACT.EXTENSION_DRIFT');
  });

  it('keeps the app space code when the app and an extension both fail', () => {
    const perSpace = new Map<string, VerifyDatabaseSchemaResult>([
      [
        'cipher',
        {
          ...makeResult({ spaceId: 'cipher', ok: false, summary: 'cipher failure' }),
          code: 'CONTRACT.EXTENSION_DRIFT',
        },
      ],
      [
        'app',
        {
          ...makeResult({ spaceId: 'app', ok: false, summary: 'app failure' }),
          code: 'CONTRACT.APP_DRIFT',
        },
      ],
    ]);

    const combined = combineVerifyResults(perSpace, 'app', false, []);

    expect(combined.result.code).toBe('CONTRACT.APP_DRIFT');
  });

  it('returns a non-`ok` envelope when any space fails, even when the app passes', () => {
    const perSpace = new Map<string, VerifyDatabaseSchemaResult>([
      ['app', makeResult({ spaceId: 'app', ok: true, summary: 'Schema matches contract' })],
      [
        'cipher',
        makeResult({
          spaceId: 'cipher',
          ok: false,
          summary: 'Schema verification found 2 issue(s)',
          issues: [{ path: ['a'] }, { path: ['b'] }],
        }),
      ],
    ]);

    const combined = combineVerifyResults(perSpace, 'app', true, []);

    expect(combined.result.ok).toBe(false);
    expect(combined.result.summary).not.toContain('matches contract');
    expect(combined.result.schema.issues).toHaveLength(2);
    expect(combined.result.meta?.strict).toBe(true);
  });

  it('fails the verdict in strict mode with the schema-verification code when the unclaimed list is non-empty', () => {
    const perSpace = new Map<string, VerifyDatabaseSchemaResult>([
      [
        'app',
        makeResult({ spaceId: 'app', ok: true, summary: 'Database schema satisfies contract' }),
      ],
    ]);

    const combined = combineVerifyResults(perSpace, 'app', true, ['legacy_events']);

    expect(combined.result.ok).toBe(false);
    expect(combined.result.summary).toContain('1 unclaimed element');
    expect(combined.result.code).toBe(VERIFY_CODE_SCHEMA_FAILURE);
    expect(combined.unclaimed).toEqual(['legacy_events']);
  });

  it('keeps the verdict `ok` in lenient mode when the unclaimed list is non-empty', () => {
    const perSpace = new Map<string, VerifyDatabaseSchemaResult>([
      [
        'app',
        makeResult({ spaceId: 'app', ok: true, summary: 'Database schema satisfies contract' }),
      ],
    ]);

    const combined = combineVerifyResults(perSpace, 'app', false, ['legacy_events', 'old_audit']);

    expect(combined.result.ok).toBe(true);
    expect(combined.result.summary).toBe('Database schema satisfies contract');
    expect(combined.unclaimed).toEqual(['legacy_events', 'old_audit']);
  });

  it('throws a wiring-bug error when the per-space map is empty', () => {
    const empty = new Map<string, VerifyDatabaseSchemaResult>();
    expect(() => combineVerifyResults(empty, 'app', false, [])).toThrow(/wiring bug/);
  });

  it('falls back to the first iterator value when the app id is absent from the per-space map', () => {
    const perSpace = new Map<string, VerifyDatabaseSchemaResult>([
      ['cipher', makeResult({ spaceId: 'cipher', ok: true, summary: 'Schema matches contract' })],
    ]);

    const combined = combineVerifyResults(perSpace, 'app', false, []);

    expect(combined.result).toMatchObject({
      ok: true,
      summary: 'Schema matches contract',
      contract: { storageHash: 'cipher-storage' },
    });
  });

  it('keeps the first failure summary when multiple spaces fail', () => {
    const perSpace = new Map<string, VerifyDatabaseSchemaResult>([
      [
        'app',
        makeResult({ spaceId: 'app', ok: true, summary: 'Database schema satisfies contract' }),
      ],
      ['cipher', makeResult({ spaceId: 'cipher', ok: false, summary: 'cipher failure' })],
      ['pgvector', makeResult({ spaceId: 'pgvector', ok: false, summary: 'pgvector failure' })],
    ]);

    const combined = combineVerifyResults(perSpace, 'app', false, []);

    expect(combined.result).toMatchObject({
      ok: false,
      summary: 'cipher failure',
    });
    expect(combined.result.schema.issues).toHaveLength(2);
  });

  it('uses the schema-verification code when a failing app result carries no code', () => {
    const failingWithoutCode: VerifyDatabaseSchemaResult = makeResult({
      spaceId: 'app',
      ok: false,
      summary: 'Database schema does not satisfy contract (1 failure)',
    });
    const stripped = { ...failingWithoutCode };
    delete stripped.code;
    const perSpace = new Map<string, VerifyDatabaseSchemaResult>([['app', stripped]]);

    const combined = combineVerifyResults(perSpace, 'app', false, []);

    expect(combined.result).toMatchObject({
      ok: false,
      code: VERIFY_CODE_SCHEMA_FAILURE,
    });
  });

  it('concatenates issues from all spaces into the combined result', () => {
    const appDiffIssue: SchemaDiffIssue = {
      path: ['public', 'profiles', 'policy_app_abc'],
    };
    const extDiffIssue: SchemaDiffIssue = {
      path: ['public', 'audit_log', 'policy_cipher_def'],
    };

    const perSpace = new Map<string, VerifyDatabaseSchemaResult>([
      [
        'app',
        makeResult({
          spaceId: 'app',
          ok: true,
          summary: 'Database schema satisfies contract',
          issues: [appDiffIssue],
        }),
      ],
      [
        'cipher',
        makeResult({
          spaceId: 'cipher',
          ok: true,
          summary: 'Schema matches contract',
          issues: [extDiffIssue],
        }),
      ],
    ]);

    const combined = combineVerifyResults(perSpace, 'app', false, []);

    expect(combined.result.schema.issues).toEqual([appDiffIssue, extDiffIssue]);
  });
});
