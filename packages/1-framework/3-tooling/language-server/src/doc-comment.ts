import { type SyntaxElement, type SyntaxNode, SyntaxToken } from '@internal/psl-parser/syntax';

export function readDocComment(declaration: SyntaxNode): string | undefined {
  const lines: string[] = [];
  let current: SyntaxElement = declaration;
  let newlinesSinceComment = 0;

  for (;;) {
    const sibling: SyntaxElement | undefined = current.prevSiblingOrToken;
    if (!(sibling instanceof SyntaxToken)) break;
    if (sibling.kind === 'Whitespace') {
      current = sibling;
      continue;
    }
    if (sibling.kind === 'Newline') {
      newlinesSinceComment += 1;
      if (newlinesSinceComment > 1) break;
      current = sibling;
      continue;
    }
    if (sibling.kind === 'Comment' && sibling.text.startsWith('///')) {
      lines.push(stripDocCommentMarker(sibling.text));
      newlinesSinceComment = 0;
      current = sibling;
      continue;
    }
    break;
  }

  return lines.length === 0 ? undefined : lines.reverse().join('\n');
}

function stripDocCommentMarker(text: string): string {
  const withoutMarker = text.slice(3);
  return withoutMarker.startsWith(' ') ? withoutMarker.slice(1) : withoutMarker;
}
