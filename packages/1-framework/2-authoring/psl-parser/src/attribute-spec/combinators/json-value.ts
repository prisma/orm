import type { JsonValue } from '@internal/contract/types';
import { notOk, ok, type Result } from '@internal/utils/result';
import type { PslDiagnostic } from '../../diagnostic';
import { NumberLiteralExprAst } from '../../syntax/ast/expressions';
import { IdentifierAst } from '../../syntax/ast/identifier';
import type { AttributeCtx, JsonValueArgType } from '../types';
import { bool } from './bool';
import { leafDiagnostic } from './diagnostic';
import { list } from './list';
import { oneOf } from './one-of';
import { record } from './record';
import { str } from './str';

export function jsonValue(): JsonValueArgType<AttributeCtx> {
  const self: JsonValueArgType<AttributeCtx> = {
    kind: 'jsonValue',
    label: 'JSON value',
    parse: (arg, ctx): Result<JsonValue, readonly PslDiagnostic[]> => composed.parse(arg, ctx),
  };
  const composed = oneOf(str(), finiteNumber(), bool(), jsonNull(), list(self), record(self));
  return self;
}

function finiteNumber(): JsonValueArgType<AttributeCtx> {
  return {
    kind: 'jsonValue',
    label: 'number',
    parse: (arg, ctx): Result<JsonValue, readonly PslDiagnostic[]> => {
      const value = NumberLiteralExprAst.cast(arg.syntax)?.value();
      if (value === undefined || Number.isNaN(value) || !Number.isFinite(value)) {
        return notOk([leafDiagnostic(ctx, arg, 'Expected a finite number literal')]);
      }
      return ok(value);
    },
  };
}

function jsonNull(): JsonValueArgType<AttributeCtx> {
  return {
    kind: 'jsonValue',
    label: 'null',
    parse: (arg, ctx): Result<JsonValue, readonly PslDiagnostic[]> => {
      if (IdentifierAst.cast(arg.syntax)?.name() === 'null') return ok(null);
      return notOk([leafDiagnostic(ctx, arg, 'Expected null')]);
    },
  };
}
