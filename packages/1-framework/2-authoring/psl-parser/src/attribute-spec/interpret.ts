import type { PslSpan } from '@internal/framework-components/psl-ast';
import { blindCast } from '@internal/utils/casts';
import { notOk, ok, type Result } from '@internal/utils/result';
import { diagnosticSource, type PslDiagnostic } from '../diagnostic';
import { nodePslSpan } from '../resolve';
import type { FieldAttributeAst, ModelAttributeAst } from '../syntax/ast/attributes';
import type { AttributeArgAst } from '../syntax/ast/expressions';
import type { SyntaxNode } from '../syntax/red';
import { ATTRIBUTE_DIAGNOSTIC_CODE } from './combinators/diagnostic';
import type {
  ArgType,
  AttributeCtx,
  AttributeSpec,
  OptionalArgType,
  Param,
  PositionalParam,
} from './types';

// The positional/named argument-binding for an attribute or a function call. `name` labels the
// callee in binding diagnostics (`Attribute "<name>" …`); `span` anchors the arity diagnostics
// (too-many / missing) that have no per-argument node to point at.
export interface ArgBindingSpec<Ctx extends AttributeCtx> {
  readonly name: string;
  readonly positional: readonly PositionalParam<unknown, Ctx>[];
  readonly named: Readonly<Record<string, Param<unknown, Ctx>>>;
}

export function interpretArgs<Ctx extends AttributeCtx>(
  args: Iterable<AttributeArgAst>,
  spec: ArgBindingSpec<Ctx>,
  ctx: Ctx,
  span: PslSpan,
  sourceNode: SyntaxNode,
): Result<Record<string, unknown>, readonly PslDiagnostic[]> {
  const diagnostics: PslDiagnostic[] = [];

  const output: Record<string, unknown> = {};
  const seen = new Set<string>();
  let positionalSlot = 0;
  let reportedExcess = false;

  for (const arg of args) {
    const name = arg.name()?.name();

    let key: string;
    let param: ArgType<unknown, Ctx>;
    if (name === undefined) {
      const posParam = spec.positional[positionalSlot];
      if (posParam === undefined) {
        if (!reportedExcess) {
          diagnostics.push(
            diagnostic(
              `Attribute "${spec.name}" received too many positional arguments`,
              ctx,
              span,
              sourceNode,
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
            nodePslSpan(arg.syntax, ctx.sources),
            arg.syntax,
          ),
        );
        continue;
      }
      key = name;
      param = namedParam.type;
    }

    if (seen.has(key)) {
      diagnostics.push(
        diagnostic(
          `Attribute "${spec.name}" received duplicate argument "${key}"`,
          ctx,
          nodePslSpan(arg.syntax, ctx.sources),
          arg.syntax,
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
    positionalParam: ArgType<unknown, Ctx> | undefined,
    namedParam: ArgType<unknown, Ctx> | undefined,
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
      diagnostic(
        `Attribute "${spec.name}" is missing required argument "${key}"`,
        ctx,
        span,
        sourceNode,
      ),
    );
  };

  for (const param of spec.positional) {
    const namedParam = Object.hasOwn(spec.named, param.key) ? spec.named[param.key] : undefined;
    finalizeAbsentKey(param.key, param.type, namedParam?.type);
  }
  for (const key of Object.keys(spec.named)) {
    finalizeAbsentKey(key, undefined, spec.named[key]?.type);
  }

  if (diagnostics.length > 0) {
    return notOk<readonly PslDiagnostic[]>(diagnostics);
  }
  return ok(output);
}

export function interpretAttribute<Out, Ctx extends AttributeCtx>(
  attrNode: FieldAttributeAst | ModelAttributeAst,
  spec: AttributeSpec<Out, Ctx>,
  ctx: Ctx,
): Result<Out, readonly PslDiagnostic[]> {
  const attributeSpan = nodePslSpan(attrNode.syntax, ctx.sources);
  const bound = interpretArgs(
    attrNode.argList()?.args() ?? [],
    spec,
    ctx,
    attributeSpan,
    attrNode.syntax,
  );
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

function parseArgValue<Ctx extends AttributeCtx>(
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
      nodePslSpan(arg.syntax, ctx.sources),
      arg.syntax,
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

function isOptionalArgType<Ctx extends AttributeCtx>(
  param: ArgType<unknown, Ctx>,
): param is OptionalArgType<unknown, Ctx> {
  return 'optional' in param && param.optional === true;
}

function diagnostic(
  message: string,
  ctx: AttributeCtx,
  span: PslSpan,
  sourceNode: SyntaxNode,
): PslDiagnostic {
  return {
    code: ATTRIBUTE_DIAGNOSTIC_CODE,
    message,
    ...diagnosticSource(ctx.sources, sourceNode).at(span),
  };
}
