import type { PslDiagnostic } from '../diagnostic';
import type { AstNode } from '../syntax/ast-helpers';
import type { AttributeCtx, AttributeOut, AttributeSpec, Param, PositionalParam } from './types';

interface BlockAttributeConfig<
  Pos extends readonly PositionalParam<unknown, AttributeCtx>[],
  Named extends Record<string, Param<unknown, AttributeCtx>>,
> {
  readonly documentation: string;
  readonly positional?: Pos;
  readonly named?: Named;
  readonly refine?: (
    parsed: AttributeOut<Pos, Named>,
    ctx: AttributeCtx,
    attributeNode: AstNode,
  ) => readonly PslDiagnostic[];
}

export function blockAttribute<
  const Pos extends readonly PositionalParam<unknown, AttributeCtx>[] = readonly [],
  const Named extends Record<string, Param<unknown, AttributeCtx>> = Record<never, never>,
>(
  name: string,
  config: BlockAttributeConfig<Pos, Named>,
): AttributeSpec<AttributeOut<Pos, Named>, AttributeCtx> {
  return {
    level: 'block',
    name,
    documentation: config.documentation,
    positional: config.positional ?? [],
    named: config.named ?? {},
    ...(config.refine !== undefined ? { refine: config.refine } : {}),
  };
}
