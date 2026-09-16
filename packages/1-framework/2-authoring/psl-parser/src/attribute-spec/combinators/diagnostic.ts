import type { PslDiagnostic, PslDiagnosticCode } from '@internal/framework-components/psl-ast';
import { nodePslSpan } from '../../resolve';
import type { AstNode } from '../../syntax/ast-helpers';
import type { AttributeCtx } from '../types';

export const ATTRIBUTE_DIAGNOSTIC_CODE: PslDiagnosticCode = 'PSL_INVALID_ATTRIBUTE_SYNTAX';

export function leafDiagnostic(
  ctx: AttributeCtx,
  node: AstNode,
  message: string,
  code: PslDiagnostic['code'] = ATTRIBUTE_DIAGNOSTIC_CODE,
): PslDiagnostic {
  return {
    code,
    message,
    sourceId: ctx.sources.sourceFileFor(node.syntax).filename,
    span: nodePslSpan(node.syntax, ctx.sources),
  };
}
