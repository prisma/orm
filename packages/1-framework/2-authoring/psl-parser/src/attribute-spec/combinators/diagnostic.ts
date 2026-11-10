import type { PslDiagnosticCode } from '@internal/framework-components/psl-ast';
import { diagnosticSource, type PslDiagnostic } from '../../diagnostic';
import { nodePslSpan } from '../../resolve';
import type { AstNode } from '../../syntax/ast-helpers';
import type { AttributeCtx } from '../types';

export const ATTRIBUTE_DIAGNOSTIC_CODE: PslDiagnosticCode = 'PSL_INVALID_ATTRIBUTE_SYNTAX';

export function leafDiagnostic(
  ctx: Pick<AttributeCtx, 'sources'>,
  node: AstNode,
  message: string,
  code: PslDiagnostic['code'] = ATTRIBUTE_DIAGNOSTIC_CODE,
): PslDiagnostic {
  return {
    code,
    message,
    ...diagnosticSource(ctx.sources, node.syntax).at(nodePslSpan(node.syntax, ctx.sources)),
  };
}
