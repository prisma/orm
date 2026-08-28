import type { PslDiagnostic } from '@internal/framework-components/psl-ast';
import type { AstNode } from '../syntax/ast-helpers';
import type {
  AttributeOut,
  AttributeSpec,
  BlockInterpretCtx,
  Param,
  PositionalParam,
} from './types';

interface BlockAttributeConfig<
  Pos extends readonly PositionalParam<unknown, BlockInterpretCtx>[],
  Named extends Record<string, Param<unknown, BlockInterpretCtx>>,
> {
  readonly positional?: Pos;
  readonly named?: Named;
  readonly refine?: (
    parsed: AttributeOut<Pos, Named>,
    ctx: BlockInterpretCtx,
    attributeNode: AstNode,
  ) => readonly PslDiagnostic[];
}

export function blockAttribute<
  const Pos extends readonly PositionalParam<unknown, BlockInterpretCtx>[] = readonly [],
  const Named extends Record<string, Param<unknown, BlockInterpretCtx>> = Record<never, never>,
>(
  name: string,
  config: BlockAttributeConfig<Pos, Named>,
): AttributeSpec<AttributeOut<Pos, Named>, BlockInterpretCtx> {
  return {
    level: 'block',
    name,
    positional: config.positional ?? [],
    named: config.named ?? {},
    ...(config.refine !== undefined ? { refine: config.refine } : {}),
  };
}
