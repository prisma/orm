import type { AuthoringWarning } from '@internal/framework-components/authoring';
import { flushAuthoringWarnings } from '@internal/framework-components/authoring';
import { computeIndexContentHash, nameOf } from '@internal/sql-schema-ir/naming';
import { describe, expect, it, vi } from 'vitest';
import {
  type AuthoredIndexInput,
  exactNameBodyWarning,
  lowerAuthoredIndex as lowerAuthoredIndexStrict,
} from '../src/index-naming';

type LooseAuthoredIndexInput = {
  readonly columns?: readonly string[];
  readonly expression?: string;
  readonly where?: string;
  readonly unique?: boolean;
  readonly map?: string;
  readonly name?: string;
  readonly type?: string;
  readonly options?: Record<string, unknown>;
};

function lowerAuthoredIndex(
  tableName: string,
  authored: LooseAuthoredIndexInput,
  warnings?: { push(warning: AuthoringWarning): void },
) {
  return lowerAuthoredIndexStrict(tableName, authored as AuthoredIndexInput, warnings);
}

function captureWarnings(run: () => void) {
  const emitWarning = vi.spyOn(process, 'emitWarning').mockImplementation(() => {});
  try {
    run();
    return emitWarning.mock.calls.map(([message, options]) => ({
      message: String(message),
      options,
    }));
  } finally {
    emitWarning.mockRestore();
  }
}

describe('lowerAuthoredIndex — matrix threading', () => {
  it('fields-only wire names are unchanged (regression pin)', () => {
    expect(lowerAuthoredIndex('user', { columns: ['email'] })).toEqual({
      naming: { kind: 'wire', prefix: 'user_email_idx', hash: '46df9cad' },
      columns: ['email'],
      unique: false,
    });
  });

  it('threads an expression into the carried node and the hash tuple', () => {
    const lowered = lowerAuthoredIndex('user', {
      expression: 'lower(email)',
      name: 'users_email_eq',
    });
    expect(lowered).toEqual({
      naming: { kind: 'wire', prefix: 'users_email_eq', hash: '17273133' },
      expression: 'lower(email)',
      unique: false,
    });
    // Cross-check against the naming module's own hash.
    const hash = computeIndexContentHash({ expression: 'lower(email)', unique: false });
    expect(nameOf(lowered.naming)).toBe(`users_email_eq_${hash}`);
  });

  it('threads where into the carried node and the hash tuple', () => {
    const lowered = lowerAuthoredIndex('user', {
      columns: ['email'],
      where: '(deleted_at IS NULL)',
    });
    expect(lowered).toEqual({
      naming: { kind: 'wire', prefix: 'user_email_idx', hash: '77bde254' },
      columns: ['email'],
      where: '(deleted_at IS NULL)',
      unique: false,
    });
    const hash = computeIndexContentHash({
      columns: ['email'],
      where: '(deleted_at IS NULL)',
      unique: false,
    });
    expect(nameOf(lowered.naming)).toBe(`user_email_idx_${hash}`);
  });

  it('threads unique into the carried node and the hash tuple', () => {
    const lowered = lowerAuthoredIndex('user', { columns: ['email'], unique: true });
    expect(lowered).toEqual({
      naming: { kind: 'wire', prefix: 'user_email_idx', hash: '34912d96' },
      columns: ['email'],
      unique: true,
    });
    const hash = computeIndexContentHash({ columns: ['email'], unique: true });
    expect(nameOf(lowered.naming)).toBe(`user_email_idx_${hash}`);
  });

  it('threads the full matrix (expression + where + unique + type) under an exact map name', () => {
    const lowered = captureAndReturn(() =>
      lowerAuthoredIndex('user', {
        expression: 'eql_v3.eq_term(email)',
        where: '(deleted_at IS NULL)',
        unique: true,
        type: 'btree',
        map: 'users_email_eq',
      }),
    );
    expect(lowered).toEqual({
      naming: { kind: 'exact', name: 'users_email_eq' },
      expression: 'eql_v3.eq_term(email)',
      where: '(deleted_at IS NULL)',
      unique: true,
      type: 'btree',
    });
  });

  it('the wire full matrix hashes over every tuple slot', () => {
    const lowered = lowerAuthoredIndex('user', {
      expression: 'eql_v3.eq_term(email)',
      where: '(deleted_at IS NULL)',
      unique: true,
      type: 'btree',
      name: 'users_email_eq',
    });
    expect(lowered.naming).toEqual({
      kind: 'wire',
      prefix: 'users_email_eq',
      hash: '2b38ed5c',
    });
  });
});

