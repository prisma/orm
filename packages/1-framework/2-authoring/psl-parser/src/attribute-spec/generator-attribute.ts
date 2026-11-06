import type { DataTypeSupport } from '@internal/framework-components/authoring';
import type { GeneratorPhase } from '@internal/framework-components/components';
import { blindCast } from '@internal/utils/casts';
import { notOk } from '@internal/utils/result';
import { contributedTypeCodecId } from '../contributed-type-scope';
import type { PslDiagnostic } from '../diagnostic';
import { FunctionCallAst } from '../syntax/ast/expressions';
import type { AstNode } from '../syntax/ast-helpers';
import { leafDiagnostic } from './combinators/diagnostic';
import { funcCall } from './combinators/func-call';
import { oneOf } from './combinators/one-of';
import { typeAttribute } from './field-attribute';
import {
  type FieldAttributeSpecContext,
  type TypeAttributeSpecContext,
  typeAttributeSpecContextOfField,
  typeAttributeSubjectLabel,
} from './spec-context';
import type { ArgType, AttributeCtx, FuncCallSig, RejectingArgType, TypedFuncCall } from './types';

const GENERATOR_PHASE_DOCUMENTATION: Readonly<Record<GeneratorPhase, string>> = {
  onCreate: 'Generates a value in the client when a row is created without one.',
  onUpdate: 'Generates a value in the client every time a row is updated.',
};

/** The source text of a node, as the author wrote it. */
export function nodeSourceText(node: AstNode, ctx: Pick<AttributeCtx, 'sources'>): string {
  return ctx.sources
    .sourceFileFor(node.syntax)
    .text.slice(node.syntax.offset, node.syntax.endOffset)
    .trim();
}

function calleeName(node: AstNode): string | undefined {
  return FunctionCallAst.cast(node.syntax)?.path().join('.');
}

function functionListText(
  functions: readonly { readonly name: string }[],
  codecKnown: boolean,
): string {
  if (functions.length > 0) {
    return `Functions that apply: ${functions.map(({ name }) => `${name}()`).join(', ')}.`;
  }
  return codecKnown
    ? 'No generator function applies to this codec.'
    : 'No generator function applies to it.';
}

/**
 * A call to the generator function `name`, with its signature built from the stack's data types when it is written as a function of them. Its binding diagnostics name it as a generator function.
 */
export function generatorFunctionCall(
  name: string,
  signature: unknown,
  dataTypes: DataTypeSupport,
): ArgType<TypedFuncCall, AttributeCtx> {
  const declared = blindCast<
    FuncCallSig | ((dataTypes: DataTypeSupport) => FuncCallSig),
    'The registry stores each signature opaquely as `unknown` because FuncCallSig lives in the authoring layer that core cannot name; the component that declares a generator function gives it a FuncCallSig or a function of the data types that returns one.'
  >(signature);
  return funcCall(name, typeof declared === 'function' ? declared(dataTypes) : declared, {
    label: `Generator function "${name}"`,
  });
}

/**
 * The generator function arms for a field's codec. A call to a function that does not apply to the codec, or that no component declares, is refused before the arms are tried, so the author is told which functions do apply.
 */
function generatorCallArm(ctx: TypeAttributeSpecContext) {
  const codecId =
    ctx.contributedType === undefined
      ? undefined
      : contributedTypeCodecId(ctx.contributedType, ctx.dataTypes);
  const functions = codecId === undefined ? [] : ctx.generatorFunctions.functionsFor(codecId);
  const subject = typeAttributeSubjectLabel(ctx.subject);
  const target = codecId === undefined ? "the field's type" : `codec "${codecId}"`;
  const refuse = (arg: AstNode, attributeCtx: AttributeCtx) => {
    const name = calleeName(arg);
    const diagnostic =
      name !== undefined && !ctx.generatorFunctions.has(name)
        ? leafDiagnostic(
            attributeCtx,
            arg,
            `${subject}: unknown generator function "${name}". ${functionListText(functions, codecId !== undefined)}`,
            'PSL_UNKNOWN_GENERATOR_FUNCTION',
          )
        : leafDiagnostic(
            attributeCtx,
            arg,
            `${subject}: ${nodeSourceText(arg, attributeCtx)} does not apply to ${target}. ${functionListText(functions, codecId !== undefined)}`,
            'PSL_GENERATOR_NOT_APPLICABLE',
          );
    return notOk<readonly PslDiagnostic[]>([diagnostic]);
  };
  const [first, ...rest] = functions.map(({ name, signature }) =>
    generatorFunctionCall(name, signature, ctx.dataTypes),
  );
  if (first === undefined) {
    const rejecting: RejectingArgType<TypedFuncCall, AttributeCtx> = {
      kind: 'rejecting',
      label: 'generator function',
      message: `No generator function applies to ${target}`,
      parse: refuse,
    };
    return rejecting;
  }
  const value = oneOf(first, ...rest);
  const bound = new Set(functions.map(({ name }) => name));
  return {
    ...value,
    parse: (arg: Parameters<typeof value.parse>[0], attributeCtx: AttributeCtx) => {
      const name = calleeName(arg);
      return name !== undefined && !bound.has(name)
        ? refuse(arg, attributeCtx)
        : value.parse(arg, attributeCtx);
    },
  };
}

/** The spec of `@onCreate(fn())` or `@onUpdate(fn())` on a field or type alias, offering the generator functions bound to its codec. */
export function typeGeneratorAttributeSpec(phase: GeneratorPhase, ctx: TypeAttributeSpecContext) {
  return typeAttribute(phase, {
    documentation: GENERATOR_PHASE_DOCUMENTATION[phase],
    positional: [
      {
        key: 'value',
        type: generatorCallArm(ctx),
        documentation: "A generator function that applies to the field's codec.",
      },
    ],
  });
}

/** The spec of `@onCreate(fn())` or `@onUpdate(fn())`, offering the generator functions bound to the field's codec. */
export function generatorAttributeSpec(phase: GeneratorPhase) {
  return (ctx: FieldAttributeSpecContext) =>
    typeGeneratorAttributeSpec(phase, typeAttributeSpecContextOfField(ctx));
}
