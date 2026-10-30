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

function child(value: string, depth: number): string {
  return `(${value} -> e${depth}.fullkey)`;
}

/**
 * The children of a list or an object rewritten one by one, keeping their order; `kept` filters
 * them. Any other value is left as it is.
 */
export function rewrittenChildren(
  value: string,
  depth: number,
  rewrite: (child: string) => string,
  kept?: (child: string) => string,
): string {
  const e = `e${depth}`;
  const each = `FROM json_each(${value}) AS ${e}${kept === undefined ? '' : ` WHERE ${kept(child(value, depth))}`}`;
  const rewritten = `json(${rewrite(child(value, depth))})`;
  return `CASE json_type(${value}) WHEN 'array' THEN (SELECT json_group_array(${rewritten} ORDER BY ${e}.key) ${each}) WHEN 'object' THEN (SELECT json_group_object(${e}.key, ${rewritten} ORDER BY ${e}.id) ${each}) ELSE ${value} END`;
}

/** Whether `value` is a list or an object with a child that passes `test`. */
export function someChild(value: string, depth: number, test: (child: string) => string): string {
  return `(json_type(${value}) IN ('array', 'object') AND EXISTS (SELECT 1 FROM json_each(${value}) AS e${depth} WHERE ${test(child(value, depth))}))`;
}

/**
 * The JSON text that rewrites `value` along `steps` with `leaf`. A member step that meets no object
 * with the member, or a wildcard step that meets neither a list nor an object, leaves the value as
 * it is.
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
  return rewrittenChildren(value, depth, (c) => jsonRewrite(c, rest, leaf, depth + 1));
}

/**
 * Whether the JSON text `value` holds, at the end of `steps`, a value that passes `test`. Each step
 * tests the type of what it reads first, so a SQL `NULL`, a JSON `null`, a missing member, a value
 * of another type, or a `null` element or member value never fails the match.
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
  return someChild(value, depth, (c) => jsonMatches(c, rest, test, depth + 1));
}

/** Whether the JSON text `value` is an object that has member `name`. */
export function hasMember(value: string, name: string): string {
  return `(json_type(${value}) = 'object' AND json_type(${value}, ${memberPath(name)}) IS NOT NULL)`;
}
