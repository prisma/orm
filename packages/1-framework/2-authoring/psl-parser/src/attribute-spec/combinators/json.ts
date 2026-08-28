import type { PslDiagnostic } from '@internal/framework-components/psl-ast';
import { blindCast } from '@internal/utils/casts';
import { notOk, ok, type Result } from '@internal/utils/result';
import { StringLiteralExprAst } from '../../syntax/ast/expressions';
import type { ArgType, BlockInterpretCtx } from '../types';
import { leafDiagnostic } from './diagnostic';

/**
 * Reads an opaque JSON object from a quoted JSON string — the ADR's one text-encoded surface
 * exception (e.g. an index `filter` / `weights` argument). The string is decoded by the parser,
 * then JSON-parsed; a non-object (array/scalar) or invalid JSON is a diagnostic.
 */
export function json(): ArgType<Record<string, unknown>, BlockInterpretCtx> {
  return {
    kind: 'json',
    label: 'JSON object',
    parse: (arg, ctx): Result<Record<string, unknown>, readonly PslDiagnostic[]> => {
      const literal = StringLiteralExprAst.cast(arg.syntax);
      if (literal === undefined) {
        return notOk([leafDiagnostic(ctx, arg, 'Expected a JSON object string')]);
      }
      const raw = literal.value();
      if (raw !== undefined) {
        try {
          const parsed: unknown = JSON.parse(raw);
          if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            return ok(
              blindCast<
                Record<string, unknown>,
                'JSON.parse of a validated non-array object literal is a string-keyed record'
              >(parsed),
            );
          }
        } catch {
          // fall through to the diagnostic
        }
      }
      return notOk([leafDiagnostic(ctx, arg, 'Expected a valid JSON object')]);
    },
  };
}
