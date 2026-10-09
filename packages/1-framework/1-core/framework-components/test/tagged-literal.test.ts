import { describe, expect, it } from 'vitest';
import {
  canonicalizeTaggedLiteralBody,
  describeTaggedLiteralFailure,
  printedTaggedLiteralReadsBack,
  printTaggedLiteral,
  renderTaggedTemplateSource,
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
    ['every blank first line dropped', '\n\n  \n  a', 'a'],
    ['first line of only spaces and tabs dropped', ' \t\n  a', 'a'],
    ['blank last line dropped', 'a\n  ', 'a'],
    ['every blank last line dropped', 'a\n\n  \n', 'a'],
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
    expect(canonicalizeTaggedLiteralBody(input)).toEqual({ ok: true, text: expected });
  });

  it('fails on a NUL character with its offset', () => {
    expect(canonicalizeTaggedLiteralBody('ab\0c')).toEqual({ ok: false, reason: 'nul', offset: 2 });
  });

  it('accepts a body of exactly 65536 bytes', () => {
    expect(canonicalizeTaggedLiteralBody('a'.repeat(MAX_BYTES))).toEqual({
      ok: true,
      text: 'a'.repeat(MAX_BYTES),
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
      text: 'a'.repeat(MAX_BYTES),
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

describe('printTaggedLiteral', () => {
  it('prints a single-line text between backticks', () => {
    expect(printTaggedLiteral('sql', 'gen_random_uuid()')).toBe('sql`gen_random_uuid()`');
  });

  it('prints a multi-line text on its own lines', () => {
    expect(printTaggedLiteral('sql', "(now()\n  + '1 day'::interval)")).toBe(
      "sql`\n(now()\n  + '1 day'::interval)\n`",
    );
  });

  it('doubles a backslash in the backtick form', () => {
    expect(printTaggedLiteral('sql', "E'a\\nb'")).toBe("sql`E'a\\\\nb'`");
  });

  it('prints a text holding a backtick in the double-quote form', () => {
    expect(printTaggedLiteral('json', '{"a":"`"}')).toBe('json"{\\"a\\":\\"`\\"}"');
  });

  it('escapes a backslash, a line break and a carriage return in the double-quote form', () => {
    expect(printTaggedLiteral('sql', 'a`\\\nb\rc')).toBe('sql"a`\\\\\\nb\\rc"');
  });

  it.each([
    ['single-line', 'md5(random()::text)'],
    ['multi-line', "(now()\n  + '1 day'::interval)"],
    ['a backslash', "E'a\\nb'"],
    ['an internal empty line', 'a\n\nb'],
  ])('reads %s text back unchanged from the backtick form', (_name, text) => {
    const printed = printTaggedLiteral('sql', text);
    const raw = printed.slice('sql`'.length, -1);
    expect(canonicalizeTaggedLiteralBody(resolvePslBacktickEscapes(raw))).toEqual({
      ok: true,
      text: text,
    });
  });

  it('reads a multi-line text back unchanged after every continuation line was indented', () => {
    const text = "(now()\n  + '1 day'::interval)";
    const indented = printTaggedLiteral('sql', text).split('\n').join('\n    ');
    const raw = indented.slice('sql`'.length, -1);
    expect(canonicalizeTaggedLiteralBody(resolvePslBacktickEscapes(raw))).toEqual({
      ok: true,
      text: text,
    });
  });
});

describe('printedTaggedLiteralReadsBack', () => {
  it.each([
    ['a single line', 'a = 1', true],
    ['several lines', 'a = 1\n  AND b = 2', true],
    ['an empty text', '', true],
    ['indented text', '  a = 1', false],
    ['a blank first line', '\na = 1', false],
    ['a blank last line', 'a = 1\n', false],
    ['a whitespace-only inner line', 'a = 1\n  \nAND b = 2', false],
    ['a carriage return', 'a = 1\r\nAND b = 2', false],
    ['a NUL character', 'a\u0000', false],
  ])('%s reads back: %s', (_, text, expected) => {
    expect(printedTaggedLiteralReadsBack(text)).toBe(expected);
  });
});

const CANONICALIZATION_CASES = [
  '\n\n(a > 0)',
  '(a > 0)\n\n',
  '\n  \n(a > 0)',
  '  a\n\n    b\n',
  '\r\n\r\n(a)',
  '\n\n\n',
  '  a\n\n  b',
  'a\r\n\r\nb',
  '\n\n  SELECT 1\n\n',
  '\n\n  `a`\n  \n',
];

function canonical(text: string): string {
  const result = canonicalizeTaggedLiteralBody(text);
  if (!result.ok) throw new Error(`${JSON.stringify(text)} does not canonicalize`);
  return result.text;
}

function readPrintedLiteral(printed: string): string {
  const body = printed.slice('sql'.length);
  return body.startsWith('`')
    ? resolvePslBacktickEscapes(body.slice(1, -1))
    : (JSON.parse(body) as string);
}

describe('the canonical text', () => {
  it.each(CANONICALIZATION_CASES.map((text) => [JSON.stringify(text), text]))(
    'of %s is unchanged by canonicalizing it again',
    (_name, text) => {
      expect(canonical(canonical(text))).toBe(canonical(text));
    },
  );

  it.each(CANONICALIZATION_CASES.map((text) => [JSON.stringify(text), text]))(
    'of %s reads back unchanged once printed',
    (_name, text) => {
      const text0 = canonical(text);
      expect(canonical(readPrintedLiteral(printTaggedLiteral('sql', text0)))).toBe(text0);
      expect(printedTaggedLiteralReadsBack(text0)).toBe(true);
    },
  );
});

describe('printedTaggedLiteralReadsBack', () => {
  it.each([
    ['single-line', 'md5(random()::text)'],
    ['multi-line', "(now()\n  + '1 day'::interval)"],
    ['a backtick', 'a `b`'],
    ['a backslash', 'a\\b'],
    ['a dollar-brace sequence', 'a $' + '{x} b'],
  ])('holds for %s text', (_name, text) => {
    expect(printedTaggedLiteralReadsBack(text)).toBe(true);
  });

  it.each([
    ['leading indentation', '  select 1'],
    ['a blank first line of spaces', '  \nselect 1'],
    ['a carriage return', 'a\rb'],
    ['a NUL character', 'a\0b'],
    ['leading indentation in the double-quote form', '  a `b`'],
  ])('fails for text with %s, which the literal canonicalizes away', (_name, text) => {
    expect(printedTaggedLiteralReadsBack(text)).toBe(false);
  });
});

describe('renderTaggedTemplateSource', () => {
  function readBackIndented(source: string, tag: string, indent: string): string | undefined {
    const raw = source.slice(tag.length + 1, -1);
    const indented = raw
      .split('\n')
      .map((line) => (line.trim() ? `${indent}${line}` : line))
      .join('\n');
    const canonical = canonicalizeTaggedLiteralBody(resolveTemplateTagEscapes(indented));
    return canonical.ok ? canonical.text : undefined;
  }

  it.each([
    ['one line', 'now()', 'sql`now()`'],
    ['both quote kinds', `"kind" IN ('a', 'b')`, `sql\`"kind" IN ('a', 'b')\``],
    ['several lines', 'a > 0\n  AND b < 1', 'sql`\na > 0\n  AND b < 1\n`'],
    ['an internal empty line', 'a > 0\n\nAND b', 'sql`\na > 0\n\nAND b\n`'],
    ['a tab', 'a\t> 0', 'sql`a\t> 0`'],
    ['a backtick', 'a = `b`', 'sql`a = \\`b\\``'],
    ['a backslash', "E'\\n' <> x", "sql`E'\\\\n' <> x`"],
    ['a dollar brace', 'a $' + '{x}', 'sql`a \\$' + '{x}`'],
  ])('prints %s as a template the tag reads back unchanged', (_name, text, source) => {
    const rendered = renderTaggedTemplateSource('sql', text);

    expect(rendered).toEqual({ source, usesTag: true });
    expect(readBackIndented(rendered.source, 'sql', '      ')).toBe(text);
  });

  it.each([
    ['leading whitespace', '  now()', '"  now()"'],
    ['a blank first line', '\nnow()', '"\\nnow()"'],
    ['a trailing blank line', 'now()\n', '"now()\\n"'],
    ['a whitespace-only line', 'a\n  \nb', '"a\\n  \\nb"'],
    ['a carriage return', 'a\r\nb', '"a\\r\\nb"'],
    ['a line holding only a non-breaking space', 'a\n \nb', '"a\\n \\nb"'],
    ['a lone surrogate', 'a\ud800b', '"a\\ud800b"'],
    ['a control character', 'a\u0007b', '"a\\u0007b"'],
    ['DEL', 'a\u007fb', '"a\\x7fb"'],
    ['U+2028', 'a b', '"a\\u2028b"'],
    ['U+2029', 'a b', '"a\\u2029b"'],
    ['a NUL character', 'a\u0000b', '"a\\u0000b"'],
  ])('falls back to a string literal for %s', (_name, text, source) => {
    expect(renderTaggedTemplateSource('sql', text)).toEqual({ source, usesTag: false });
  });

  it('falls back to an untagged template for text with both quote kinds the tag cannot hold', () => {
    expect(renderTaggedTemplateSource('sql', ` "a" = 'b'`)).toEqual({
      source: `\` "a" = 'b'\``,
      usesTag: false,
    });
  });
});
