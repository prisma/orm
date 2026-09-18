/**
 * Every failure `offset` is an index into the resolved text the function was
 * given, including `too-large`, whose limit is measured on the canonical body.
 */
export type TaggedLiteralCanonicalization =
  | { readonly ok: true; readonly body: string }
  | {
      readonly ok: false;
      readonly reason: 'nul' | 'too-large';
      readonly offset: number;
    };

export const TAGGED_LITERAL_MAX_BYTES = 65536;

/** The message a tagged literal's canonicalization failure is reported with, in PSL and in TypeScript. */
export function describeTaggedLiteralFailure(reason: 'nul' | 'too-large'): string {
  switch (reason) {
    case 'nul':
      return 'Tagged literals must not contain NUL characters.';
    case 'too-large':
      return `Tagged literal exceeds ${TAGGED_LITERAL_MAX_BYTES} bytes.`;
  }
}

const BACKTICK_ESCAPES: ReadonlySet<string> = new Set(['`', '\\']);

/**
 * Resolves the escapes a backtick string understands, in PSL and in the TypeScript `sql` tag's raw
 * text: `` \` `` is a backtick and `\\` one backslash. Every other backslash sequence is kept as
 * written, both characters, so a SQL body may contain `E'\n'` unchanged.
 */
export function resolveBacktickEscapes(raw: string): string {
  let out = '';
  let i = 0;
  while (i < raw.length) {
    const ch = raw.charAt(i);
    const next = raw.charAt(i + 1);
    if (ch === '\\' && BACKTICK_ESCAPES.has(next)) {
      out += next;
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

const BLANK_LINE = /^[ \t]*$/;
const LEADING_INDENT = /^[ \t]*/;
const LINE_BREAK = /\r\n|\r|\n/g;

interface Line {
  readonly text: string;
  /** Where `text` starts in the resolved input. */
  readonly start: number;
}

/**
 * Turns the escape-resolved text of a tagged literal into its canonical body:
 * newlines become `\n`, a blank first and last line are dropped, common leading
 * whitespace is removed, internal blank lines become empty, and no trailing
 * newline is added. Fails on a NUL character or when the result is larger than
 * 65536 UTF-8 bytes.
 */
export function canonicalizeTaggedLiteralBody(resolved: string): TaggedLiteralCanonicalization {
  const nul = resolved.indexOf('\0');
  if (nul !== -1) {
    return { ok: false, reason: 'nul', offset: nul };
  }
  const lines = splitLines(resolved);
  if (lines.length > 0 && BLANK_LINE.test(lines[0]?.text ?? '')) {
    lines.shift();
  }
  if (lines.length > 0 && BLANK_LINE.test(lines.at(-1)?.text ?? '')) {
    lines.pop();
  }
  const indent = commonIndent(lines);
  const bodyLines = lines.map((line) =>
    BLANK_LINE.test(line.text)
      ? { text: '', start: line.start }
      : { text: line.text.slice(indent), start: line.start + indent },
  );
  const excess = offsetWhereBytesExceed(bodyLines, TAGGED_LITERAL_MAX_BYTES);
  if (excess !== undefined) {
    return { ok: false, reason: 'too-large', offset: excess };
  }
  return { ok: true, body: bodyLines.map((line) => line.text).join('\n') };
}

function splitLines(text: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  for (const match of text.matchAll(LINE_BREAK)) {
    lines.push({ text: text.slice(start, match.index), start });
    start = match.index + match[0].length;
  }
  lines.push({ text: text.slice(start), start });
  return lines;
}

function commonIndent(lines: readonly Line[]): number {
  let indent = Number.POSITIVE_INFINITY;
  for (const line of lines) {
    if (BLANK_LINE.test(line.text)) continue;
    indent = Math.min(indent, LEADING_INDENT.exec(line.text)?.[0].length ?? 0);
  }
  return Number.isFinite(indent) ? indent : 0;
}

/** The resolved-text offset of the first character that pushes the body past `limit` bytes. */
function offsetWhereBytesExceed(lines: readonly Line[], limit: number): number | undefined {
  let bytes = 0;
  for (const [index, line] of lines.entries()) {
    if (index > 0) {
      bytes += 1;
      if (bytes > limit) return line.start;
    }
    let offsetInLine = 0;
    for (const char of line.text) {
      bytes += utf8Length(char.codePointAt(0) ?? 0);
      if (bytes > limit) return line.start + offsetInLine;
      offsetInLine += char.length;
    }
  }
  return undefined;
}

function utf8Length(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
}
