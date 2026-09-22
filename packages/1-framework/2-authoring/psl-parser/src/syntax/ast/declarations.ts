import type { AstNode, BracedBlock } from '../ast-helpers';
import { filterChildren, findChildToken, findFirstChild } from '../ast-helpers';
import { SyntaxNode, type SyntaxToken } from '../red';
import { FieldAttributeAst, ModelAttributeAst } from './attributes';
import type { ExpressionAst } from './expressions';
import { castExpression } from './expressions';
import { IdentifierAst } from './identifier';
import { TypeAnnotationAst } from './type-annotation';

/**
 * What may appear inside a `namespace` block: models, composite types, and
 * extension (block) declarations. `types {}` blocks and nested `namespace`
 * blocks are document-only, so they are not namespace members.
 */
export type NamespaceMemberAst =
  | ModelDeclarationAst
  | CompositeTypeDeclarationAst
  | GenericBlockDeclarationAst;

export type DeclarationAst = NamespaceMemberAst | TypesBlockAst | NamespaceDeclarationAst;
export type AttributeAst = FieldAttributeAst | ModelAttributeAst;
export type BlockMemberAst = FieldDeclarationAst | ModelAttributeAst;
export type GenericBlockMemberAst = KeyValuePairAst | ModelAttributeAst;

function castNamespaceMember(node: SyntaxNode): NamespaceMemberAst | undefined {
  return (
    ModelDeclarationAst.cast(node) ??
    CompositeTypeDeclarationAst.cast(node) ??
    GenericBlockDeclarationAst.cast(node)
  );
}

export class DocumentAst implements AstNode {
  readonly syntax: SyntaxNode;

  constructor(syntax: SyntaxNode) {
    this.syntax = syntax;
  }

  *declarations(): Iterable<DeclarationAst> {
    yield* filterChildren(
      this.syntax,
      (node) =>
        castNamespaceMember(node) ?? TypesBlockAst.cast(node) ?? NamespaceDeclarationAst.cast(node),
    );
  }

  static cast(node: SyntaxNode): DocumentAst | undefined {
    return node.kind === 'Document' ? new DocumentAst(node) : undefined;
  }
}

export class ModelDeclarationAst implements BracedBlock {
  readonly syntax: SyntaxNode;

  constructor(syntax: SyntaxNode) {
    this.syntax = syntax;
  }

  keyword(): SyntaxToken | undefined {
    return findChildToken(this.syntax, 'Ident');
  }

  name(): IdentifierAst | undefined {
    return findFirstChild(this.syntax, IdentifierAst.cast);
  }

  lbrace(): SyntaxToken | undefined {
    return findChildToken(this.syntax, 'LBrace');
  }

  rbrace(): SyntaxToken | undefined {
    return findChildToken(this.syntax, 'RBrace');
  }

  *fields(): Iterable<FieldDeclarationAst> {
    yield* filterChildren(this.syntax, FieldDeclarationAst.cast);
  }

  *attributes(): Iterable<ModelAttributeAst> {
    yield* filterChildren(this.syntax, ModelAttributeAst.cast);
  }

  *members(): Iterable<BlockMemberAst> {
    yield* filterChildren(
      this.syntax,
      (node) => FieldDeclarationAst.cast(node) ?? ModelAttributeAst.cast(node),
    );
  }

  static cast(node: SyntaxNode): ModelDeclarationAst | undefined {
    return node.kind === 'ModelDeclaration' ? new ModelDeclarationAst(node) : undefined;
  }
}

export class CompositeTypeDeclarationAst implements BracedBlock {
  readonly syntax: SyntaxNode;

  constructor(syntax: SyntaxNode) {
    this.syntax = syntax;
  }

  keyword(): SyntaxToken | undefined {
    return findChildToken(this.syntax, 'Ident');
  }

  name(): IdentifierAst | undefined {
    return findFirstChild(this.syntax, IdentifierAst.cast);
  }

  lbrace(): SyntaxToken | undefined {
    return findChildToken(this.syntax, 'LBrace');
  }

  rbrace(): SyntaxToken | undefined {
    return findChildToken(this.syntax, 'RBrace');
  }

  *fields(): Iterable<FieldDeclarationAst> {
    yield* filterChildren(this.syntax, FieldDeclarationAst.cast);
  }

  *attributes(): Iterable<ModelAttributeAst> {
    yield* filterChildren(this.syntax, ModelAttributeAst.cast);
  }

  *members(): Iterable<BlockMemberAst> {
    yield* filterChildren(
      this.syntax,
      (node) => FieldDeclarationAst.cast(node) ?? ModelAttributeAst.cast(node),
    );
  }

  static cast(node: SyntaxNode): CompositeTypeDeclarationAst | undefined {
    return node.kind === 'CompositeTypeDeclaration'
      ? new CompositeTypeDeclarationAst(node)
      : undefined;
  }
}

export class NamespaceDeclarationAst implements BracedBlock {
  readonly syntax: SyntaxNode;

  constructor(syntax: SyntaxNode) {
    this.syntax = syntax;
  }

  keyword(): SyntaxToken | undefined {
    return findChildToken(this.syntax, 'Ident');
  }

  name(): IdentifierAst | undefined {
    return findFirstChild(this.syntax, IdentifierAst.cast);
  }

  lbrace(): SyntaxToken | undefined {
    return findChildToken(this.syntax, 'LBrace');
  }

  rbrace(): SyntaxToken | undefined {
    return findChildToken(this.syntax, 'RBrace');
  }

  *declarations(): Iterable<NamespaceMemberAst> {
    yield* filterChildren(this.syntax, castNamespaceMember);
  }

