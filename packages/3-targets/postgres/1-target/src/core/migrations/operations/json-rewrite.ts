import type { JsonPathStep } from '@internal/family-sql/control';
import { escapeLiteral } from '../../sql-utils';

/** Builds the `jsonb` value a rewrite leaves at the end of a path, from the value there and the depth of list elements. */
export type JsonLeaf = (value: string, depth: number) => string;

export function keyLiteral(name: string): string {
  return `'${escapeLiteral(name)}'`;
}

/**
 * The children of a list or an object rewritten one by one, keeping a list's order; `kept` filters
 * them. Any other value is left as it is.
 */
export function rewrittenChildren(
  value: string,
  depth: number,
  rewrite: (child: string) => string,
  kept?: (child: string) => string,
): string {
  const e = `e${depth}`;
  const where = kept === undefined ? '' : ` WHERE ${kept(`${e}.v`)}`;
  const rewritten = rewrite(`${e}.v`);
  const list = `(SELECT coalesce(jsonb_agg(${rewritten} ORDER BY ${e}.i), '[]'::jsonb) FROM jsonb_array_elements(${value}) WITH ORDINALITY AS ${e}(v, i)${where})`;
  const object = `(SELECT coalesce(jsonb_object_agg(${e}.k, ${rewritten}), '{}'::jsonb) FROM jsonb_each(${value}) AS ${e}(k, v)${where})`;
  return `CASE jsonb_typeof(${value}) WHEN 'array' THEN ${list} WHEN 'object' THEN ${object} ELSE ${value} END`;
}

/**
 * The `jsonb` expression that rewrites `value` along `steps` with `leaf`. A member step that meets
 * no object with the member, or a wildcard step that meets neither a list nor an object, leaves the
 * value as it is.
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
  return rewrittenChildren(value, depth, (child) => jsonRewrite(child, rest, leaf, depth + 1));
}

function jsonPathString(text: string): string {
  return JSON.stringify(text);
}

/** A typed strict SQL/JSON path filter that tests whether the object `@` has member `name`. */
export function hasMemberFilter(name: string): string {
  return `exists(@.keyvalue() ? (@.key == ${jsonPathString(name)}))`;
}

/** A typed strict SQL/JSON path filter that tests whether the object `@` has member `name` with a value other than JSON `null`. */
export function hasValueFilter(name: string): string {
  return `exists(@.keyvalue() ? (@.key == ${jsonPathString(name)} && @.value.type() != "null"))`;
}

/** A typed strict SQL/JSON path filter that tests whether member `name` of the object `@` equals `$v`. */
export function memberEqualsFilter(name: string): string {
  return `exists(@.keyvalue() ? (@.key == ${jsonPathString(name)} && @.value == $v))`;
}

const CONTAINER = '(@.type() == "array" || @.type() == "object")';

/** A strict SQL/JSON path filter that tests whether the list or object `@` has a child equal to `$v`. */
export const CHILD_EQUALS_FILTER = 'exists(@.**{1} ? (@ == $v))';

/**
 * Whether `column` holds, at the end of `steps`, an item that passes `filter`: an object, or with
 * `container`, a list or an object. Each step tests the type of the item it reads first, so a
 * SQL/JSON `null`, a missing member, a value of another type or a `null` element or member value
 * never fails the match or hides another item. A wildcard step reads every child, as `.**{1}` does:
 * the elements of a list and the member values of an object.
 */
export function jsonPathMatches(
  column: string,
  steps: readonly JsonPathStep[],
  type: 'object' | 'container',
  filter: string,
  valueParam?: string,
): string {
  const path = steps
    .map((step) =>
      step.kind === 'member'
        ? ` ? (@.type() == "object").keyvalue() ? (@.key == ${jsonPathString(step.name)}).value`
        : ` ? ${CONTAINER}.**{1}`,
    )
    .join('');
  const typeFilter = type === 'object' ? '@.type() == "object"' : CONTAINER;
  const jsonPath = `strict $${path} ? (${typeFilter} && ${filter})`;
  const vars = valueParam === undefined ? '' : `, jsonb_build_object('v', ${valueParam})`;
  return `jsonb_path_exists(${column}, '${escapeLiteral(jsonPath)}'${vars})`;
}
