import type { PslDiagnostic } from '../diagnostic';
import type { AstNode } from '../syntax/ast-helpers';
import type {
  AttributeOut,
  AttributeSpec,
  BlockAttributeCtx,
  Param,
  PositionalParam,
} from './types';

interface BlockAttributeConfig<
  Pos extends readonly PositionalParam<unknown, BlockAttributeCtx>[],
  Named extends Record<string, Param<unknown, BlockAttributeCtx>>,
> {
  readonly documentation: string;
  readonly positional?: Pos;
  readonly named?: Named;
  readonly refine?: (
    parsed: AttributeOut<Pos, Named>,
    ctx: BlockAttributeCtx,
    attributeNode: AstNode,
  ) => readonly PslDiagnostic[];
}

export function blockAttribute<
  const Pos extends readonly PositionalParam<unknown, BlockAttributeCtx>[] = readonly [],
  const Named extends Record<string, Param<unknown, BlockAttributeCtx>> = Record<never, never>,
>(
  name: string,
  config: BlockAttributeConfig<Pos, Named>,
): AttributeSpec<AttributeOut<Pos, Named>, BlockAttributeCtx> {
  return {
    level: 'block',
    name,
    documentation: config.documentation,
    positional: config.positional ?? [],
    named: config.named ?? {},
    ...(config.refine !== undefined ? { refine: config.refine } : {}),
  };
}
