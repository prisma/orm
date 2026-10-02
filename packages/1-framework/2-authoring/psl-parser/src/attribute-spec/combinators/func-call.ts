import { notOk, ok, type Result } from '@internal/utils/result';
import type { PslDiagnostic } from '../../diagnostic';
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
      const span = nodePslSpan(guard.value.syntax, ctx.sources);
      const bound = interpretArgs(
        guard.value.args(),
        { name, positional: sig.positional ?? [], named: sig.named ?? {} },
        ctx,
        span,
        guard.value.syntax,
      );
      if (!bound.ok) return notOk<readonly PslDiagnostic[]>(bound.failure);
      return ok({ fn: name, span, args: bound.value });
    },
  };
}

export function plainCallee(
  arg: ExpressionAst,
): { readonly call: FunctionCallAst; readonly name: string } | undefined {
  const call = FunctionCallAst.cast(arg.syntax);
  const qname = call?.name();
  if (call === undefined || qname === undefined) return undefined;
  if (qname.dot() !== undefined || qname.colon() !== undefined) return undefined;
  const name = qname.identifier()?.token()?.text;
  return name === undefined ? undefined : { call, name };
}

function matchCallee(
  arg: ExpressionAst,
  name: string,
  ctx: AttributeCtx,
): Result<FunctionCallAst, readonly PslDiagnostic[]> {
  const callee = plainCallee(arg);
  if (callee === undefined) {
    return notOk([leafDiagnostic(ctx, arg, 'Expected a function call')]);
  }
  if (callee.name !== name) {
    return notOk([leafDiagnostic(ctx, arg, `Expected ${name}()`)]);
  }
  return ok(callee.call);
}
