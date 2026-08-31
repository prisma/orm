import type { PslDiagnostic } from '@internal/framework-components/psl-ast';
import { notOk, ok, type Result } from '@internal/utils/result';
import { ObjectLiteralExprAst } from '../../syntax/ast/expressions';
import type { ArgType } from '../types';
import { leafDiagnostic } from './diagnostic';

export function record<T>(of: ArgType<T>): ArgType<Record<string, T>> {
  return {
    kind: 'record',
    label: `{ [key]: ${of.label} }`,
    parse: (arg, ctx): Result<Record<string, T>, readonly PslDiagnostic[]> => {
      if (!(arg instanceof ObjectLiteralExprAst)) {
        return notOk([leafDiagnostic(ctx, arg, 'Expected an object literal')]);
      }
      const diagnostics: PslDiagnostic[] = [];
      const entries: [string, T][] = [];
      const keys = new Set<string>();
      for (const field of arg.fields()) {
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
