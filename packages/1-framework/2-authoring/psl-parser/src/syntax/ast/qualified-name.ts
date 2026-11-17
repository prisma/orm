import type { AstNode } from '../ast-helpers';
import { filterChildren, findChildToken, findFirstChild } from '../ast-helpers';
import { SyntaxNode, type SyntaxToken } from '../red';
import { IdentifierAst } from './identifier';

/** A namespace-qualified name, e.g. `pgvector.Vector` or `supabase:auth.User`. */
export class QualifiedNameAst implements AstNode {
  readonly syntax: SyntaxNode;

  constructor(syntax: SyntaxNode) {
    this.syntax = syntax;
  }

  #segmentBefore(boundary: number): IdentifierAst | undefined {
    let found: IdentifierAst | undefined;
    for (const segment of filterChildren(this.syntax, IdentifierAst.cast)) {
      if (segment.syntax.offset >= boundary) break;
      found = segment;
    }
    return found;
  }

  #segmentAfter(boundary: number): IdentifierAst | undefined {
    for (const segment of filterChildren(this.syntax, IdentifierAst.cast)) {
      if (segment.syntax.offset > boundary) return segment;
    }
    return undefined;
  }

  #separatorCount(kind: 'Dot' | 'Colon'): number {
    let count = 0;
    for (const child of this.syntax.children()) {
      if (!(child instanceof SyntaxNode) && child.kind === kind) count++;
    }
    return count;
  }

  colon(): SyntaxToken | undefined {
    return findChildToken(this.syntax, 'Colon');
  }

  dot(): SyntaxToken | undefined {
    return findChildToken(this.syntax, 'Dot');
  }

  space(): IdentifierAst | undefined {
    const colon = this.colon();
    if (!colon) return undefined;
    return this.#segmentBefore(colon.offset);
  }

  namespace(): IdentifierAst | undefined {
    const dot = this.dot();
    if (!dot) return undefined;
    return this.#segmentBefore(dot.offset);
  }

  identifier(): IdentifierAst | undefined {
    const dot = this.dot();
    if (dot) return this.#segmentAfter(dot.offset);
    const colon = this.colon();
    if (colon) return this.#segmentAfter(colon.offset);
    return findFirstChild(this.syntax, IdentifierAst.cast);
  }

  segments(): Iterable<IdentifierAst> {
    return filterChildren(this.syntax, IdentifierAst.cast);
  }

  /**
   * Every identifier segment, in source order. A bare `Vector` yields
   * `['Vector']`; a qualified `pgvector.Vector` yields `['pgvector', 'Vector']`.
   */
  path(): readonly string[] {
    const segments: string[] = [];
    for (const segment of this.segments()) {
      const text = segment.token()?.text;
      if (text !== undefined) segments.push(text);
    }
    return segments;
  }

  /** True iff this is a single unqualified identifier whose text equals `name`. */
  isSimpleName(name: string): boolean {
    if (this.dot() !== undefined || this.colon() !== undefined) return false;
    return this.identifier()?.token()?.text === name;
  }

  /**
   * Flags a malformed name with more qualifier segments than allowed (a second
   * `:`-space or a second `.`-namespace).
   */
  isOverQualified(): boolean {
    return this.#separatorCount('Dot') > 1 || this.#separatorCount('Colon') > 1;
  }

  static cast(node: SyntaxNode): QualifiedNameAst | undefined {
    return node.kind === 'QualifiedName' ? new QualifiedNameAst(node) : undefined;
  }
}
