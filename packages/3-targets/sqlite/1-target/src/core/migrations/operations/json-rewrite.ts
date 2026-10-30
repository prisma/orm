import type { JsonPathStep } from '@internal/family-sql/control';
import { escapeLiteral } from '../../sql-utils';

/** Builds the JSON text a rewrite leaves at the end of a path, from the JSON text there and the depth of list elements. */
export type JsonLeaf = (value: string, depth: number) => string;

/** A test of the JSON text at the end of a path. */
export type JsonTest = (value: string, depth: number) => string;

/** The SQLite JSON path of member `name`, as an SQL string literal. */
export function memberPath(name: string): string {
  return `'${escapeLiteral(`$.${JSON.stringify(name)}`)}'`;
}

/** The SQL literal of a key, as `json_object` takes it. */
export function keyLiteral(name: string): string {
  return `'${escapeLiteral(name)}'`;
}

function element(list: string, depth: number): string {
  return `(${list} -> e${depth}.key)`;
}

/** A list rewritten element by element, keeping their order; `kept` filters the elements. */
export function rewrittenList(
  list: string,
  depth: number,
  rewrite: (element: string) => string,
  kept?: (element: string) => string,
): string {
  const e = `e${depth}`;
  const where = kept === undefined ? '' : ` WHERE ${kept(element(list, depth))}`;
  return `(SELECT json_group_array(json(${rewrite(element(list, depth))}) ORDER BY ${e}.key) FROM json_each(${list}) AS ${e}${where})`;
}

/** Whether some element of the list passes `test`. */
export function someElement(
  list: string,
  depth: number,
  test: (element: string) => string,
): string {
  return `EXISTS (SELECT 1 FROM json_each(${list}) AS e${depth} WHERE ${test(element(list, depth))})`;
}

/**
 * The JSON text that rewrites `value` along `steps` with `leaf`. A step that meets no object with
 * the member, or no list, leaves the value as it is.
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
    const member = memberPath(first.name);
    const inner = jsonRewrite(`(${value} -> ${member})`, rest, leaf, depth);
    return `CASE WHEN json_type(${value}) = 'object' AND json_type(${value}, ${member}) IS NOT NULL THEN json_set(${value}, ${member}, json(${inner})) ELSE ${value} END`;
  }
  return `CASE WHEN json_type(${value}) = 'array' THEN ${rewrittenList(value, depth, (e) => jsonRewrite(e, rest, leaf, depth + 1))} ELSE ${value} END`;
}

/**
 * Whether the JSON text `value` holds, at the end of `steps`, a value that passes `test`. Each step
 * tests the type of what it reads first, so a SQL `NULL`, a JSON `null`, a missing member, a value
 * of another type or a `null` list element never fails the match.
 */
export function jsonMatches(
  value: string,
  steps: readonly JsonPathStep[],
  test: JsonTest,
  depth = 0,
): string {
  const [first, ...rest] = steps;
  if (first === undefined) return test(value, depth);
  if (first.kind === 'member') {
    const member = memberPath(first.name);
    return `(json_type(${value}) = 'object' AND json_type(${value}, ${member}) IS NOT NULL AND ${jsonMatches(`(${value} -> ${member})`, rest, test, depth)})`;
  }
  return `(json_type(${value}) = 'array' AND ${someElement(value, depth, (e) => jsonMatches(e, rest, test, depth + 1))})`;
}

/** Whether the JSON text `value` is an object that has member `name`. */
export function hasMember(value: string, name: string): string {
  return `(json_type(${value}) = 'object' AND json_type(${value}, ${memberPath(name)}) IS NOT NULL)`;
}