function captureAndReturn<T>(run: () => T): T {
  const emitWarning = vi.spyOn(process, 'emitWarning').mockImplementation(() => {});
  try {
    return run();
  } finally {
    emitWarning.mockRestore();
  }
}

describe('lowerAuthoredIndex — cross-field guards', () => {
  it('rejects both columns and expression with a user-facing error', () => {
    let caught: unknown;
    try {
      lowerAuthoredIndex('user', {
        columns: ['email'],
        expression: 'lower(email)',
        name: 'users_email_eq',
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      code: 'CONTRACT.ARGUMENT_INVALID',
      message: expect.stringContaining('exactly one'),
    });
    expect(String((caught as Error).message)).toContain('user');
  });

  it('rejects neither columns nor expression', () => {
    expect(() => lowerAuthoredIndex('user', { name: 'users_email_eq' })).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.ARGUMENT_INVALID',
        message: expect.stringContaining('exactly one'),
      }),
    );
  });

  it('rejects an expression without a name or map', () => {
    let caught: unknown;
    try {
      lowerAuthoredIndex('user', { expression: 'lower(email)' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      code: 'CONTRACT.ARGUMENT_INVALID',
      message: expect.stringContaining('expression index requires an explicit name'),
    });
  });

  it('rejects options without a type — the untyped-options shape cannot round-trip through infer', () => {
    let caught: unknown;
    try {
      lowerAuthoredIndex('user', {
        columns: ['email'],
        name: 'user_email_idx',
        options: { fillfactor: 70 },
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      code: 'CONTRACT.ARGUMENT_INVALID',
      message: expect.stringContaining('options requires an explicit type'),
    });
  });

  it('rejects map combined with name as a user-facing error (no longer internal)', () => {
    let caught: unknown;
    try {
      lowerAuthoredIndex('user', {
        columns: ['email'],
        map: 'users_email_exact',
        name: 'users_email_idx',
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      code: 'CONTRACT.ARGUMENT_INVALID',
      message: expect.stringContaining('map and name are mutually exclusive'),
    });
  });
});

describe('lowerAuthoredIndex — exact-name body warning collection', () => {
  it('pushes into a provided collector instead of emitting', () => {
    const collected: AuthoringWarning[] = [];
    const warnings = captureWarnings(() => {
      lowerAuthoredIndex(
        'user',
        { expression: 'lower(email)', map: 'users_email_eq' },
        { push: (w) => collected.push(w) },
      );
    });
    expect(warnings).toEqual([]);
    expect(collected).toEqual([
      expect.objectContaining({
        code: 'PN_EXACT_NAME_BODY_COMPARISON',
        item: 'index "users_email_eq"',
      }),
    ]);
  });

  it('a fields-only map pushes nothing into the collector', () => {
    const collected: AuthoringWarning[] = [];
    lowerAuthoredIndex(
      'user',
      { columns: ['email'], map: 'users_email_exact' },
      { push: (w) => collected.push(w) },
    );
    expect(collected).toEqual([]);
  });
});

describe('flushAuthoringWarnings over exact-name body warnings — threshold batching', () => {
  const item = (name: string): AuthoringWarning => exactNameBodyWarning('index', name);

  it('flushes nothing for an empty collection', () => {
    expect(captureWarnings(() => flushAuthoringWarnings([]))).toEqual([]);
  });

  it('emits one warning per item up to the threshold, each naming its index', () => {
    const warnings = captureWarnings(() => flushAuthoringWarnings([item('idx_a'), item('idx_b')]));
    expect(warnings).toHaveLength(2);
    expect(warnings[0]?.message).toContain('index "idx_a" uses map: with a SQL body.');
    expect(warnings[1]?.message).toContain('index "idx_b" uses map: with a SQL body.');
    expect(warnings[0]?.options).toEqual({ code: 'PN_EXACT_NAME_BODY_COMPARISON' });
  });

  it('exactly the threshold count (5) still emits per-item warnings', () => {
    const names = ['a', 'b', 'c', 'd', 'e'].map((n) => `idx_${n}`);
    const warnings = captureWarnings(() => flushAuthoringWarnings(names.map(item)));
    expect(warnings).toHaveLength(5);
    for (const [i, name] of names.entries()) {
      expect(warnings[i]?.message).toContain(`index "${name}" uses map: with a SQL body.`);
    }
  });

  it('emits one summary with the name list above the threshold', () => {
    const names = ['a', 'b', 'c', 'd', 'e', 'f'].map((n) => `idx_${n}`);
    const warnings = captureWarnings(() => flushAuthoringWarnings(names.map(item)));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toContain('6 objects use map: with a SQL body.');
    for (const name of names) {
      expect(warnings[0]?.message).toContain(`  - index "${name}"`);
    }
    expect(warnings[0]?.options).toEqual({ code: 'PN_EXACT_NAME_BODY_COMPARISON' });
  });

  it('a warning of a different code never batches into the exact-name summary', () => {
    const other: AuthoringWarning = {
      code: 'PN_SOME_OTHER_ADVISORY',
      message: 'some other advisory message',
      item: 'thing "x"',
      summary: 'things need attention.',
    };
    const names = ['a', 'b', 'c', 'd', 'e', 'f'].map((n) => `idx_${n}`);
    const warnings = captureWarnings(() => flushAuthoringWarnings([...names.map(item), other]));
    expect(warnings).toHaveLength(2);
    expect(warnings[0]?.message).toContain('6 objects use map: with a SQL body.');
    expect(warnings[0]?.message).not.toContain('thing "x"');
    expect(warnings[1]).toEqual({
      message: 'some other advisory message',
      options: { code: 'PN_SOME_OTHER_ADVISORY' },
    });
  });
});

describe('lowerAuthoredIndex — exact-name body warning', () => {
  const expectedMessage =
    'index "users_email_eq" uses map: with a SQL body. Drift detection compares the authored ' +
    "SQL text byte-for-byte against Postgres's reprinted form, which is only reliable when the " +
    'text was captured by contract infer. For hand-authored definitions, use name: and let ' +
    'Prisma 8 manage the physical name; to migrate an adopted object to wire naming, ' +
    'replace map: with name: (keeping the body text unchanged) and apply the resulting rename ' +
    'migration.';

  it('fires for map + expression with the pinned wording and code', () => {
    const warnings = captureWarnings(() => {
      lowerAuthoredIndex('user', { expression: 'lower(email)', map: 'users_email_eq' });
    });
    expect(warnings).toEqual([
      { message: expectedMessage, options: { code: 'PN_EXACT_NAME_BODY_COMPARISON' } },
    ]);
  });

  it('the policy subject speaks policy vocabulary end to end — @@map named, drop-@@map remediation', () => {
    const warning = exactNameBodyWarning('policy', 'Tenant members can read');
    expect(warning.message).toBe(
      'policy "Tenant members can read" uses @@map with a SQL body. Drift detection compares ' +
        "the authored SQL text byte-for-byte against Postgres's reprinted form, which is only " +
        'reliable when the text was captured by contract infer. For hand-authored definitions, ' +
        "drop @@map and let the policy block's head name the policy; to migrate an adopted " +
        'policy to wire naming, remove @@map (keeping the body text unchanged) and apply ' +
        'the resulting rename migration.',
    );
    expect(warning.summary).toBe(
      'objects use @@map with a SQL body. Drift detection compares ' +
        "the authored SQL text byte-for-byte against Postgres's reprinted form, which is only " +
        'reliable when the text was captured by contract infer. For hand-authored definitions, ' +
        "drop @@map and let the policy block's head name the policy; to migrate an adopted " +
        'policy to wire naming, remove @@map (keeping the body text unchanged) and apply ' +
        'the resulting rename migration.',
    );
  });

  it('same code, different summary — index and policy warnings never share a batch', () => {
    const warnings = captureWarnings(() =>
      flushAuthoringWarnings([
        ...['a', 'b', 'c', 'd'].map((n) => exactNameBodyWarning('index', `idx_${n}`)),
        exactNameBodyWarning('policy', 'p one'),
        exactNameBodyWarning('policy', 'p two'),
      ]),
    );
    // Six same-code warnings, but two summaries: neither group crosses the
    // threshold, so every warning itemizes with its own subject's wording.
    expect(warnings).toHaveLength(6);
    for (const w of warnings.slice(0, 4)) {
      expect(w.message).toContain('uses map: with a SQL body.');
    }
    for (const w of warnings.slice(4)) {
      expect(w.message).toContain('uses @@map with a SQL body.');
    }
  });

  it('fires for map + where', () => {
    const warnings = captureWarnings(() => {
      lowerAuthoredIndex('user', {
        columns: ['email'],
        where: '(deleted_at IS NULL)',
        map: 'users_email_eq',
      });
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.options).toEqual({ code: 'PN_EXACT_NAME_BODY_COMPARISON' });
  });

  it('stays silent for a fields-only map', () => {
    const warnings = captureWarnings(() => {
      lowerAuthoredIndex('user', { columns: ['email'], map: 'users_email_exact' });
    });
    expect(warnings).toEqual([]);
  });

  it('stays silent for a wire-named (name:) body', () => {
    const warnings = captureWarnings(() => {
      lowerAuthoredIndex('user', { expression: 'lower(email)', name: 'users_email_eq' });
    });
    expect(warnings).toEqual([]);
  });
});
