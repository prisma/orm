import type { PslDiagnostic } from '../diagnostic';
import type { AstNode } from '../syntax/ast-helpers';
import type {
  AttributeCtx,
  AttributeOut,
  AttributeSpec,
  FieldAttributeCtx,
  Param,
  PositionalParam,
} from './types';

interface FieldAttributeConfig<
  Pos extends readonly PositionalParam<unknown, Ctx>[],
  Named extends Record<string, Param<unknown, Ctx>>,
  Ctx extends AttributeCtx = FieldAttributeCtx,
> {
  readonly documentation: string;
  readonly positional?: Pos;
  readonly named?: Named;
  readonly refine?: (
    parsed: AttributeOut<Pos, Named>,
    ctx: Ctx,
    attributeNode: AstNode,
  ) => readonly PslDiagnostic[];
}

export function fieldAttribute<
  const Pos extends readonly PositionalParam<unknown, FieldAttributeCtx>[] = readonly [],
  const Named extends Record<string, Param<unknown, FieldAttributeCtx>> = Record<never, never>,
>(
  name: string,
  config: FieldAttributeConfig<Pos, Named>,
): AttributeSpec<AttributeOut<Pos, Named>, FieldAttributeCtx> {
  return fieldLevelAttribute(name, config);
}

/**
 * A field attribute that reads only its type, never the field it is written on, so a type alias can carry it too.
 */
export function typeAttribute<
  const Pos extends readonly PositionalParam<unknown, AttributeCtx>[] = readonly [],
  const Named extends Record<string, Param<unknown, AttributeCtx>> = Record<never, never>,
>(
  name: string,
  config: FieldAttributeConfig<Pos, Named, AttributeCtx>,
): AttributeSpec<AttributeOut<Pos, Named>, AttributeCtx> {
  return fieldLevelAttribute(name, config);
}

function fieldLevelAttribute<
  Pos extends readonly PositionalParam<unknown, Ctx>[],
  Named extends Record<string, Param<unknown, Ctx>>,
  Ctx extends AttributeCtx,
>(
  name: string,
  config: FieldAttributeConfig<Pos, Named, Ctx>,
): AttributeSpec<AttributeOut<Pos, Named>, Ctx> {
  return {
    level: 'field',
    name,
    documentation: config.documentation,
    positional: config.positional ?? [],
    named: Object.assign(Object.create(null), config.named),
    ...(config.refine !== undefined ? { refine: config.refine } : {}),
  };
}
