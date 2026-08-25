import { describe, expect, it } from 'vitest';
import { EMPTY_CONTRACT_HASH } from '../../src/constants';
import { reconstructGraph } from '../../src/migration-graph';
import type { OnDiskMigrationPackage } from '../../src/package';
import type { Refs } from '../../src/refs';
import { parseContractRef } from '../../src/refs/contract-ref';
import type { RefResolutionContext, RefResolutionError } from '../../src/refs/types';

const HASH_A = `${'a'.repeat(64)}`;
const HASH_B = `${'b'.repeat(64)}`;
const HASH_C = `${'c'.repeat(64)}`;
const MIG_HASH_1 = `${'1'.repeat(64)}`;
const MIG_HASH_2 = `${'2'.repeat(64)}`;

function pkg(
  dirName: string,
  from: string | null,
  to: string,
  migrationHash: string,
): OnDiskMigrationPackage {
  return {
    dirName,
    dirPath: `/tmp/migrations/${dirName}`,
    metadata: {
      from,
      to,
      migrationHash,
      providedInvariants: [],
      createdAt: '2026-01-01T00:00:00Z',
    },
    ops: [],
  };
}

function createContext(overrides?: {
  packages?: OnDiskMigrationPackage[];
  refs?: Refs;
}): RefResolutionContext {
  const packages = overrides?.packages ?? [
    pkg('20260101-add-users', null, HASH_A, MIG_HASH_1),
    pkg('20260102-add-posts', HASH_A, HASH_B, MIG_HASH_2),
  ];
  return {
    graph: reconstructGraph(packages),
    refs: overrides?.refs ?? {
      production: { hash: HASH_B, invariants: [] },
      staging: { hash: HASH_A, invariants: ['split-user-name'] },
    },
  };
}

function expectError(result: { ok: boolean }, kind: RefResolutionError['kind']) {
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect((result as { ok: false; failure: RefResolutionError }).failure.kind).toBe(kind);
  }
}

