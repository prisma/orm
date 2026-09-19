import type { PslDiagnostic } from '../diagnostic';
import type { AstNode } from '../syntax/ast-helpers';
import type {
  AttributeOut,
  AttributeSpec,
  ModelAttributeCtx,
  Param,
  PositionalParam,
} from './types';

interface ModelAttributeConfig<
  Pos extends readonly PositionalParam<unknown, ModelAttributeCtx>[],
  Named extends Record<string, Param<unknown, ModelAttributeCtx>>,
> {
  readonly documentation: string;
  readonly positional?: Pos;
  readonly named?: Named;
  readonly refine?: (
    parsed: AttributeOut<Pos, Named>,
    ctx: ModelAttributeCtx,
    attributeNode: AstNode,
  ) => readonly PslDiagnostic[];
}

export function modelAttribute<
  const Pos extends readonly PositionalParam<unknown, ModelAttributeCtx>[] = readonly [],
  const Named extends Record<string, Param<unknown, ModelAttributeCtx>> = Record<never, never>,
>(
  name: string,
  config: ModelAttributeConfig<Pos, Named>,
): AttributeSpec<AttributeOut<Pos, Named>, ModelAttributeCtx> {
  return {
    level: 'model',
    name,
    documentation: config.documentation,
    positional: config.positional ?? [],
    named: config.named ?? {},
    ...(config.refine !== undefined ? { refine: config.refine } : {}),
  };
}
