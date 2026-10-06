import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  assertWireNamePrefixLength,
  composeCheckWirePrefix,
  computeCheckContentHash,
  computeIndexContentHash,
  defaultIndexName,
  derivedCheckPrefixes,
  formatWireName,
  nameOf,
  namingOf,
  namingOfLiveName,
  normalizeIndexOptionValue,
  normalizeSqlBody,
  parseNaming,
  parseWireName,
  truncateToWireNamePrefixBytes,
  WIRE_NAME_PREFIX_MAX_BYTES,
} from '../src/exports/naming';

describe('defaultIndexName', () => {
  it('joins the table and column tuple into the conventional suffix', () => {
    expect(defaultIndexName('users', ['tenant_id', 'email'])).toBe('users_tenant_id_email_idx');
  });
});

describe('the naming union', () => {
  describe('nameOf / namingOf round-trip', () => {
    it('an exact name keeps its author-owned spelling', () => {
      const naming = namingOf('users_pkey', undefined);

      expect(naming).toEqual({ kind: 'exact', name: 'users_pkey' });
      expect(nameOf(naming)).toBe('users_pkey');
    });

    it('a wire name splits back into the prefix it was built from', () => {
      const naming = namingOf('users_email_idx_ab12cd34', 'users_email_idx');

      expect(naming).toEqual({
        kind: 'wire',
        prefix: 'users_email_idx',
        hash: 'ab12cd34',
      });
      expect(nameOf(naming)).toBe('users_email_idx_ab12cd34');
    });
  });

  describe('parseNaming (flat data from outside the process)', () => {
    it('reads a wire name back when the declared prefix agrees', () => {
      expect(parseNaming('p_read_ab12cd34', 'p_read')).toEqual({
        kind: 'wire',
        prefix: 'p_read',
        hash: 'ab12cd34',
      });
    });

    it('treats an absent prefix as an exact name', () => {
      expect(parseNaming('handwritten', undefined)).toEqual({
        kind: 'exact',
        name: 'handwritten',
      });
    });

    it('rejects a declared prefix that disagrees with the name', () => {
      expect(() => parseNaming('p_read_ab12cd34', 'p_write')).toThrow(
        '"p_read_ab12cd34": prefix "p_write" does not match the wire name',
      );
    });

    it('rejects a declared prefix on a name with no hash suffix', () => {
      expect(() => parseNaming('handwritten', 'handwritten')).toThrow(
        'does not match the wire name',
      );
    });
  });

  describe('namingOfLiveName (a name read out of the catalog)', () => {
    it('claims the wire arm for a wire-shaped name', () => {
      expect(namingOfLiveName('users_email_idx_ab12cd34')).toEqual({
        kind: 'wire',
        prefix: 'users_email_idx',
        hash: 'ab12cd34',
      });
    });

    it('claims the exact arm for anything else', () => {
      expect(namingOfLiveName('users_pkey')).toEqual({ kind: 'exact', name: 'users_pkey' });
    });
  });
});

describe('composeCheckWirePrefix', () => {
  it('spells the membership and element-not-null kinds distinctly', () => {
    expect({
      membership: composeCheckWirePrefix('User', 'role', 'membership'),
      elementNotNull: composeCheckWirePrefix('User', 'tags', 'elementNotNull'),
    }).toEqual({
      membership: 'User_role_check',
      elementNotNull: 'User_tags_elem_not_null',
    });
  });

  it('truncates a derived prefix to the wire-name byte budget', () => {
    const prefix = composeCheckWirePrefix('t'.repeat(60), 'column', 'membership');

    expect(new TextEncoder().encode(prefix).length).toBe(WIRE_NAME_PREFIX_MAX_BYTES);
  });
});

describe('normalizeIndexOptionValue', () => {
  it('canonicalizes every boolean spelling the catalog may reprint', () => {
    expect({
      trueValues: [true, 'true', 'on'].map(normalizeIndexOptionValue),
      falseValues: [false, 'false', 'off'].map(normalizeIndexOptionValue),
    }).toEqual({
      trueValues: ['on', 'on', 'on'],
      falseValues: ['off', 'off', 'off'],
    });
  });

  it('String()-coerces everything else', () => {
    expect([70, '70', null].map(normalizeIndexOptionValue)).toEqual(['70', '70', 'null']);
  });
});

describe('formatWireName', () => {
  it('joins prefix and hash with an underscore', () => {
    expect(formatWireName('p_read', 'ab12cd34')).toBe('p_read_ab12cd34');
  });

  it('parse ∘ format round-trips (one module owns the format)', () => {
    for (const [prefix, hash] of [
      ['p_read', 'ab12cd34'],
      ['read_own_profiles', 'deadbeef'],
      ['users_email_idx', '01234567'],
    ] as const) {
      expect(parseWireName(formatWireName(prefix, hash))).toEqual({ prefix, hash });
    }
  });
});

