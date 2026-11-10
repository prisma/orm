import { describe, expect, it } from 'vitest';
import { EMPTY_CONTRACT_HASH } from '../../src/constants';
import { reconstructGraph } from '../../src/migration-graph';
import type { OnDiskMigrationPackage } from '../../src/package';
import type { Refs } from '../../src/refs';
import { parseMigrationRef } from '../../src/refs/migration-ref';
import type { RefResolutionContext, RefResolutionError } from '../../src/refs/types';

const HASH_A = `${'a'.repeat(64)}`;
const HASH_B = `${'b'.repeat(64)}`;
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
    },
  };
}

function expectError(result: { ok: boolean }, kind: RefResolutionError['kind']) {
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect((result as { ok: false; failure: RefResolutionError }).failure.kind).toBe(kind);
  }
}

describe('parseMigrationRef', () => {
  describe('directory name resolution', () => {
    it('resolves a migration directory name', () => {
      const ctx = createContext();
      const result = parseMigrationRef('20260101-add-users', ctx);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.dirName).toBe('20260101-add-users');
        expect(result.value.migrationHash).toBe(MIG_HASH_1);
        expect(result.value.from).toBe(EMPTY_CONTRACT_HASH);
        expect(result.value.to).toBe(HASH_A);
        expect(result.value.provenance).toEqual({
          kind: 'dir-name',
          dirName: '20260101-add-users',
        });
      }
    });

    it('returns not-found for unknown directory name', () => {
      const ctx = createContext();
      const result = parseMigrationRef('nonexistent', ctx);
      expectError(result, 'not-found');
    });
  });

  describe('migration hash resolution', () => {
    it('resolves a full migration hash', () => {
      const ctx = createContext();
      const result = parseMigrationRef(MIG_HASH_1, ctx);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.dirName).toBe('20260101-add-users');
        expect(result.value.migrationHash).toBe(MIG_HASH_1);
        expect(result.value.provenance).toEqual({ kind: 'hash', input: MIG_HASH_1 });
      }
    });

    it('resolves a migration hash by 6-char prefix', () => {
      const ctx = createContext();
      const result = parseMigrationRef('111111', ctx);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.migrationHash).toBe(MIG_HASH_1);
        expect(result.value.provenance).toEqual({ kind: 'hash', input: '111111' });
      }
    });

    it('returns ambiguous for non-unique migration hash prefix', () => {
      const MIG_HASH_AMB1 = `aabbcc${'1'.repeat(58)}`;
      const MIG_HASH_AMB2 = `aabbcc${'2'.repeat(58)}`;
      const HASH_X = `${'f'.repeat(64)}`;
      const ctx = createContext({
        packages: [
          pkg('m1', null, HASH_A, MIG_HASH_AMB1),
          pkg('m2', HASH_A, HASH_X, MIG_HASH_AMB2),
        ],
      });
      const result = parseMigrationRef('aabbcc', ctx);
      expectError(result, 'ambiguous');
    });
  });

  describe('wrong-grammar diagnostics', () => {
    it('rejects ref names with wrong-grammar error', () => {
      const ctx = createContext();
      const result = parseMigrationRef('production', ctx);
      expectError(result, 'wrong-grammar');
      if (!result.ok && result.failure.kind === 'wrong-grammar') {
        expect(result.failure.message).toContain('ref name');
        expect(result.failure.expectedGrammar).toBe('migration');
      }
    });

    it('rejects caret syntax with wrong-grammar error', () => {
      const ctx = createContext();
      const result = parseMigrationRef('20260101-add-users^', ctx);
      expectError(result, 'wrong-grammar');
      if (!result.ok && result.failure.kind === 'wrong-grammar') {
        expect(result.failure.message).toContain('contracts, not migrations');
      }
    });

    it('rejects a full hash that matches a contract but not a migration', () => {
      const ctx = createContext();
      const result = parseMigrationRef(HASH_A, ctx);
      expectError(result, 'wrong-grammar');
      if (!result.ok && result.failure.kind === 'wrong-grammar') {
        expect(result.failure.message).toContain('contract but not a migration');
      }
    });

    it('rejects a hex prefix matching a contract but no migration', () => {
      const ctx = createContext();
      const result = parseMigrationRef('aaaaaa', ctx);
      expectError(result, 'wrong-grammar');
      if (!result.ok && result.failure.kind === 'wrong-grammar') {
        expect(result.failure.message).toContain('contract but not a migration');
      }
    });
  });

  describe('invalid format', () => {
    it('returns invalid-format for empty string', () => {
      const ctx = createContext();
      const result = parseMigrationRef('', ctx);
      expectError(result, 'invalid-format');
    });
  });
});