describe('parseContractRef', () => {
  describe('full hash resolution', () => {
    it('resolves a full storage hash present in the graph', () => {
      const ctx = createContext();
      const result = parseContractRef(HASH_A, ctx);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.hash).toBe(HASH_A);
        expect(result.value.provenance).toEqual({ kind: 'hash', input: HASH_A });
      }
    });

    it('resolves the empty contract hash', () => {
      const ctx = createContext();
      const result = parseContractRef(EMPTY_CONTRACT_HASH, ctx);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.hash).toBe(EMPTY_CONTRACT_HASH);
      }
    });

    it('returns not-found for a full hash not in the graph', () => {
      const ctx = createContext();
      const result = parseContractRef(HASH_C, ctx);
      expectError(result, 'not-found');
    });
  });

  describe('hash prefix resolution', () => {
    it('resolves a unique 6-char hex prefix', () => {
      const ctx = createContext();
      const result = parseContractRef('aaaaaa', ctx);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.hash).toBe(HASH_A);
        expect(result.value.provenance).toEqual({ kind: 'hash', input: 'aaaaaa' });
      }
    });

    it('resolves a prefix with  scheme', () => {
      const ctx = createContext();
      const result = parseContractRef('bbbbbb', ctx);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.hash).toBe(HASH_B);
      }
    });

    it('returns ambiguous when multiple contracts share a prefix', () => {
      const HASH_AMB1 = `aabbcc${'1'.repeat(58)}`;
      const HASH_AMB2 = `aabbcc${'2'.repeat(58)}`;
      const ctx = createContext({
        packages: [
          pkg('m1', null, HASH_AMB1, MIG_HASH_1),
          pkg('m2', HASH_AMB1, HASH_AMB2, MIG_HASH_2),
        ],
      });
      const result = parseContractRef('aabbcc', ctx);
      expectError(result, 'ambiguous');
      if (!result.ok && result.failure.kind === 'ambiguous') {
        expect(result.failure.candidates).toContain(HASH_AMB1);
        expect(result.failure.candidates).toContain(HASH_AMB2);
      }
    });

    it('returns not-found when no contract matches the prefix', () => {
      const ctx = createContext();
      const result = parseContractRef('ffffff', ctx);
      expectError(result, 'not-found');
    });
  });

  describe('ref name resolution', () => {
    it('resolves a known ref name to its target hash', () => {
      const ctx = createContext();
      const result = parseContractRef('production', ctx);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.hash).toBe(HASH_B);
        expect(result.value.provenance).toEqual({ kind: 'ref', refName: 'production' });
      }
    });

    it('resolves another ref name', () => {
      const ctx = createContext();
      const result = parseContractRef('staging', ctx);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.hash).toBe(HASH_A);
        expect(result.value.provenance).toEqual({ kind: 'ref', refName: 'staging' });
      }
    });

    it('returns not-found for an unknown ref name', () => {
      const ctx = createContext();
      const result = parseContractRef('unknown-ref', ctx);
      expectError(result, 'not-found');
    });
  });

  describe('migration directory name resolution (to-contract)', () => {
    it('resolves a migration dir name to its to-contract', () => {
      const ctx = createContext();
      const result = parseContractRef('20260101-add-users', ctx);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.hash).toBe(HASH_A);
        expect(result.value.provenance).toEqual({
          kind: 'migration-to',
          dirName: '20260101-add-users',
        });
      }
    });

    it('resolves the second migration dir name', () => {
      const ctx = createContext();
      const result = parseContractRef('20260102-add-posts', ctx);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.hash).toBe(HASH_B);
        expect(result.value.provenance).toEqual({
          kind: 'migration-to',
          dirName: '20260102-add-posts',
        });
      }
    });
  });

  describe('caret form resolution (from-contract)', () => {
    it('resolves <dir>^ to the migration from-contract', () => {
      const ctx = createContext();
      const result = parseContractRef('20260102-add-posts^', ctx);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.hash).toBe(HASH_A);
        expect(result.value.provenance).toEqual({
          kind: 'migration-from',
          dirName: '20260102-add-posts',
        });
      }
    });

    it('resolves <dir>^ to the empty hash for baseline migrations', () => {
      const ctx = createContext();
      const result = parseContractRef('20260101-add-users^', ctx);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.hash).toBe(EMPTY_CONTRACT_HASH);
        expect(result.value.provenance).toEqual({
          kind: 'migration-from',
          dirName: '20260101-add-users',
        });
      }
    });

    it('returns not-found for unknown dir name with ^', () => {
      const ctx = createContext();
      const result = parseContractRef('nonexistent^', ctx);
      expectError(result, 'not-found');
    });

    it('returns invalid-format for bare ^', () => {
      const ctx = createContext();
      const result = parseContractRef('^', ctx);
      expectError(result, 'invalid-format');
    });
  });

  describe('@contract reserved token', () => {
    it('resolves @contract to the contractHash in context', () => {
      const ctx = createContext();
      const result = parseContractRef('@contract', { ...ctx, contractHash: HASH_B });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.hash).toBe(HASH_B);
        expect(result.value.provenance).toEqual({ kind: 'reserved-contract' });
      }
    });

    it('returns not-found when contractHash is absent from context', () => {
      const ctx = createContext();
      const result = parseContractRef('@contract', ctx);
      expectError(result, 'not-found');
    });
  });

  describe('@db reserved token', () => {
    it('returns a reserved-db provenance that callers must resolve via readAllMarkers', () => {
      const ctx = createContext();
      const result = parseContractRef('@db', ctx);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.provenance).toEqual({ kind: 'reserved-db' });
        // The hash is a placeholder — callers must NOT use it directly.
        // They must check provenance.kind === 'reserved-db' and call readAllMarkers().
      }
    });

    it('returns reserved-db even when contractHash is in context (no offline resolution)', () => {
      const ctx = createContext();
      const result = parseContractRef('@db', { ...ctx, contractHash: HASH_A });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.provenance.kind).toBe('reserved-db');
      }
    });
  });

  describe('@empty reserved token', () => {
    it('resolves @empty to the empty contract hash offline', () => {
      const ctx = createContext();
      const result = parseContractRef('@empty', ctx);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.hash).toBe(EMPTY_CONTRACT_HASH);
        expect(result.value.provenance).toEqual({ kind: 'reserved-empty' });
      }
    });
  });

  describe('ambiguity between interpretation forms', () => {
    it('reports ambiguity when input matches both a ref and a dir name', () => {
      const ctx = createContext({
        packages: [pkg('staging', null, HASH_A, MIG_HASH_1)],
        refs: { staging: { hash: HASH_B, invariants: [] } },
      });
      const result = parseContractRef('staging', ctx);
      expectError(result, 'ambiguous');
    });
  });

  describe('invalid format', () => {
    it('returns invalid-format for empty string', () => {
      const ctx = createContext();
      const result = parseContractRef('', ctx);
      expectError(result, 'invalid-format');
    });
  });

  describe('parameterized: all grammar forms resolve to same contract', () => {
    it('resolves identically via hash, prefix, ref, dir-name, and dir^', () => {
      const ctx = createContext();
      const target = HASH_B;

      const byFullHash = parseContractRef(HASH_B, ctx);
      const byPrefix = parseContractRef('bbbbbb', ctx);
      const byRef = parseContractRef('production', ctx);
      const byDirName = parseContractRef('20260102-add-posts', ctx);

      expect(byFullHash.ok && byFullHash.value.hash).toBe(target);
      expect(byPrefix.ok && byPrefix.value.hash).toBe(target);
      expect(byRef.ok && byRef.value.hash).toBe(target);
      expect(byDirName.ok && byDirName.value.hash).toBe(target);

      const byCaretTarget = HASH_A;
      const byCaret = parseContractRef('20260102-add-posts^', ctx);
      expect(byCaret.ok && byCaret.value.hash).toBe(byCaretTarget);
    });
  });
});
