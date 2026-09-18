import { notOk, ok, type Result } from '@internal/utils/result';
import type { PslDiagnostic } from '../../diagnostic';
import { ArrayLiteralAst, type ExpressionAst } from '../../syntax/ast/expressions';
import type { ArgType, AttributeCtx, ListArgType } from '../types';
import { leafDiagnostic } from './diagnostic';

export interface ListOptions {
  readonly allowEmpty?: boolean;
  readonly unique?: boolean;
  /** How the list reads in an "expected one of" message. Defaults to the element label plus `[]`, which is unreadable when the element label is itself a list of alternatives. */
  readonly label?: string;
}

export function list<T, Ctx extends AttributeCtx>(
  of: ArgType<T, Ctx>,
  opts?: ListOptions,
): ListArgType<T, Ctx> {
  const allowEmpty = opts?.allowEmpty ?? true;
  const unique = opts?.unique ?? false;
  return {
    kind: 'list',
    label: opts?.label ?? `${of.label}[]`,
    of,
    allowEmpty,
    unique,
    parse: (arg, ctx): Result<T[], readonly PslDiagnostic[]> => {
      const literal = ArrayLiteralAst.cast(arg.syntax);
      if (literal === undefined) {
        return notOk([leafDiagnostic(ctx, arg, `Expected a list of ${of.label}`)]);
      }
      const diagnostics: PslDiagnostic[] = [];
      const parsed: { node: ExpressionAst; value: T }[] = [];
      let count = 0;
      for (const element of literal.elements()) {
        count += 1;
        const result = of.parse(element, ctx);
        if (result.ok) parsed.push({ node: element, value: result.value });
        else diagnostics.push(...result.failure);
      }
      if (!allowEmpty && count === 0) {
        diagnostics.push(leafDiagnostic(ctx, arg, 'Expected a non-empty list'));
      }
      if (unique) {
        const seen = new Set<T>();
        for (const { node, value } of parsed) {
          if (seen.has(value)) diagnostics.push(leafDiagnostic(ctx, node, 'Duplicate list entry'));
          else seen.add(value);
        }
      }
      if (diagnostics.length > 0) return notOk(diagnostics);
      return ok(parsed.map((entry) => entry.value));
    },
  };
}
