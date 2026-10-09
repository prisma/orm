import { createHash } from 'node:crypto';
import { normalizeSqlBody } from '@internal/sql-schema-ir/naming';
import { describe, expect, it } from 'vitest';
import { computeContentHash } from '../src/core/rls/canonicalize';

describe('computeContentHash', () => {
  const base = {
    roles: ['authenticated'],
    operation: 'select' as const,
    permissive: true,
  };

  describe('output format', () => {
    it('returns exactly 8 hex characters', () => {
      const hash = computeContentHash({ ...base, using: 'user_id = auth.uid()' });
      expect(hash).toMatch(/^[0-9a-f]{8}$/);
    });

    it('returns lowercase hex', () => {
      const hash = computeContentHash({ ...base, using: 'user_id = auth.uid()' });
      expect(hash).toBe(hash.toLowerCase());
    });
  });

  describe('hash determinism across whitespace-equivalent predicates', () => {
    it('produces the same hash for using with extra whitespace vs collapsed', () => {
      const a = computeContentHash({ ...base, using: 'user_id  =  auth.uid()' });
      const b = computeContentHash({ ...base, using: 'user_id = auth.uid()' });
      expect(a).toBe(b);
    });

    it('produces the same hash regardless of role order', () => {
      const a = computeContentHash({ ...base, roles: ['anon', 'authenticated'], using: 'true' });
      const b = computeContentHash({ ...base, roles: ['authenticated', 'anon'], using: 'true' });
      expect(a).toBe(b);
    });

    it('deduplicates roles — duplicate does not change hash', () => {
      const a = computeContentHash({ ...base, roles: ['authenticated'], using: 'true' });
      const b = computeContentHash({
        ...base,
        roles: ['authenticated', 'authenticated'],
        using: 'true',
      });
      expect(a).toBe(b);
    });
  });

  describe('hash distinctness for semantically different bodies', () => {
    it('using-only vs using+withCheck differs', () => {
      const a = computeContentHash({ ...base, using: 'user_id = auth.uid()' });
      const b = computeContentHash({
        ...base,
        using: 'user_id = auth.uid()',
        withCheck: 'user_id = auth.uid()',
      });
      expect(a).not.toBe(b);
    });

    it('different using bodies differ', () => {
      const a = computeContentHash({ ...base, using: 'user_id = auth.uid()' });
      const b = computeContentHash({ ...base, using: 'tenant_id = auth.tenant()' });
      expect(a).not.toBe(b);
    });

    it('keyword case is significant (no lowercasing)', () => {
      const a = computeContentHash({ ...base, using: 'deleted_at IS NULL' });
      const b = computeContentHash({ ...base, using: 'deleted_at is null' });
      expect(a).not.toBe(b);
    });

    it('enclosing parens are significant (no paren stripping)', () => {
      const a = computeContentHash({ ...base, using: '(user_id = auth.uid())' });
      const b = computeContentHash({ ...base, using: 'user_id = auth.uid()' });
      expect(a).not.toBe(b);
    });

    it('different operations differ', () => {
      const a = computeContentHash({ ...base, using: 'true', operation: 'select' });
      const b = computeContentHash({ ...base, using: 'true', operation: 'insert' });
      expect(a).not.toBe(b);
    });

    it('permissive vs restrictive differs', () => {
      const a = computeContentHash({ ...base, using: 'true', permissive: true });
      const b = computeContentHash({ ...base, using: 'true', permissive: false });
      expect(a).not.toBe(b);
    });

    it('different roles differ', () => {
      const a = computeContentHash({ ...base, using: 'true', roles: ['authenticated'] });
      const b = computeContentHash({ ...base, using: 'true', roles: ['anon'] });
      expect(a).not.toBe(b);
    });

    it('using-only vs withCheck-only differs', () => {
      const a = computeContentHash({ ...base, using: 'user_id = auth.uid()' });
      const b = computeContentHash({ ...base, withCheck: 'user_id = auth.uid()' });
      expect(a).not.toBe(b);
    });
  });

  describe('line comments', () => {
    it('a line break after a line comment in using changes the hash', () => {
      expect(computeContentHash({ ...base, using: 'a --c\nb' })).not.toBe(
        computeContentHash({ ...base, using: 'a --c b' }),
      );
    });

    it('a line break after a line comment in withCheck changes the hash', () => {
      expect(computeContentHash({ ...base, withCheck: 'a --c\nb' })).not.toBe(
        computeContentHash({ ...base, withCheck: 'a --c b' }),
      );
    });
  });

  describe('string literals are data', () => {
    it('status with paren content hashes differently from status with plain content', () => {
      const a = computeContentHash({ ...base, using: "status = '(active)'" });
      const b = computeContentHash({ ...base, using: "status = 'active'" });
      expect(a).not.toBe(b);
    });

    it('string literal case is preserved — different case produces different hash', () => {
      const a = computeContentHash({ ...base, using: "label = 'AND'" });
      const b = computeContentHash({ ...base, using: "label = 'and'" });
      expect(a).not.toBe(b);
    });
  });

  describe('tuple encoding stability', () => {
    it('matches the expected SHA-256 first-8-hex for a known input', () => {
      const parts = {
        using: 'user_id = auth.uid()',
        roles: ['authenticated'],
        operation: 'select' as const,
        permissive: true,
      };
      const hash = computeContentHash(parts);
      const canonical = normalizeSqlBody('user_id = auth.uid()');
      const tuple = JSON.stringify([canonical, '', ['authenticated'], 'select', 'permissive']);
      const expected = createHash('sha256').update(tuple).digest('hex').slice(0, 8);
      expect(hash).toBe(expected);
    });
  });
});
