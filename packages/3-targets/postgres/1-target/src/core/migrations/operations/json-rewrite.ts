import type { JsonPathStep } from '@internal/family-sql/control';
import { escapeLiteral } from '../../sql-utils';

/** Builds the `jsonb` value a rewrite leaves at the end of a path, from the value there and the depth of list elements. */
export type JsonLeaf = (value: string, depth: number) => string;

export function keyLiteral(name: string): string {
  return `'${escapeLiteral(name)}'`;
}

function elementsOf(value: string, depth: number): string {
  return `jsonb_array_elements(${value}) WITH ORDINALITY AS e${depth}(v, i)`;
}

/** A list rewritten element by element, keeping their order; `kept` filters the elements. */
export function rewrittenList(
  value: string,
  depth: number,
  element: (element: string) => string,
  kept?: (element: string) => string,
): string {
  const e = `e${depth}`;
  const where = kept === undefined ? '' : ` WHERE ${kept(`${e}.v`)}`;
  return `(SELECT coalesce(jsonb_agg(${element(`${e}.v`)} ORDER BY ${e}.i), '[]'::jsonb) FROM ${elementsOf(value, depth)}${where})`;
}

/**
 * The `jsonb` expression that rewrites `value` along `steps` with `leaf`. A step that meets no
 * object with the member, or no list, leaves the value as it is.
 */
export function jsonRewrite(
  value: string,
  steps: readonly JsonPathStep[],
  leaf: JsonLeaf,
  depth = 0,
): string {
  const [first, ...rest] = steps;
  if (first === undefined) return leaf(value, depth);
  if (first.kind === 'member') {
    const key = keyLiteral(first.name);
    const inner = jsonRewrite(`(${value} -> ${key})`, rest, leaf, depth);
    return `CASE WHEN jsonb_typeof(${value}) = 'object' AND ${value} ? ${key} THEN jsonb_set(${value}, ARRAY[${key}], ${inner}) ELSE ${value} END`;
  }
  return `CASE WHEN jsonb_typeof(${value}) = 'array' THEN ${rewrittenList(value, depth, (element) => jsonRewrite(element, rest, leaf, depth + 1))} ELSE ${value} END`;
}

function jsonPathString(text: string): string {
  return JSON.stringify(text);
}

/** A typed strict SQL/JSON path filter that tests whether the object `@` has member `name`. */
export function hasMemberFilter(name: string): string {
  return `exists(@.keyvalue() ? (@.key == ${jsonPathString(name)}))`;
}

/** A typed strict SQL/JSON path filter that tests whether member `name` of the object `@` equals `$v`. */
export function memberEqualsFilter(name: string): string {
  return `exists(@.keyvalue() ? (@.key == ${jsonPathString(name)} && @.value == $v))`;
}

/**
 * Whether `column` holds, at the end of `steps`, an item of type `type` that passes `filter`. Each
 * step tests the type of the item it reads first, so a SQL/JSON `null`, a missing member, a value
 * of another type or a `null` list element never fails the match or hides another item.
 */
export function jsonPathMatches(
  column: string,
  steps: readonly JsonPathStep[],
  type: 'object' | 'array',
  filter: string,
  valueParam?: string,
): string {
  const path = steps
    .map((step) =>
      step.kind === 'member'
        ? ` ? (@.type() == "object").keyvalue() ? (@.key == ${jsonPathString(step.name)}).value`
        : ' ? (@.type() == "array")[*]',
    )
    .join('');
  const jsonPath = `strict $${path} ? (@.type() == "${type}" && ${filter})`;
  const vars = valueParam === undefined ? '' : `, jsonb_build_object('v', ${valueParam})`;
  return `jsonb_path_exists(${column}, '${escapeLiteral(jsonPath)}'${vars})`;
}
