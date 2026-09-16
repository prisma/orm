import type { PslDiagnostic } from '@internal/framework-components/psl-ast';
import type { AstNode } from '../syntax/ast-helpers';
import type {
  AttributeOut,
  AttributeSpec,
  FieldAttributeCtx,
  Param,
  PositionalParam,
} from './types';

interface FieldAttributeConfig<
  Pos extends readonly PositionalParam<unknown, FieldAttributeCtx>[],
  Named extends Record<string, Param<unknown, FieldAttributeCtx>>,
> {
  readonly documentation: string;
  readonly positional?: Pos;
  readonly named?: Named;
  readonly refine?: (
    parsed: AttributeOut<Pos, Named>,
    ctx: FieldAttributeCtx,
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
  return {
    level: 'field',
    name,
    documentation: config.documentation,
    positional: config.positional ?? [],
    named: config.named ?? {},
    ...(config.refine !== undefined ? { refine: config.refine } : {}),
  };
}
