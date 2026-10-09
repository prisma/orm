/**
 * A `sql` literal stores canonical text. For a body without `--`, the wire name of an index, check
 * or policy is the same whether it was computed from the text as written or from its canonical form,
 * so rewriting a quoted string as a `sql` literal keeps every name.
 */

import { canonicalizeTaggedLiteralBody } from '@internal/framework-components/authoring';
import { computeCheckContentHash, computeIndexContentHash } from '@internal/sql-schema-ir/naming';
import { describe, expect, it } from 'vitest';
import { computeContentHash } from '../src/core/rls/canonicalize';

function canonical(text: string): string {
  const result = canonicalizeTaggedLiteralBody(text);
  if (!result.ok) throw new Error(`"${text}" does not canonicalize`);
  return result.text;
}

const NON_CANONICAL_TEXTS = [
  ['indented', '    owner_id = 1\n      AND id > 0'],
  ['blank first and last lines', '\n  owner_id = 1\n  AND id > 0\n'],
  ['CRLF line breaks', 'owner_id = 1\r\n  AND id > 0'],
] as const;

describe.each(NON_CANONICAL_TEXTS)('a text with %s', (_, written) => {
  it('is changed by canonicalization', () => {
    expect(canonical(written)).not.toBe(written);
  });

  it('gives the same index wire name as its canonical form', () => {
    const hashOf = (text: string) =>
      [
        computeIndexContentHash({ expression: text, unique: false }),
        computeIndexContentHash({ columns: ['owner_id'], where: text, unique: false }),
      ] as const;
    expect(hashOf(written)).toEqual(hashOf(canonical(written)));
  });

  it('gives the same check wire name as its canonical form', () => {
    expect(computeCheckContentHash(written)).toBe(computeCheckContentHash(canonical(written)));
  });

  it('gives the same policy wire name as its canonical form', () => {
    const hashOf = (text: string) =>
      computeContentHash({
        using: text,
        withCheck: text,
        roles: ['app_user'],
        operation: 'all',
        permissive: true,
      });
    expect(hashOf(written)).toBe(hashOf(canonical(written)));
  });
});
