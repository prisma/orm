import type { Document } from '@internal/mongo-value';
import { notOk, ok, type Result } from '@internal/utils/result';

/** One selector of a JSON path: a member name, or the wildcard, which selects the elements of a list. */
export type JsonPathStep =
  | { readonly kind: 'member'; readonly name: string }
  | { readonly kind: 'wildcard' };

/** A JSON path in the grammar SQL's stored-key operations take: the RFC 9535 text and its selectors in order. */
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
 * Parses an RFC 9535 JSONPath that uses only member name selectors (`.street`, `['street']`) and
 * the wildcard selector (`[*]`, `.*`), the grammar SQL's stored-key operations take. Any other
 * JSONPath feature is refused with the reason.
 */
export function parseJsonPath(text: string): Result<JsonPath, string> {
  const unsupported = notOk(
    `path ${JSON.stringify(text)} is not a JSONPath of member names (.name or ['name']) and wildcards ([*] or .*) from $`,
  );
  const reader = new Reader(text);
  if (reader.next() !== '$') return unsupported;
  const steps: JsonPathStep[] = [];
  while (!reader.done) {
    reader.skipBlank();
    const char = reader.peek();
    let step: JsonPathStep | undefined;
    if (char === '.' && reader.peek(1) === '*') {
      reader.position += 2;
      step = { kind: 'wildcard' };
    } else if (char === '.') {
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

/** A key inside a root field's value: the steps from the field's value to the objects that hold it, and the key. */
export interface StoredKeyPath {
  /** The stored name of the root field. */
  readonly field: string;
  readonly path: JsonPath;
  readonly objects: readonly JsonPathStep[];
  readonly key: string;
}

/** The key path of `path` inside root field `field`, when the path ends at a member name. */
export function storedKeyPath(field: string, path: string): Result<StoredKeyPath, string> {
  const parsed = parseJsonPath(path);
  if (!parsed.ok) return parsed;
  const last = parsed.value.steps.at(-1);
  if (last?.kind !== 'member') {
    return notOk(`path ${JSON.stringify(path)} does not end at a key`);
  }
  return ok({
    field,
    path: parsed.value,
    objects: parsed.value.steps.slice(0, -1),
    key: last.name,
  });
}

/** The names of the keys a key path steps through and ends at. */
export function keysOf(keyPath: StoredKeyPath): readonly string[] {
  return keyPath.path.steps.flatMap((step) => (step.kind === 'member' ? [step.name] : []));
}

/** An aggregation expression: a field path or variable (`$addresses`, `$$element0`), or an operator document. */
export type Expression = string | Document;

/** A key's value in an object, read with `$getField` so the key is never read as a path or an operator. */
export function keyOf(object: Expression, key: string): Document {
  return { $getField: { field: { $literal: key }, input: object } };
}

/** Whether the object holds the key, `null` included. */
export function holdsKey(object: Expression, key: string): Document {
  return { $ne: [{ $type: keyOf(object, key) }, 'missing'] };
}

/** Whether the key is missing from the object or holds `null`. */
export function lacksKey(object: Expression, key: string): Document {
  return { $in: [{ $type: keyOf(object, key) }, ['missing', 'null']] };
}

function isOfType(value: Expression, type: 'object' | 'array'): Document {
  return { $eq: [{ $type: value }, type] };
}

/** Whether a value has the type the next step reads: a list for a wildcard, an object for a key. */
function walkable(value: Expression, steps: readonly JsonPathStep[]): Document {
  return isOfType(value, steps[0]?.kind === 'wildcard' ? 'array' : 'object');
}

function elementVariable(depth: number): string {
  return `element${depth}`;
}

/** The value of `value`, known to be walkable by `steps`, with each object at the end of `steps` rewritten. */
function rewritten(
  value: Expression,
  steps: readonly JsonPathStep[],
  rewrite: (object: Expression) => Document,
  depth: number,
): Expression {
  const [step, ...rest] = steps;
  if (step === undefined) return rewrite(value);
  const guarded = (child: Expression, childDepth: number) => ({
    $cond: [walkable(child, rest), rewritten(child, rest, rewrite, childDepth), child],
  });
  if (step.kind === 'wildcard') {
    const as = elementVariable(depth);
    return { $map: { input: value, as, in: guarded(`$$${as}`, depth + 1) } };
  }
  const child = keyOf(value, step.name);
  return {
    $cond: [
      walkable(child, rest),
      {
        $setField: {
          field: { $literal: step.name },
          input: value,
          value: rewritten(child, rest, rewrite, depth),
        },
      },
      value,
    ],
  };
}

/** Whether some object at the end of `steps`, inside `value` known to be walkable by them, satisfies `condition`. */
function anyObject(
  value: Expression,
  steps: readonly JsonPathStep[],
  condition: (object: Expression) => Document,
  depth: number,
): Document {
  const [step, ...rest] = steps;
  if (step === undefined) return condition(value);
  const guarded = (child: Expression, childDepth: number) => ({
    $cond: [walkable(child, rest), anyObject(child, rest, condition, childDepth), false],
  });
  if (step.kind === 'wildcard') {
    const as = elementVariable(depth);
    return { $anyElementTrue: [{ $map: { input: value, as, in: guarded(`$$${as}`, depth + 1) } }] };
  }
  return guarded(keyOf(value, step.name), depth);
}

/**
 * The update pipeline that rewrites each object at the key path's objects with `rewrite`. A missing
 * or `null` value, or a value of another type than the step expects, is left as it is.
 */
export function objectsRewritePipeline(
  keyPath: StoredKeyPath,
  rewrite: (object: Expression) => Document,
): readonly Document[] {
  const root = `$${keyPath.field}`;
  return [
    {
      $set: {
        [keyPath.field]: {
          $cond: [
            walkable(root, keyPath.objects),
            rewritten(root, keyPath.objects, rewrite, 0),
            root,
          ],
        },
      },
    },
  ];
}

/** The filter that matches the documents where some object at the key path's objects satisfies `condition`. */
export function documentsWithObject(
  keyPath: StoredKeyPath,
  condition: (object: Expression) => Document,
): Document {
  const root = `$${keyPath.field}`;
  return {
    $expr: {
      $cond: [
        walkable(root, keyPath.objects),
        anyObject(root, keyPath.objects, condition, 0),
        false,
      ],
    },
  };
}