  static cast(node: SyntaxNode): NamespaceDeclarationAst | undefined {
    return node.kind === 'Namespace' ? new NamespaceDeclarationAst(node) : undefined;
  }
}

export class TypesBlockAst implements BracedBlock {
  readonly syntax: SyntaxNode;

  constructor(syntax: SyntaxNode) {
    this.syntax = syntax;
  }

  keyword(): SyntaxToken | undefined {
    return findChildToken(this.syntax, 'Ident');
  }

  lbrace(): SyntaxToken | undefined {
    return findChildToken(this.syntax, 'LBrace');
  }

  rbrace(): SyntaxToken | undefined {
    return findChildToken(this.syntax, 'RBrace');
  }

  *declarations(): Iterable<NamedTypeDeclarationAst> {
    yield* filterChildren(this.syntax, NamedTypeDeclarationAst.cast);
  }

  static cast(node: SyntaxNode): TypesBlockAst | undefined {
    return node.kind === 'TypesBlock' ? new TypesBlockAst(node) : undefined;
  }
}

export class GenericBlockDeclarationAst implements BracedBlock {
  readonly syntax: SyntaxNode;

  constructor(syntax: SyntaxNode) {
    this.syntax = syntax;
  }

  keyword(): SyntaxToken | undefined {
    return findChildToken(this.syntax, 'Ident');
  }

  name(): IdentifierAst | undefined {
    return findFirstChild(this.syntax, IdentifierAst.cast);
  }

  lbrace(): SyntaxToken | undefined {
    return findChildToken(this.syntax, 'LBrace');
  }

  rbrace(): SyntaxToken | undefined {
    return findChildToken(this.syntax, 'RBrace');
  }

  *entries(): Iterable<KeyValuePairAst> {
    yield* filterChildren(this.syntax, KeyValuePairAst.cast);
  }

  /** Field lines of a block parsed with the model-member grammar (a Prisma 7 `view`). Empty for every other generic block. */
  *fields(): Iterable<FieldDeclarationAst> {
    yield* filterChildren(this.syntax, FieldDeclarationAst.cast);
  }

  *attributes(): Iterable<ModelAttributeAst> {
    yield* filterChildren(this.syntax, ModelAttributeAst.cast);
  }

  *members(): Iterable<GenericBlockMemberAst> {
    yield* filterChildren(
      this.syntax,
      (node) => KeyValuePairAst.cast(node) ?? ModelAttributeAst.cast(node),
    );
  }

  static cast(node: SyntaxNode): GenericBlockDeclarationAst | undefined {
    return node.kind === 'GenericBlockDeclaration'
      ? new GenericBlockDeclarationAst(node)
      : undefined;
  }
}

export class KeyValuePairAst implements AstNode {
  readonly syntax: SyntaxNode;

  constructor(syntax: SyntaxNode) {
    this.syntax = syntax;
  }

  key(): IdentifierAst | undefined {
    return findFirstChild(this.syntax, IdentifierAst.cast);
  }

  equals(): SyntaxToken | undefined {
    return findChildToken(this.syntax, 'Equals');
  }

  value(): ExpressionAst | undefined {
    let pastEquals = false;
    for (const child of this.syntax.children()) {
      if (!(child instanceof SyntaxNode)) {
        if (child.kind === 'Equals') pastEquals = true;
        continue;
      }
      if (pastEquals) {
        const expr = castExpression(child);
        if (expr) return expr;
      }
    }
    return undefined;
  }

  /** `@` attributes after the key or value (a Prisma 7 enum member's `@map`). */
  *attributes(): Iterable<FieldAttributeAst> {
    yield* filterChildren(this.syntax, FieldAttributeAst.cast);
  }

  static cast(node: SyntaxNode): KeyValuePairAst | undefined {
    return node.kind === 'KeyValuePair' ? new KeyValuePairAst(node) : undefined;
  }
}

export class FieldDeclarationAst implements AstNode {
  readonly syntax: SyntaxNode;

  constructor(syntax: SyntaxNode) {
    this.syntax = syntax;
  }

  name(): IdentifierAst | undefined {
    return findFirstChild(this.syntax, IdentifierAst.cast);
  }

  typeAnnotation(): TypeAnnotationAst | undefined {
    return findFirstChild(this.syntax, TypeAnnotationAst.cast);
  }

  *attributes(): Iterable<FieldAttributeAst> {
    yield* filterChildren(this.syntax, FieldAttributeAst.cast);
  }

  static cast(node: SyntaxNode): FieldDeclarationAst | undefined {
    return node.kind === 'FieldDeclaration' ? new FieldDeclarationAst(node) : undefined;
  }
}

export class NamedTypeDeclarationAst implements AstNode {
  readonly syntax: SyntaxNode;

  constructor(syntax: SyntaxNode) {
    this.syntax = syntax;
  }

  name(): IdentifierAst | undefined {
    return findFirstChild(this.syntax, IdentifierAst.cast);
  }

  equals(): SyntaxToken | undefined {
    return findChildToken(this.syntax, 'Equals');
  }

  typeAnnotation(): TypeAnnotationAst | undefined {
    return findFirstChild(this.syntax, TypeAnnotationAst.cast);
  }

  *attributes(): Iterable<FieldAttributeAst> {
    yield* filterChildren(this.syntax, FieldAttributeAst.cast);
  }

  static cast(node: SyntaxNode): NamedTypeDeclarationAst | undefined {
    return node.kind === 'NamedTypeDeclaration' ? new NamedTypeDeclarationAst(node) : undefined;
  }
}
