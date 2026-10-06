import { describe, expect, it } from 'vitest';

import { tsQuotedTextSource, tsStringLiteral } from '../src/ts-string-literal';

describe('tsStringLiteral', () => {
  it('escapes DEL', () => {
    expect(tsStringLiteral('a\u007fb')).toBe('"a\\x7fb"');
  });
});

describe('tsQuotedTextSource', () => {
  describe('text holding both quote kinds on one line', () => {
    it('renders an untagged template literal without escaping either quote', () => {
      expect(tsQuotedTextSource(`"kind" IN ('admin', 'user')`)).toBe(
        "`\"kind\" IN ('admin', 'user')`",
      );
    });

    it('escapes a backtick inside the template', () => {
      expect(tsQuotedTextSource('"a" = \'`b`\'')).toBe('`"a" = \'\\`b\\`\'`');
    });

    it('escapes a backslash inside the template', () => {
      expect(tsQuotedTextSource(`"a" ~ '\\d'`)).toBe('`"a" ~ \'\\\\d\'`');
    });

    it('escapes an interpolation opener inside the template', () => {
      expect(tsQuotedTextSource(`"a" = '\${b}'`)).toBe(`\`"a" = '\\\${b}'\``);
    });

    it('keeps a template literal for text holding a surrogate pair', () => {
      expect(tsQuotedTextSource(`"a" = '\u{1f600}'`)).toBe(`\`"a" = '\u{1f600}'\``);
    });
  });

  describe('text rendered as a string literal', () => {
    it('renders text with only single quotes as a string literal', () => {
      expect(tsQuotedTextSource("status = 'active'")).toBe('"status = \'active\'"');
    });

    it('renders text with only double quotes as a string literal', () => {
      expect(tsQuotedTextSource('"status" IS NOT NULL')).toBe('"\\"status\\" IS NOT NULL"');
    });

    it('renders text without quotes as a string literal', () => {
      expect(tsQuotedTextSource('now()')).toBe('"now()"');
    });

    it('renders text with both quote kinds and a line feed as a string literal', () => {
      expect(tsQuotedTextSource(`"a" = 'b'\nAND true`)).toBe('"\\"a\\" = \'b\'\\nAND true"');
    });

    it('renders text with both quote kinds and a carriage return as a string literal', () => {
      expect(tsQuotedTextSource(`"a" = 'b'\rAND true`)).toBe('"\\"a\\" = \'b\'\\rAND true"');
    });

    it('renders text with both quote kinds and U+2028 as a string literal', () => {
      expect(tsQuotedTextSource(`"a" = 'b'\u2028`)).toBe('"\\"a\\" = \'b\'\\u2028"');
    });

    it('renders text with both quote kinds and U+2029 as a string literal', () => {
      expect(tsQuotedTextSource(`"a" = 'b'\u2029`)).toBe('"\\"a\\" = \'b\'\\u2029"');
    });

    it('renders text with both quote kinds and a tab as a string literal', () => {
      expect(tsQuotedTextSource(`"a" =\t'b'`)).toBe('"\\"a\\" =\\t\'b\'"');
    });

    it('renders text with both quote kinds and a NUL as a string literal', () => {
      expect(tsQuotedTextSource(`"a" = 'b\u0000'`)).toBe('"\\"a\\" = \'b\\u0000\'"');
    });

    it('renders text with both quote kinds and DEL as a string literal', () => {
      expect(tsQuotedTextSource(`"a" = 'b\u007f'`)).toBe('"\\"a\\" = \'b\\x7f\'"');
    });

    it('renders text with both quote kinds and a lone surrogate as a string literal', () => {
      expect(tsQuotedTextSource(`"a" = '\ud800'`)).toBe('"\\"a\\" = \'\\ud800\'"');
    });

    it('renders text with both quote kinds and a lone low surrogate as a string literal', () => {
      expect(tsQuotedTextSource(`"a" = '\udc00'`)).toBe('"\\"a\\" = \'\\udc00\'"');
    });
  });
});
