import { describe, expect, it } from 'vitest';
import { hashContent } from '../src/hash-content';

describe('hashContent', () => {
  describe('output format', () => {
    it('produces a string prefixed with the algorithm tag', async () => {
      const digest = await hashContent('hello');
      expect(digest.startsWith('sha512:')).toBe(true);
    });

    it('produces a hex digest of exactly 128 characters after the prefix', async () => {
      const digest = await hashContent('hello');
      const hex = digest.slice('sha512:'.length);
      expect(hex).toMatch(/^[0-9a-f]{128}$/);
    });
  });

  describe('determinism', () => {
    it('returns the same digest for identical input across repeated calls', async () => {
      const input = 'abc|select 1|[42]';
      const first = await hashContent(input);
      const second = await hashContent(input);
      const third = await hashContent(input);
      expect(first).toBe(second);
      expect(second).toBe(third);
    });

    it('handles empty input deterministically', async () => {
      const a = await hashContent('');
      const b = await hashContent('');
      expect(a).toBe(b);
      expect(a).toMatch(/^sha512:[0-9a-f]{128}$/);
    });
  });

  describe('discrimination', () => {
    it('produces different digests for different inputs', async () => {
      expect(await hashContent('a')).not.toBe(await hashContent('b'));
      expect(await hashContent('select 1')).not.toBe(await hashContent('select 2'));
    });
  });

  describe('input handling', () => {
    it('handles UTF-8 multi-byte input', async () => {
      const digest = await hashContent('café — 日本語 — 🚀');
      expect(digest).toMatch(/^sha512:[0-9a-f]{128}$/);
    });

    it('discriminates between equivalent strings with different normalization', async () => {
      // U+00E9 (single composed code point) vs. U+0065 U+0301 (e + combining
      // acute accent). They render the same but are distinct byte sequences,
      // and hashContent hashes bytes — not normalized text.
      const composed = 'caf\u00e9';
      const decomposed = 'cafe\u0301';
      expect(await hashContent(composed)).not.toBe(await hashContent(decomposed));
    });
  });
});
