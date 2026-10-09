/**
 * Puts the lines of each multi-line tagged template one level deeper than the line the template opens on, and its
 * closing backtick at that line's level. Prettier keeps a template's text as written, so without this a template keeps
 * the indentation the renderer gave it while prettier moves the code around it.
 *
 * Only a template that opens with a line break and closes on a line of its own is moved. Generated migration files write
 * such a template only with a tag that removes the shared indentation of its lines, so its value does not change.
 * Returns `source` unchanged when a line holds a construct this reader does not follow.
 */
export function indentTaggedTemplates(source: string): string {
  const lines = source.split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    const ending = lineEnding(line);
    if (ending === 'code') {
      out.push(line);
      i++;
      continue;
    }
    if (ending === 'unknown') return source;
    const closing = findClosingLine(lines, i + 1);
    if (closing === undefined) return source;
    const closingText = (lines[closing] ?? '').trimStart();
    if (lineEnding(closingText.slice(1)) !== 'code') return source;
    out.push(line, ...reindent(lines.slice(i + 1, closing), indentOf(line)));
    out.push(`${indentOf(line)}${closingText}`);
    i = closing + 1;
  }
  return out.join('\n');
}

const LINE_INDENT = /^[ \t]*/;
const TAG_CHARACTER = /[\w$]/;

function indentOf(line: string): string {
  return LINE_INDENT.exec(line)?.[0] ?? '';
}

/** `opens-template` when the line ends with a tagged template's opening backtick, `code` when it ends outside any literal. */
function lineEnding(line: string): 'code' | 'opens-template' | 'unknown' {
  if (line.startsWith('#!')) return 'code';
  let quote: string | undefined;
  for (let at = 0; at < line.length; at++) {
    const char = line.charAt(at);
    if (quote !== undefined) {
      if (char === '\\') at++;
      else if (quote === '`' && char === '$' && line.charAt(at + 1) === '{') return 'unknown';
      else if (char === quote) quote = undefined;
      continue;
    }
    if (char === '/' && line.charAt(at + 1) === '/') return 'code';
    if (char === '/' && line.charAt(at + 1) === '*') return 'unknown';
    if (char === "'" || char === '"') quote = char;
    if (char === '`') {
      const isLast = at === line.length - 1;
      if (isLast && TAG_CHARACTER.test(line.charAt(at - 1))) return 'opens-template';
      quote = char;
    }
  }
  return quote === undefined ? 'code' : 'unknown';
}

/** The line that closes the template whose body starts at `from`: the first line whose text is a backtick after indentation. */
function findClosingLine(lines: readonly string[], from: number): number | undefined {
  for (let at = from; at < lines.length; at++) {
    const line = lines[at] ?? '';
    const body = line.trimStart();
    if (body.startsWith('`')) return at;
    if (unescapedBacktickOrInterpolation(line)) return undefined;
  }
  return undefined;
}

function unescapedBacktickOrInterpolation(line: string): boolean {
  for (let at = 0; at < line.length; at++) {
    const char = line.charAt(at);
    if (char === '\\') at++;
    else if (char === '`' || (char === '$' && line.charAt(at + 1) === '{')) return true;
  }
  return false;
}

function reindent(body: readonly string[], openingIndent: string): string[] {
  const nonEmpty = body.filter((line) => line.length > 0);
  if (nonEmpty.some((line) => line.trim().length === 0)) return [...body];
  const shared = Math.min(...nonEmpty.map((line) => indentOf(line).length));
  return body.map((line) => (line.length === 0 ? line : `${openingIndent}  ${line.slice(shared)}`));
}
