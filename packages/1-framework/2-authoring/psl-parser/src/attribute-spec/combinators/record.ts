import { notOk, ok, type Result } from '@internal/utils/result';
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
      const diagnostics: PslDiagnostic[] = [];
      const entries: [string, T][] = [];
      const keys = new Set<string>();
      for (const field of Array.from(literal.fields())) {
        const key = field.keyName();
        if (key === undefined) {
          diagnostics.push(leafDiagnostic(ctx, field, 'Expected a key'));
          continue;
        }
        const value = field.value();
        if (value === undefined) {
          diagnostics.push(leafDiagnostic(ctx, field, `Expected a value for key "${key}"`));
          continue;
        }
        const parsed = of.parse(value, ctx);
        if (!parsed.ok) {
          diagnostics.push(...parsed.failure);
          continue;
        }
        if (keys.has(key)) {
          diagnostics.push(leafDiagnostic(ctx, field, `Duplicate key "${key}"`));
          continue;
        }
        keys.add(key);
        entries.push([key, parsed.value]);
      }
      if (diagnostics.length > 0) return notOk(diagnostics);
      return ok(Object.fromEntries(entries));
    },
  };
}