describe('parseWireName', () => {
  it('splits a wire name into prefix and hash', () => {
    expect(parseWireName('p_read_ab12cd34')).toEqual({ prefix: 'p_read', hash: 'ab12cd34' });
  });

  it('keeps underscores inside the prefix (only the final segment is the hash)', () => {
    expect(parseWireName('read_own_profiles_deadbeef')).toEqual({
      prefix: 'read_own_profiles',
      hash: 'deadbeef',
    });
  });

  it('returns undefined for a name without a hash suffix', () => {
    expect(parseWireName('handwritten_index')).toBeUndefined();
  });

  it('returns undefined when the suffix is not exactly 8 hex characters', () => {
    expect(parseWireName('p_read_abc')).toBeUndefined();
    expect(parseWireName('p_read_ab12cd345')).toBeUndefined();
    expect(parseWireName('p_read_ab12cdZZ')).toBeUndefined();
  });

  it('returns undefined for uppercase hex (wire hashes are lowercase)', () => {
    expect(parseWireName('p_read_AB12CD34')).toBeUndefined();
  });

  it('returns undefined for a bare hash with no prefix', () => {
    expect(parseWireName('_ab12cd34')).toBeUndefined();
    expect(parseWireName('ab12cd34')).toBeUndefined();
  });
});

describe('normalizeSqlBody', () => {
  describe('whitespace collapse', () => {
    it('collapses multiple spaces to one', () => {
      expect(normalizeSqlBody('a  =  b')).toBe('a = b');
    });

    it('collapses tabs to a space', () => {
      expect(normalizeSqlBody('a\t=\tb')).toBe('a = b');
    });

    it('collapses newlines to a space', () => {
      expect(normalizeSqlBody('a\n=\nb')).toBe('a = b');
    });

    it('collapses mixed whitespace variants', () => {
      expect(normalizeSqlBody('a \t\n =\n\t b')).toBe('a = b');
    });

    it('trims leading and trailing whitespace', () => {
      expect(normalizeSqlBody('  a = b  ')).toBe('a = b');
    });
  });

  describe('minimal normalization preserves the authored form', () => {
    // Normalization stabilizes only whitespace. Case, parens, comments, and
    // casts are kept verbatim — collapsing them would risk hashing two
    // distinct bodies onto one wire name.
    it('preserves keyword case', () => {
      expect(normalizeSqlBody('user_id IS NULL')).toBe('user_id IS NULL');
    });

    it('preserves enclosing parens', () => {
      expect(normalizeSqlBody('(a = b)')).toBe('(a = b)');
    });

    it('preserves SQL comments verbatim (after whitespace collapse)', () => {
      expect(normalizeSqlBody('a = b -- comment')).toBe('a = b -- comment');
    });

    it('preserves casts and their aliases', () => {
      expect(normalizeSqlBody('x::integer')).toBe('x::integer');
    });
  });

  describe('determinism across whitespace-equivalent forms', () => {
    it('whitespace variants are equivalent', () => {
      const a = normalizeSqlBody('user_id  =  auth.uid()');
      const b = normalizeSqlBody('user_id = auth.uid()');
      expect(a).toBe(b);
    });
  });

  describe('bodies with a line comment keep their line breaks', () => {
    it('a line break after a comment differs from a space after it', () => {
      expect([normalizeSqlBody('a --c\nb'), normalizeSqlBody('a --c b')]).toEqual([
        'a --c\nb',
        'a --c b',
      ]);
    });

    it('a one-line body with a comment collapses as before', () => {
      expect(normalizeSqlBody('  a  =  b   -- comment  ')).toBe('a = b -- comment');
    });

    it('a multi-line body without a comment collapses as before', () => {
      expect(normalizeSqlBody('a\r\n=\rb\n')).toBe('a = b');
    });

    it('treats CRLF and a lone CR as line ends', () => {
      expect([normalizeSqlBody('a --c\r\nb'), normalizeSqlBody('a --c\rb')]).toEqual([
        'a --c\nb',
        'a --c\nb',
      ]);
    });

    it('collapses whitespace within each line and drops blank lines', () => {
      expect(normalizeSqlBody('\n  a  =\tb  -- c  \n\n   \n\t x  y \n')).toBe('a = b -- c\nx y');
    });

    it('gives the same output on its own output', () => {
      const bodies = ['a --c\n\n  b', ' a  -- c ', 'a\n b', "x = '--'\r\n  AND y"];
      expect(bodies.map((body) => normalizeSqlBody(normalizeSqlBody(body)))).toEqual(
        bodies.map(normalizeSqlBody),
      );
    });
  });
});

