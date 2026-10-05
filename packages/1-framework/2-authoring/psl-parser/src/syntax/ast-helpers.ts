import type { TokenKind } from '../tokenizer';
import { type SyntaxElement, SyntaxNode, SyntaxToken } from './red';

export interface AstNode {
  readonly syntax: SyntaxNode;
}

export interface BracedBlock extends AstNode {
  lbrace(): SyntaxToken | undefined;
  rbrace(): SyntaxToken | undefined;
}

export interface HasDocComment {
  docComment(): string | undefined;
}

/**
 * Walks back through `node`'s preceding sibling tokens collecting a
 * contiguous `///` run: only whitespace and single newlines may sit between
 * consecutive `///` lines. Stops at a blank line, a non-`///` comment, or any
 * other non-trivia element. Each line has its `///` marker and one following
 * space stripped; the lines join with `\n`.
 */
export function readDocComment(node: SyntaxNode): string | undefined {
  const lines: string[] = [];
  let current: SyntaxElement = node;
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

export function findChildToken(node: SyntaxNode, kind: TokenKind): SyntaxToken | undefined {
  for (const child of node.children()) {
    if (!(child instanceof SyntaxNode) && child.kind === kind) {
      return child;
    }
  }
  return undefined;
}

export function findFirstChild<T>(
  node: SyntaxNode,
  cast: (node: SyntaxNode) => T | undefined,
): T | undefined {
  for (const child of node.childNodes()) {
    const result = cast(child);
    if (result !== undefined) return result;
  }
  return undefined;
}

export function* filterChildren<T>(
  node: SyntaxNode,
  cast: (node: SyntaxNode) => T | undefined,
): Iterable<T> {
  for (const child of node.childNodes()) {
    const result = cast(child);
    if (result !== undefined) yield result;
  }
}

type CastTarget<C> = C extends (node: SyntaxNode) => infer R ? Exclude<R, undefined> : never;

export function any<Casts extends readonly ((node: SyntaxNode) => unknown)[]>(
  ...casts: Casts
): (node: SyntaxNode) => CastTarget<Casts[number]> | undefined;
export function any(
  ...casts: ReadonlyArray<(node: SyntaxNode) => unknown>
): (node: SyntaxNode) => unknown {
  return (node) => {
    for (const cast of casts) {
      const result = cast(node);
      if (result !== undefined) {
        return result;
      }
    }
    return undefined;
  };
}

/**
 * Raw source text of a CST node, verbatim (quotes and brackets preserved). For
 * the decoded value of a string literal, decode it instead.
 */
export function printSyntax(node: SyntaxNode): string {
  let text = '';
  for (const token of node.tokens()) {
    text += token.text;
  }
  return text;
}
