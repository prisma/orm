import { InternalError } from '@internal/utils/internal-error';
import { notOk, ok, type Result } from '@internal/utils/result';
import type { PslDiagnostic } from '../../diagnostic';
import type { ExpressionAst } from '../../syntax/ast/expressions';
import { FunctionCallAst } from '../../syntax/ast/expressions';
import { IdentifierAst } from '../../syntax/ast/identifier';
import type {
  FieldAttributeCtx,
  FieldRefArgType,
  ModelAttributeCtx,
  ReferencedFieldRefArgType,
} from '../types';
import { leafDiagnostic } from './diagnostic';

/**
 * A function call where a field name belongs is almost always a Prisma-style
 * sort annotation (`field(sort: Desc)`). Name the real problem — arguments
 * are not accepted in field lists — instead of the cryptic "Expected a field
 * name".
 */
function fieldNameProblem(arg: ExpressionAst): string {
  const call = FunctionCallAst.cast(arg.syntax);
  const callee = call?.path() ?? [];
  if (callee.length === 1 && callee[0] !== undefined) {
    return (
      `Expected a bare field name, but found "${callee[0]}(...)" — ` +
      'field lists do not accept arguments, so (sort: Asc/Desc) is not supported here.'
    );
  }
  return 'Expected a field name';
}

function parseFieldName(
  arg: ExpressionAst,
  ctx: ModelAttributeCtx,
): Result<string, readonly PslDiagnostic[]> {
  const identifier = IdentifierAst.cast(arg.syntax);
  if (identifier === undefined) {
    return notOk([leafDiagnostic(ctx, arg, fieldNameProblem(arg))]);
  }
  const name = identifier.name();
  if (name === undefined) {
    return notOk([leafDiagnostic(ctx, arg, 'Expected a field name')]);
  }
  const resolution = ctx.binder.symbolForNode(arg.syntax);
  if (resolution === undefined) {
    throw new InternalError(
      `The binder on this attribute context bound nothing for "${name}". A reference argument is always examined, so the binder must be built over the same snapshot - the same symbol table and sources - as the interpretation consuming it.`,
    );
  }
  if (resolution.kind === 'field') return ok(resolution.symbol.name);
  if (resolution.kind === 'crossSpace') return ok(name);
  return notOk([]);
}

export function fieldRef(): FieldRefArgType<ModelAttributeCtx> {
  return {
    kind: 'fieldRef',
    label: 'field name',
    parse: (arg, ctx) => parseFieldName(arg, ctx),
  };
}

export function referencedFieldRef(): ReferencedFieldRefArgType<FieldAttributeCtx> {
  return {
    kind: 'referencedFieldRef',
    label: 'field name',
    parse: (arg, ctx) => parseFieldName(arg, ctx),
  };
}
