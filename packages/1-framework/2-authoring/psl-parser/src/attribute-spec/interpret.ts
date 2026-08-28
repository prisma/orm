import type { PslDiagnostic, PslSpan } from '@internal/framework-components/psl-ast';
import { blindCast } from '@internal/utils/casts';
import { notOk, ok, type Result } from '@internal/utils/result';
import { nodePslSpan } from '../resolve';
import type { FieldAttributeAst, ModelAttributeAst } from '../syntax/ast/attributes';
import type { AttributeArgAst } from '../syntax/ast/expressions';
import { ATTRIBUTE_DIAGNOSTIC_CODE } from './combinators/diagnostic';
import type {
  ArgType,
  AttributeSpec,
  BlockInterpretCtx,
  OptionalArgType,
  Param,
  PositionalParam,
} from './types';

// The positional/named argument-binding for an attribute or a function call. `name` labels the
// callee in binding diagnostics (`Attribute "<name>" …`); `span` anchors the arity diagnostics
// (too-many / missing) that have no per-argument node to point at.
export interface ArgBindingSpec<Ctx extends BlockInterpretCtx = BlockInterpretCtx> {
  readonly name: string;
  readonly positional: readonly PositionalParam<unknown, Ctx>[];
  readonly named: Readonly<Record<string, Param<unknown, Ctx>>>;
}

export function interpretArgs<Ctx extends BlockInterpretCtx>(
  args: Iterable<AttributeArgAst>,
  spec: ArgBindingSpec<Ctx>,
  ctx: Ctx,
  span: PslSpan,
): Result<Record<string, unknown>, readonly PslDiagnostic[]> {
  const diagnostics: PslDiagnostic[] = [];

  const output: Record<string, unknown> = {};
  const seen = new Set<string>();
  let positionalSlot = 0;
  let reportedExcess = false;

  for (const arg of args) {
    const name = arg.name()?.name();

    let key: string;
    let param: Param<unknown, Ctx>;
    if (name === undefined) {
      const posParam = spec.positional[positionalSlot];
      if (posParam === undefined) {
        if (!reportedExcess) {
          diagnostics.push(
            diagnostic(
              `Attribute "${spec.name}" received too many positional arguments`,
              ctx,
              span,
            ),
          );
          reportedExcess = true;
        }
        continue;
      }
      positionalSlot += 1;
      key = posParam.key;
      param = posParam.type;
    } else {
      const namedParam = Object.hasOwn(spec.named, name) ? spec.named[name] : undefined;
      if (namedParam === undefined) {
        diagnostics.push(
          diagnostic(
            `Attribute "${spec.name}" received unknown argument "${name}"`,
            ctx,
            nodePslSpan(arg.syntax, ctx.sourceFile),
          ),
        );
        continue;
      }
      key = name;
      param = namedParam;
    }

    if (seen.has(key)) {
      diagnostics.push(
        diagnostic(
          `Attribute "${spec.name}" received duplicate argument "${key}"`,
          ctx,
          nodePslSpan(arg.syntax, ctx.sourceFile),
        ),
      );
      continue;
    }
    seen.add(key);
    const result = parseArgValue(arg, param, ctx, diagnostics);
    if (result.ok) output[key] = result.value;
  }

  const finalized = new Set<string>();
  const finalizeAbsentKey = (
    key: string,
    positionalParam: Param<unknown, Ctx> | undefined,
    namedParam: Param<unknown, Ctx> | undefined,
  ): void => {
    if (finalized.has(key) || seen.has(key)) return;
    finalized.add(key);
    const effective = namedParam ?? positionalParam;
    if (effective === undefined) return;
    if (isOptionalArgType(effective)) {
      if (effective.hasDefault) output[key] = effective.defaultValue;
      return;
    }
    diagnostics.push(
      diagnostic(`Attribute "${spec.name}" is missing required argument "${key}"`, ctx, span),
    );
  };

  for (const param of spec.positional) {
    const namedParam = Object.hasOwn(spec.named, param.key) ? spec.named[param.key] : undefined;
    finalizeAbsentKey(param.key, param.type, namedParam);
  }
  for (const key of Object.keys(spec.named)) {
    finalizeAbsentKey(key, undefined, spec.named[key]);
  }

  if (diagnostics.length > 0) {
    return notOk<readonly PslDiagnostic[]>(diagnostics);
  }
  return ok(output);
}

export function interpretAttribute<Out, Ctx extends BlockInterpretCtx>(
  attrNode: FieldAttributeAst | ModelAttributeAst,
  spec: AttributeSpec<Out, Ctx>,
  ctx: Ctx,
): Result<Out, readonly PslDiagnostic[]> {
  const attributeSpan = nodePslSpan(attrNode.syntax, ctx.sourceFile);
  const bound = interpretArgs(attrNode.argList()?.args() ?? [], spec, ctx, attributeSpan);
  if (!bound.ok) return notOk<readonly PslDiagnostic[]>(bound.failure);

  const value = blindCast<
    Out,
    'The engine builds the output object structurally from the spec; TypeScript cannot relate the dynamically-keyed record to the spec-inferred output type.'
  >(bound.value);
  if (spec.refine !== undefined) {
    const refineDiagnostics = spec.refine(value, ctx, attrNode);
    if (refineDiagnostics.length > 0) {
      return notOk<readonly PslDiagnostic[]>(refineDiagnostics);
    }
  }
  return ok(value);
}

function parseArgValue<Ctx extends BlockInterpretCtx>(
  arg: AttributeArgAst,
  argType: ArgType<unknown, Ctx>,
  ctx: Ctx,
  diagnostics: PslDiagnostic[],
): Result<unknown, readonly PslDiagnostic[]> {
  const value = arg.value();
  if (value === undefined) {
    const missing = diagnostic(
      'Attribute argument is missing a value',
      ctx,
      nodePslSpan(arg.syntax, ctx.sourceFile),
    );
    diagnostics.push(missing);
    return notOk<readonly PslDiagnostic[]>([missing]);
  }
  const result = argType.parse(value, ctx);
  if (!result.ok) {
    for (const failure of result.failure) diagnostics.push(failure);
  }
  return result;
}

function isOptionalArgType<Ctx extends BlockInterpretCtx>(
  param: Param<unknown, Ctx>,
): param is OptionalArgType<unknown, Ctx> {
  return 'optional' in param && param.optional === true;
}

function diagnostic(message: string, ctx: BlockInterpretCtx, span: PslSpan): PslDiagnostic {
  return { code: ATTRIBUTE_DIAGNOSTIC_CODE, message, sourceId: ctx.sourceId, span };
}
