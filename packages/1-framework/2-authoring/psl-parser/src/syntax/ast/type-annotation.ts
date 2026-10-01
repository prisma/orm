import type { AstNode } from '../ast-helpers';
import { findChildToken, findFirstChild } from '../ast-helpers';
import { SyntaxNode, type SyntaxToken } from '../red';
import { AttributeArgListAst } from './attributes';
import { QualifiedNameAst } from './qualified-name';

export class TypeAnnotationAst implements AstNode {
  readonly syntax: SyntaxNode;

  constructor(syntax: SyntaxNode) {
    this.syntax = syntax;
  }

  /** The annotation's reference, doubling as the constructor callee when an {@link argList} follows. */
  name(): QualifiedNameAst | undefined {
    return findFirstChild(this.syntax, QualifiedNameAst.cast);
  }

  /** Present when the annotation is a constructor (`Vector(1536)`) rather than a plain reference. */
  argList(): AttributeArgListAst | undefined {
    return findFirstChild(this.syntax, AttributeArgListAst.cast);
  }

  isConstructor(): boolean {
    return this.argList() !== undefined;
  }

  lbracket(): SyntaxToken | undefined {
    return findChildToken(this.syntax, 'LBracket');
  }

  rbracket(): SyntaxToken | undefined {
    return findChildToken(this.syntax, 'RBracket');
  }

  questionMark(): SyntaxToken | undefined {
    return findChildToken(this.syntax, 'Question');
  }

  isList(): boolean {
    return this.lbracket() !== undefined;
  }

  /**
   * The list/field axis: a `?` after `]` (list nullable) or, when this is not a
   * list, the sole field-level `?`. A `?` before `[` is the element axis and
   * does not count here.
   */
  isOptional(): boolean {
    const lbracket = this.lbracket();
    if (lbracket === undefined) {
      return this.questionMark() !== undefined;
    }
    const anchor = this.rbracket() ?? lbracket;
    return this.#questionTokens().some((question) => question.index > anchor.index);
  }

  /** The element axis: a `?` positioned before `[`, meaningful only for lists. */
  isElementOptional(): boolean {
    const lbracket = this.lbracket();
    if (lbracket === undefined) {
      return false;
    }
    return this.#questionTokens().some((question) => question.index < lbracket.index);
  }

  #questionTokens(): SyntaxToken[] {
    const result: SyntaxToken[] = [];
    for (const child of this.syntax.children()) {
      if (!(child instanceof SyntaxNode) && child.kind === 'Question') {
        result.push(child);
      }
    }
    return result;
  }

  static cast(node: SyntaxNode): TypeAnnotationAst | undefined {
    return node.kind === 'TypeAnnotation' ? new TypeAnnotationAst(node) : undefined;
  }
}