describe('computeCheckContentHash', () => {
  it('returns 8 lowercase hex characters', () => {
    expect(computeCheckContentHash(`"role" IN ('user', 'admin')`)).toMatch(/^[0-9a-f]{8}$/);
  });

  it('matches the expected SHA-256 first-8-hex for a known input', () => {
    const expression = `"role"  IN ('user', 'admin')`;
    const tuple = JSON.stringify([`"role" IN ('user', 'admin')`]);
    const expected = createHash('sha256').update(tuple).digest('hex').slice(0, 8);
    expect(computeCheckContentHash(expression)).toBe(expected);
  });

  it('is stable across calls', () => {
    const expression = 'array_position("tags", NULL) IS NULL';
    expect(computeCheckContentHash(expression)).toBe(computeCheckContentHash(expression));
  });

  it('whitespace variants hash identically', () => {
    expect(computeCheckContentHash('  array_position("tags",   NULL)\n IS NULL ')).toBe(
      computeCheckContentHash('array_position("tags", NULL) IS NULL'),
    );
  });

  it('materially different expressions hash differently', () => {
    expect(computeCheckContentHash(`"role" IN ('user')`)).not.toBe(
      computeCheckContentHash(`"role" IN ('admin')`),
    );
  });

  it('a line break after a line comment changes the hash', () => {
    expect(computeCheckContentHash('a > 0 --c\nAND b > 0')).not.toBe(
      computeCheckContentHash('a > 0 --c AND b > 0'),
    );
  });
});

describe('derivedCheckPrefixes', () => {
  it('crosses every column with every CheckKind', () => {
    const prefixes = derivedCheckPrefixes('User', ['role', 'tags']);
    expect(prefixes).toEqual(
      new Set([
        composeCheckWirePrefix('User', 'role', 'membership'),
        composeCheckWirePrefix('User', 'role', 'elementNotNull'),
        composeCheckWirePrefix('User', 'tags', 'membership'),
        composeCheckWirePrefix('User', 'tags', 'elementNotNull'),
      ]),
    );
  });

  it('returns an empty set for a table with no columns', () => {
    expect(derivedCheckPrefixes('User', [])).toEqual(new Set());
  });

  it('does not include a prefix no column of the table could produce', () => {
    const prefixes = derivedCheckPrefixes('User', ['role', 'tags']);
    expect(prefixes.has('User_status_active')).toBe(false);
  });

  it('truncates a composed prefix that overruns the byte budget (literal expected value)', () => {
    // The ADR 244 worked example: a 22-character table name plus a
    // 21-character column name pushes the `elem_not_null`-suffixed prefix to
    // 58 bytes, 4 over budget, so it truncates to exactly 54 — cutting into
    // the kind marker itself (`_elem_not_` with `null` gone).
    const prefixes = derivedCheckPrefixes('custom_oauth_providers', ['acceptable_client_ids']);
    expect(prefixes).toEqual(
      new Set([
        'custom_oauth_providers_acceptable_client_ids_check',
        'custom_oauth_providers_acceptable_client_ids_elem_not_',
      ]),
    );
  });

  it('dedups two columns whose composed prefixes collide after truncation', () => {
    // Both column names share their first 60 bytes and differ only in the
    // last character — a difference the 54-byte truncation cuts away before
    // it, and before either kind suffix, ever survives. The non-injective
    // case ADR 244's "Truncation is safe because identity does not live in
    // the prefix" argument depends on: two different columns, four nominal
    // (column x kind) prefixes, one surviving entry.
    const columnA = `${'a'.repeat(60)}A`;
    const columnB = `${'a'.repeat(60)}B`;
    const prefixes = derivedCheckPrefixes('t', [columnA, columnB]);
    expect(prefixes).toEqual(new Set([`t_${'a'.repeat(52)}`]));
  });
});

