import { and, notOk, ok, okVoid, type Result } from '@internal/utils/result';
import type { PslDiagnostic } from '../../diagnostic';
import { ObjectLiteralExprAst } from '../../syntax/ast/expressions';
import type { ArgType, AttributeCtx, RecordArgType } from '../types';
import { leafDiagnostic } from './diagnostic';

export function record<T, Ctx extends AttributeCtx>(of: ArgType<T, Ctx>): RecordArgType<T, Ctx> {
  return {
    kind: 'record',
    label: `{ [key]: ${of.label} }`,
    of,
    parse: (arg, ctx): Result<Record<string, T>, readonly PslDiagnostic[]> => {
      const literal = ObjectLiteralExprAst.cast(arg.syntax);
      if (literal === undefined) {
        return notOk([leafDiagnostic(ctx, arg, 'Expected an object literal')]);
      }
      const entries: [string, T][] = [];
      const keys = new Set<string>();
      let outcome: Result<void, readonly PslDiagnostic[]> = okVoid();
      for (const field of Array.from(literal.fields())) {
        const key = field.keyName();
        if (key === undefined) {
          outcome = and(outcome, notOk([leafDiagnostic(ctx, field, 'Expected a key')]));
          continue;
        }
        const value = field.value();
        if (value === undefined) {
          outcome = and(
            outcome,
            notOk([leafDiagnostic(ctx, field, `Expected a value for key "${key}"`)]),
          );
          continue;
        }
        const parsed = of.parse(value, ctx);
        if (!parsed.ok) {
          outcome = and(outcome, parsed);
          continue;
        }
        if (keys.has(key)) {
          outcome = and(outcome, notOk([leafDiagnostic(ctx, field, `Duplicate key "${key}"`)]));
          continue;
        }
        keys.add(key);
        entries.push([key, parsed.value]);
      }
      if (!outcome.ok) return notOk(outcome.failure);
      return ok(Object.fromEntries(entries));
    },
  };
}
