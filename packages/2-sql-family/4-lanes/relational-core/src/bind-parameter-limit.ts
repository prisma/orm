import type { AnyQueryAst } from './ast/types';
import { collectOrderedParamRefs } from './ast/util';

const targetNames: Record<string, string> = { mysql: 'MySQL', postgres: 'PostgreSQL' };

/** The name a message about a target's own limit uses, e.g. `PostgreSQL` for `postgres`. */
export function targetDisplayNameOf(target: string): string {
  return targetNames[target] ?? target;
}

/**
 * The bind parameters one statement may carry on a target whose wire protocol or server fixes that number: PostgreSQL numbers a Bind message's parameters in a 16-bit field and MySQL allows 65,535 placeholders per statement, and both reject a statement past the limit with an error that reads as a broken connection. SQLite's limit is a compile-time option of the bundled engine, so no number is declared for it here.
 */
export function bindParameterLimitOfTarget(target: string): number | undefined {
  return target === 'postgres' || target === 'mysql' ? 65_535 : undefined;
}

/**
 * The bind parameters `ast` occupies in one statement on `target`: the number its limit counts. PostgreSQL numbers a parameter reference once and writes that `$N` wherever the statement repeats it, so a reference that several rows share is bound once. MySQL takes only positional parameters, and its driver writes a repeated reference as one `?` per occurrence with the value repeated, so there every occurrence is bound.
 */
export function bindParameterCountOf(ast: AnyQueryAst, target: string): number {
  return (target === 'mysql' ? ast.collectParamRefs() : collectOrderedParamRefs(ast)).length;
}
