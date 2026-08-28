import type { PslDiagnostic } from '@internal/framework-components/psl-ast';
import { notOk, ok, type Result } from '@internal/utils/result';
import { ArrayLiteralAst, type ExpressionAst } from '../../syntax/ast/expressions';
import type { ArgType, BlockInterpretCtx } from '../types';
import { leafDiagnostic } from './diagnostic';

export interface ListOptions {
  readonly nonEmpty?: boolean;
  readonly unique?: boolean;
}

export function list<T, Ctx extends BlockInterpretCtx>(
  of: ArgType<T, Ctx>,
  opts?: ListOptions,
): ArgType<T[], Ctx> {
  return {
    kind: 'list',
    label: `${of.label}[]`,
    parse: (arg, ctx): Result<T[], readonly PslDiagnostic[]> => {
      const array = ArrayLiteralAst.cast(arg.syntax);
      if (array === undefined) {
        return notOk([leafDiagnostic(ctx, arg, `Expected a list of ${of.label}`)]);
      }
      const diagnostics: PslDiagnostic[] = [];
      const parsed: { node: ExpressionAst; value: T }[] = [];
      let count = 0;
      for (const element of array.elements()) {
        count += 1;
        const result = of.parse(element, ctx);
        if (result.ok) parsed.push({ node: element, value: result.value });
        else diagnostics.push(...result.failure);
      }
      if (opts?.nonEmpty === true && count === 0) {
        diagnostics.push(leafDiagnostic(ctx, arg, 'Expected a non-empty list'));
      }
      if (opts?.unique === true) {
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
