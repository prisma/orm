import type { Binder, Resolution } from '@internal/psl-parser';
import type { SyntaxNode, SyntaxToken } from '@internal/psl-parser/syntax';

export interface ResolvedNode {
  readonly node: SyntaxNode;
  readonly resolution: Resolution;
}

export function identTokenAt(root: SyntaxNode, offset: number): SyntaxToken | undefined {
  const at = root.tokenAtOffset(offset);
  const left = at.leftBiased();
  if (left?.kind === 'Ident') return left;
  const right = at.rightBiased();
  return right?.kind === 'Ident' ? right : undefined;
}

export function resolvedNodeAt(token: SyntaxToken, binder: Binder): ResolvedNode | undefined {
  const found = token.parent.findAncestor((node): ResolvedNode | 'declaration' | undefined => {
    const resolution = binder.symbolForNode(node);
    if (resolution !== undefined) return { node, resolution };
    return binder.declaredSymbol(node) === undefined ? undefined : 'declaration';
  });
  return found === 'declaration' ? undefined : found;
}