describe('computeIndexContentHash', () => {
  const base = { columns: ['email'], unique: false } as const;

  it('returns 8 lowercase hex characters', () => {
    expect(computeIndexContentHash(base)).toMatch(/^[0-9a-f]{8}$/);
  });

  describe('tuple encoding stability', () => {
    it('matches the expected SHA-256 first-8-hex for a known input', () => {
      const hash = computeIndexContentHash({
        expression: 'lower(email)',
        where: 'deleted_at  IS  NULL',
        unique: true,
        type: 'btree',
        options: { fillfactor: 70 },
      });
      const tuple = JSON.stringify([
        'lower(email)',
        'deleted_at IS NULL',
        [],
        true,
        'btree',
        [['fillfactor', '70']],
      ]);
      const expected = createHash('sha256').update(tuple).digest('hex').slice(0, 8);
      expect(hash).toBe(expected);
    });
  });

  describe('column order is semantic', () => {
    it('swapping two columns changes the hash', () => {
      const ab = computeIndexContentHash({ columns: ['a', 'b'], unique: false });
      const ba = computeIndexContentHash({ columns: ['b', 'a'], unique: false });
      expect(ab).not.toBe(ba);
    });
  });

  describe('options coercion and ordering', () => {
    it('String()-coerces values: a typed 70 hashes equal to an introspected "70"', () => {
      const typed = computeIndexContentHash({ ...base, options: { fillfactor: 70 } });
      const stringly = computeIndexContentHash({ ...base, options: { fillfactor: '70' } });
      expect(typed).toBe(stringly);
    });

    it("canonicalizes boolean values to the catalog reprint form ('on'/'off')", () => {
      const typedTrue = computeIndexContentHash({ ...base, options: { deduplicate_items: true } });
      const reprintOn = computeIndexContentHash({
        ...base,
        options: { deduplicate_items: 'on' },
      });
      expect(typedTrue).toBe(reprintOn);

      const typedFalse = computeIndexContentHash({
        ...base,
        options: { deduplicate_items: false },
      });
      const reprintOff = computeIndexContentHash({
        ...base,
        options: { deduplicate_items: 'off' },
      });
      expect(typedFalse).toBe(reprintOff);
      // The catalog stores whatever spelling the DDL used, so the string
      // spellings canonicalize to the same form too.
      const stringlyFalse = computeIndexContentHash({
        ...base,
        options: { deduplicate_items: 'false' },
      });
      expect(typedFalse).toBe(stringlyFalse);
    });

    it('is insensitive to option key order', () => {
      const ab = computeIndexContentHash({ ...base, options: { a: '1', b: '2' } });
      const ba = computeIndexContentHash({ ...base, options: { b: '2', a: '1' } });
      expect(ab).toBe(ba);
    });

    it('different option values produce different hashes', () => {
      const seventy = computeIndexContentHash({ ...base, options: { fillfactor: 70 } });
      const eighty = computeIndexContentHash({ ...base, options: { fillfactor: 80 } });
      expect(seventy).not.toBe(eighty);
    });
  });

  describe('body whitespace normalization', () => {
    it('expression whitespace variants hash identically', () => {
      const a = computeIndexContentHash({ expression: 'lower(  email  )', unique: false });
      const b = computeIndexContentHash({ expression: 'lower( email )', unique: false });
      expect(a).toBe(b);
    });

    it('where whitespace variants hash identically', () => {
      const a = computeIndexContentHash({ ...base, where: 'deleted_at   IS NULL' });
      const b = computeIndexContentHash({ ...base, where: 'deleted_at IS NULL' });
      expect(a).toBe(b);
    });

    it('materially different expressions hash differently', () => {
      const a = computeIndexContentHash({ expression: 'lower(email)', unique: false });
      const b = computeIndexContentHash({ expression: 'upper(email)', unique: false });
      expect(a).not.toBe(b);
    });
  });

  describe('line comments', () => {
    it('a line break after a line comment in the expression changes the hash', () => {
      expect(
        computeIndexContentHash({ expression: 'lower(email) --c\n, id', unique: false }),
      ).not.toBe(computeIndexContentHash({ expression: 'lower(email) --c , id', unique: false }));
    });

    it('a line break after a line comment in the predicate changes the hash', () => {
      expect(
        computeIndexContentHash({ columns: ['email'], unique: false, where: 'a --c\nb' }),
      ).not.toBe(computeIndexContentHash({ columns: ['email'], unique: false, where: 'a --c b' }));
    });
  });

  describe('empty-vs-absent equivalences (the ?? defaults)', () => {
    it('absent expression hashes like an empty expression', () => {
      expect(computeIndexContentHash(base)).toBe(
        computeIndexContentHash({ ...base, expression: '' }),
      );
    });

    it('absent where hashes like an empty where', () => {
      expect(computeIndexContentHash(base)).toBe(computeIndexContentHash({ ...base, where: '' }));
    });

    it('absent columns hash like an empty column list', () => {
      expect(computeIndexContentHash({ unique: false })).toBe(
        computeIndexContentHash({ columns: [], unique: false }),
      );
    });

    it('absent type hashes like an empty type', () => {
      expect(computeIndexContentHash(base)).toBe(computeIndexContentHash({ ...base, type: '' }));
    });

    it('absent options hash like an empty options bag', () => {
      expect(computeIndexContentHash(base)).toBe(computeIndexContentHash({ ...base, options: {} }));
    });
  });

  describe('remaining tuple members participate', () => {
    it('unique flips the hash', () => {
      const plain = computeIndexContentHash(base);
      const unique = computeIndexContentHash({ ...base, unique: true });
      expect(plain).not.toBe(unique);
    });

    it('type changes the hash', () => {
      const btree = computeIndexContentHash({ ...base, type: 'btree' });
      const gin = computeIndexContentHash({ ...base, type: 'gin' });
      expect(btree).not.toBe(gin);
    });
  });
});

