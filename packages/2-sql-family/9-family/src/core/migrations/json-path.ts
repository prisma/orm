import { notOk, ok, type Result } from '@internal/utils/result';

/** One selector of a JSON path: a member name, or the wildcard over the elements of a list. */
export type JsonPathStep =
  | { readonly kind: 'member'; readonly name: string }
  | { readonly kind: 'wildcard' };

/** A JSON path a migration operation acts at: the RFC 9535 text and its selectors in order. */
export interface JsonPath {
  readonly text: string;
  readonly steps: readonly JsonPathStep[];
}

const BLANK = new Set([' ', '\t', '\n', '\r']);

const ESCAPES: Readonly<Record<string, string>> = {
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  '/': '/',
  '\\': '\\',
};

function isNameFirst(char: string): boolean {
  return /^[A-Za-z_]$/.test(char) || (char.codePointAt(0) ?? 0) >= 0x80;
}

function isNameChar(char: string): boolean {
  return isNameFirst(char) || /^[0-9]$/.test(char);
}

class Reader {
  position = 0;
  constructor(readonly text: string) {}

  get done(): boolean {
    return this.position >= this.text.length;
  }

  peek(offset = 0): string {
    return this.text[this.position + offset] ?? '';
  }

  next(): string {
    const char = this.peek();
    this.position += 1;
    return char;
  }

  skipBlank(): void {
    while (BLANK.has(this.peek())) this.position += 1;
  }
}

function readShorthandName(reader: Reader): string | undefined {
  if (!isNameFirst(reader.peek())) return undefined;
  let name = '';
  while (!reader.done && isNameChar(reader.peek())) name += reader.next();
  return name;
}

function readStringLiteral(reader: Reader): string | undefined {
  const quote = reader.next();
  let value = '';
  while (!reader.done) {
    const char = reader.next();
    if (char === quote) return value;
    if (char !== '\\') {
      if ((char.codePointAt(0) ?? 0) < 0x20) return undefined;
      value += char;
      continue;
    }
    const escaped = reader.next();
    if (escaped === quote) {
      value += quote;
    } else if (escaped === 'u') {
      const hex = reader.text.slice(reader.position, reader.position + 4);
      if (!/^[0-9A-Fa-f]{4}$/.test(hex)) return undefined;
      reader.position += 4;
      value += String.fromCharCode(Number.parseInt(hex, 16));
    } else {
      const replacement = ESCAPES[escaped];
      if (replacement === undefined) return undefined;
      value += replacement;
    }
  }
  return undefined;
}

function readBracket(reader: Reader): JsonPathStep | undefined {
  reader.next();
  reader.skipBlank();
  let step: JsonPathStep | undefined;
  const first = reader.peek();
  if (first === '*') {
    reader.next();
    step = { kind: 'wildcard' };
  } else if (first === "'" || first === '"') {
    const name = readStringLiteral(reader);
    step = name === undefined ? undefined : { kind: 'member', name };
  }
  reader.skipBlank();
  return step !== undefined && reader.next() === ']' ? step : undefined;
}

/**
 * Parses an RFC 9535 JSONPath that uses only member name selectors (`.lat`, `['lat']`) and the
 * wildcard selector over list elements (`[*]`). Any other JSONPath feature is refused with the
 * reason.
 */
export function parseJsonPath(text: string): Result<JsonPath, string> {
  const unsupported = notOk(
    `path ${JSON.stringify(text)} is not a JSONPath of member names (.name or ['name']) and list wildcards ([*]) from $`,
  );
  const reader = new Reader(text);
  if (reader.next() !== '$') return unsupported;
  const steps: JsonPathStep[] = [];
  while (!reader.done) {
    reader.skipBlank();
    const char = reader.peek();
    let step: JsonPathStep | undefined;
    if (char === '.') {
      reader.next();
      const name = readShorthandName(reader);
      step = name === undefined ? undefined : { kind: 'member', name };
    } else if (char === '[') {
      step = readBracket(reader);
    }
    if (step === undefined) return unsupported;
    steps.push(step);
  }
  return ok({ text, steps });
}

/** A path that ends at a member name: the steps that reach the objects, and the key it ends at. */
export interface JsonKeyPath {
  readonly path: JsonPath;
  readonly objects: readonly JsonPathStep[];
  readonly key: string;
}

/** The path split at its last selector, when that selector is a member name. */
export function keyPathOf(path: JsonPath): JsonKeyPath | undefined {
  const last = path.steps.at(-1);
  return last?.kind === 'member'
    ? { path, objects: path.steps.slice(0, -1), key: last.name }
    : undefined;
}

/** The steps as a JSONPath: a member name in shorthand when it is an identifier, else in brackets. */
export function jsonPathText(steps: readonly JsonPathStep[]): string {
  return `$${steps
    .map((step) => {
      if (step.kind === 'wildcard') return '[*]';
      return /^[A-Za-z_][A-Za-z0-9_]*$/.test(step.name)
        ? `.${step.name}`
        : `[${JSON.stringify(step.name)}]`;
    })
    .join('')}`;
}
