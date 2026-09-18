import { describe, expect, it } from 'vitest';
import {
  canonicalizeTaggedLiteralBody,
  describeTaggedLiteralFailure,
  resolvePslBacktickEscapes,
  resolveTemplateTagEscapes,
  TAGGED_LITERAL_MAX_BYTES,
} from '../src/shared/tagged-literal';

const MAX_BYTES = 65536;

describe('canonicalizeTaggedLiteralBody', () => {
  it.each([
    ['single line unchanged', 'gen_random_uuid()', 'gen_random_uuid()'],
    [
      'a body containing a dollar-brace sequence passes through verbatim',
      'a $' + '{x} b',
      'a $' + '{x} b',
    ],
    ['CRLF becomes LF', 'a\r\nb', 'a\nb'],
    ['lone CR becomes LF', 'a\rb', 'a\nb'],
    ['blank first line dropped', '\n  a', 'a'],
    ['first line of only spaces and tabs dropped', ' \t\n  a', 'a'],
    ['blank last line dropped', 'a\n  ', 'a'],
    ['trailing newline dropped with the blank last line', 'a\n', 'a'],
    ['common leading whitespace removed', '  a\n    b', 'a\n  b'],
    ['tabs count as single characters', '\ta\n\t\tb', 'a\n\tb'],
    ['mixed tabs and spaces counted as characters', ' \ta\n \t  b', 'a\n  b'],
    ['internal blank line kept as an empty line', '  a\n\n  b', 'a\n\nb'],
    ['internal whitespace-only line kept as an empty line', '  a\n      \n  b', 'a\n\nb'],
    ['no trailing newline added', 'a\nb', 'a\nb'],
    ['blank first and last lines both dropped', '\n  select 1\n', 'select 1'],
    ['empty body stays empty', '', ''],
    ['whitespace-only body becomes empty', '  \n  ', ''],
  ])('%s', (_name, input, expected) => {
    expect(canonicalizeTaggedLiteralBody(input)).toEqual({ ok: true, body: expected });
  });

  it('fails on a NUL character with its offset', () => {
    expect(canonicalizeTaggedLiteralBody('ab\0c')).toEqual({ ok: false, reason: 'nul', offset: 2 });
  });

  it('accepts a body of exactly 65536 bytes', () => {
    expect(canonicalizeTaggedLiteralBody('a'.repeat(MAX_BYTES))).toEqual({
      ok: true,
      body: 'a'.repeat(MAX_BYTES),
    });
  });

  it('rejects a body of 65537 bytes', () => {
    expect(canonicalizeTaggedLiteralBody('a'.repeat(MAX_BYTES + 1))).toEqual({
      ok: false,
      reason: 'too-large',
      offset: MAX_BYTES,
    });
  });

  it('measures the limit in UTF-8 bytes, not characters', () => {
    const twoByteChars = 'é'.repeat(MAX_BYTES / 2 + 1);
    expect(canonicalizeTaggedLiteralBody(twoByteChars)).toEqual({
      ok: false,
      reason: 'too-large',
      offset: MAX_BYTES / 2,
    });
  });

  it('reports the too-large offset in the resolved text, like the other reasons', () => {
    const resolved = `\n  ${'a'.repeat(MAX_BYTES)}b\n`;
    expect(canonicalizeTaggedLiteralBody(resolved)).toEqual({
      ok: false,
      reason: 'too-large',
      offset: resolved.indexOf('b'),
    });
  });

  it('measures the size after dedenting', () => {
    const indented = `  ${'a'.repeat(MAX_BYTES)}`;
    expect(canonicalizeTaggedLiteralBody(indented)).toEqual({
      ok: true,
      body: 'a'.repeat(MAX_BYTES),
    });
  });
});

describe('resolvePslBacktickEscapes', () => {
  it.each([
    ['an escaped backtick', 'a\\`b', 'a`b'],
    ['an escaped backslash', 'a\\\\b', 'a\\b'],
    ['a dollar kept as written', '\\$1', '\\$1'],
    ['a dollar brace kept as written', `\\$${'{x}'}`, `\\$${'{x}'}`],
    ['any other backslash sequence kept as written', "E'\\n'", "E'\\n'"],
    ['a Windows path', "'C:\\users'", "'C:\\users'"],
    ['a trailing backslash', 'a\\', 'a\\'],
  ])('resolves %s', (_name, raw, resolved) => {
    expect(resolvePslBacktickEscapes(raw)).toBe(resolved);
  });
});

describe('resolveTemplateTagEscapes', () => {
  it.each([
    ['an escaped backtick', 'a\\`b', 'a`b'],
    ['an escaped backslash', 'a\\\\b', 'a\\b'],
    ['an escaped dollar', `\\$${'{x}'}`, `$${'{x}'}`],
    ['an escaped backslash before a dollar', '\\\\$x', '\\$x'],
    ['any other backslash sequence kept as written', "E'\\n'", "E'\\n'"],
    ['a Windows path', "'C:\\users'", "'C:\\users'"],
    ['a trailing backslash', 'a\\', 'a\\'],
  ])('resolves %s', (_name, raw, resolved) => {
    expect(resolveTemplateTagEscapes(raw)).toBe(resolved);
  });
});

describe('describeTaggedLiteralFailure', () => {
  it('names each reason with the message the combinator reports', () => {
    expect(describeTaggedLiteralFailure('nul')).toBe(
      'Tagged literals must not contain NUL characters.',
    );
    expect(describeTaggedLiteralFailure('too-large')).toBe(
      `Tagged literal exceeds ${TAGGED_LITERAL_MAX_BYTES} bytes.`,
    );
  });
});