describe('pinned wire hashes (stability commitment)', () => {
  // Literal 8-hex pins for representative content tuples. If any of these
  // change, the tuple encoding changed and EVERY existing wire name
  // re-suffixes — that is a breaking change and ships only with an explicit
  // upgrade instruction, never as a silent refactor.
  it.each([
    [{ columns: ['email'], unique: false }, '46df9cad'],
    [{ columns: ['email'], unique: true }, '34912d96'],
    [{ columns: ['email'], unique: false, type: 'btree' }, '73653512'],
    [{ columns: ['email'], unique: false, type: 'hash' }, '239baf6b'],
    [{ expression: 'lower(email)', unique: false }, '17273133'],
    [{ columns: ['email'], unique: false, where: '(email IS NOT NULL)' }, '26557448'],
    [{ columns: ['email'], unique: false, type: 'btree', options: { fillfactor: 70 } }, '72bcb92e'],
  ] as const)('%j pins to %s', (parts, expected) => {
    expect(computeIndexContentHash(parts)).toBe(expected);
  });
});

describe('assertWireNamePrefixLength', () => {
  it('rejects a prefix over the 54-byte cap, naming the prefix and the cap', () => {
    const longPrefix = 'a'.repeat(WIRE_NAME_PREFIX_MAX_BYTES + 1);
    expect(() => assertWireNamePrefixLength(longPrefix, 'index prefix')).toThrow(
      `index prefix "${longPrefix}" exceeds the 54-byte maximum`,
    );
  });

  it('accepts a 54-byte prefix (the cap is inclusive)', () => {
    const prefix = 'a'.repeat(WIRE_NAME_PREFIX_MAX_BYTES);
    expect(() => assertWireNamePrefixLength(prefix, 'index prefix')).not.toThrow();
  });

  it('measures bytes, not characters — Postgres NAMEDATALEN is a byte limit', () => {
    // 28 two-byte characters = 56 bytes, under the character cap, over the byte one.
    const cyrillic = 'я'.repeat(28);
    expect(cyrillic.length).toBeLessThan(WIRE_NAME_PREFIX_MAX_BYTES);
    expect(() => assertWireNamePrefixLength(cyrillic, 'index prefix')).toThrow(
      /exceeds the 54-byte maximum/,
    );
  });
});

describe('truncateToWireNamePrefixBytes', () => {
  it('leaves a prefix within the budget untouched', () => {
    expect(truncateToWireNamePrefixBytes('User_role_check')).toBe('User_role_check');
  });

  it('truncates an ASCII prefix to the byte budget', () => {
    const long = 'a'.repeat(80);
    const out = truncateToWireNamePrefixBytes(long);
    expect(out).toBe('a'.repeat(WIRE_NAME_PREFIX_MAX_BYTES));
  });

  it('never splits a multibyte character', () => {
    // Two-byte characters: 27 fit in 54 bytes, the 28th would overrun.
    const cyrillic = 'я'.repeat(40);
    const out = truncateToWireNamePrefixBytes(cyrillic);
    expect(out).toBe('я'.repeat(27));
    expect(new TextEncoder().encode(out).length).toBeLessThanOrEqual(WIRE_NAME_PREFIX_MAX_BYTES);
  });

  it('never splits an astral character (surrogate pair)', () => {
    // Four-byte characters: 13 fit in 54 bytes with 2 bytes to spare.
    const emoji = '😀'.repeat(20);
    const out = truncateToWireNamePrefixBytes(emoji);
    expect(out).toBe('😀'.repeat(13));
    expect([...out].every((c) => c === '😀')).toBe(true);
  });

  it('the resulting wire name fits Postgres 63-byte identifier limit', () => {
    const out = truncateToWireNamePrefixBytes('Пользователь_электронная_почта_адрес_строка');
    const wireName = formatWireName(out, 'aabbccdd');
    expect(new TextEncoder().encode(wireName).length).toBeLessThanOrEqual(63);
  });
});
