import type { PslDiagnostic } from '@internal/framework-components/psl-ast';
import { notOk, ok, type Result } from '@internal/utils/result';
import { nodePslSpan } from '../../resolve';
import type { ExpressionAst } from '../../syntax/ast/expressions';
import { FunctionCallAst } from '../../syntax/ast/expressions';
import { interpretArgs } from '../interpret';
import type { AttributeCtx, FuncCallArgType, FuncCallSig, TypedFuncCall } from '../types';
import { leafDiagnostic } from './diagnostic';

export function funcCall<const Name extends string, const Signature extends FuncCallSig>(
  name: Name,
  sig: Signature,
): FuncCallArgType<Name, AttributeCtx, Signature> {
  return {
    kind: 'funcCall',
    label: `${name}()`,
    name,
    signature: sig,
    parse: (arg, ctx): Result<TypedFuncCall, readonly PslDiagnostic[]> => {
      const guard = matchCallee(arg, name, ctx);
      if (!guard.ok) return guard;
      const span = nodePslSpan(guard.value.syntax, ctx.sourceFile);
      const bound = interpretArgs(
        guard.value.args(),
        { name, positional: sig.positional ?? [], named: sig.named ?? {} },
        ctx,
        span,
      );
      if (!bound.ok) return notOk<readonly PslDiagnostic[]>(bound.failure);
      return ok({ fn: name, span, args: bound.value });
    },
  };
}

function matchCallee(
  arg: ExpressionAst,
  name: string,
  ctx: AttributeCtx,
): Result<FunctionCallAst, readonly PslDiagnostic[]> {
  const call = FunctionCallAst.cast(arg.syntax);
  if (call === undefined) {
    return notOk([leafDiagnostic(ctx, arg, 'Expected a function call')]);
  }
  const qname = call.name();
  if (qname === undefined || qname.dot() !== undefined || qname.colon() !== undefined) {
    return notOk([leafDiagnostic(ctx, arg, 'Expected a function call')]);
  }
  const calleeName = qname.identifier()?.token()?.text;
  if (calleeName === undefined) {
    return notOk([leafDiagnostic(ctx, arg, 'Expected a function call')]);
  }
  if (calleeName !== name) {
    return notOk([leafDiagnostic(ctx, arg, `Expected ${name}()`)]);
  }
  return ok(call);
}
