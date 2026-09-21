import {
  ArrayLiteralAst,
  type AttributeArgAst,
  type AttributeArgListAst,
  any,
  type DocumentAst,
  type ExpressionAst,
  FieldAttributeAst,
  FunctionCallAst,
  isTrivia,
  ModelAttributeAst,
  ObjectLiteralExprAst,
  type Position,
  type SourceFile,
  type SyntaxNode,
  type SyntaxToken,
  skipTriviaToken,
} from '@internal/psl-parser/syntax';

export interface PslCursorInput {
  readonly document: DocumentAst;
  readonly sourceFile: SourceFile;
  readonly position: Position;
}

export type AttributeArgumentPathStep =
  | { readonly kind: 'positionalArgument'; readonly index: number }
  | { readonly kind: 'namedArgument'; readonly name: string }
  | { readonly kind: 'listElement' }
  | { readonly kind: 'recordValue' }
  | { readonly kind: 'functionCall'; readonly name: string };

export interface SyntaxCursor {
  readonly offset: number;
  readonly preceding: SyntaxToken | undefined;
}

export function locateAttributeSyntax(input: PslCursorInput) {
  const offset = input.sourceFile.offsetAt(input.position);
  const at = input.document.syntax.tokenAtOffset(offset);
  if (at.leftBiased()?.kind === 'Comment') return undefined;
  const token = at.leftBiased() ?? at.rightBiased();
  const attribute =
    token === undefined
      ? undefined
      : skipTriviaToken(token, 'prev')?.parent.findAncestor(
          any(FieldAttributeAst.cast, ModelAttributeAst.cast),
        );
  if (attribute === undefined || !isWithinAttributeOrOpenArguments(attribute, offset))
    return undefined;
  return { attribute, ...attributeCursor(attribute, offset) };
}

export function isWithinAttributeOrOpenArguments(
  attribute: FieldAttributeAst | ModelAttributeAst,
  offset: number,
): boolean {
  if (attribute.syntax.isInside(offset)) return true;
  const args = attribute.argList();
  return args !== undefined && args.rparen() === undefined && offset >= args.syntax.endOffset;
}

export function attributeCursor(
  attribute: FieldAttributeAst | ModelAttributeAst,
  offset: number,
): SyntaxCursor {
  const at = attribute.syntax.tokenAtOffset(offset);
  const anchor = at.leftBiased() ?? attribute.syntax.lastToken;
  return {
    offset,
    preceding: anchor === undefined ? undefined : skipTriviaToken(anchor, 'prev'),
  };
}

export function argumentSiblings(
  node: AttributeArgListAst | FunctionCallAst,
  selected: AttributeArgAst | undefined,
  offset: number,
): { precedingPositionalCount: number; otherNamedKeys: readonly string[] } {
  let precedingPositionalCount = 0;
  const otherNamedKeys: string[] = [];
  let beforeSelected = true;
  for (const arg of node.args()) {
    if (arg.syntax.offset === selected?.syntax.offset) {
      beforeSelected = false;
      continue;
    }
    const name = arg.name()?.name();
    if (name !== undefined) otherNamedKeys.push(name);
    else if (beforeSelected && arg.syntax.offset <= offset) precedingPositionalCount += 1;
  }
  return { precedingPositionalCount, otherNamedKeys };
}

export function argumentAtCursor(
  cursor: SyntaxCursor,
  node: AttributeArgListAst | FunctionCallAst,
) {
  for (const arg of node.args()) {
    if (
      arg.syntax.offset <= cursor.offset &&
      (containsCursor(arg.syntax, cursor) ||
        recoveredContainerContainsCursor(arg.value(), cursor.offset))
    )
      return arg;
  }
  return undefined;
}

export function listElementAtCursor(cursor: SyntaxCursor, node: ArrayLiteralAst) {
  for (const element of node.elements()) {
    if (
      containsCursor(element.syntax, cursor) ||
      recoveredContainerContainsCursor(element, cursor.offset)
    )
      return element;
  }
  return undefined;
}

export function recordFieldAtCursor(cursor: SyntaxCursor, node: ObjectLiteralExprAst) {
  for (const field of node.fields()) {
    const colon = field.colon();
    if (
      colon !== undefined &&
      cursor.offset > colon.offset &&
      (containsCursor(field.syntax, cursor) ||
        recoveredContainerContainsCursor(field.value(), cursor.offset))
    )
      return field;
  }
  return undefined;
}

export function betweenDelimiters(
  offset: number,
  opening: SyntaxToken | undefined,
  closing: SyntaxToken | undefined,
): boolean {
  return (
    opening !== undefined &&
    offset > opening.offset &&
    (closing === undefined || offset < closing.endOffset)
  );
}

export function recoveredContainerContainsCursor(
  expression: ExpressionAst | undefined,
  offset: number,
): boolean {
  if (expression === undefined || expression.syntax.endOffset > offset) return false;
  const unfinished =
    expression instanceof ArrayLiteralAst
      ? expression.rbracket() === undefined
      : expression instanceof ObjectLiteralExprAst
        ? expression.rbrace() === undefined
        : expression instanceof FunctionCallAst && expression.rparen() === undefined;
  if (!unfinished) return false;
  for (
    let token = expression.syntax.lastToken?.nextToken;
    token !== undefined;
    token = token.nextToken
  ) {
    if (token.offset >= offset) return true;
    if (!isTrivia(token) && token.kind !== 'Comma') return false;
  }
  return true;
}

function containsCursor(node: SyntaxNode, cursor: SyntaxCursor): boolean {
  if (node.isInside(cursor.offset)) return true;
  const preceding = cursor.preceding;
  return (
    preceding !== undefined &&
    preceding.endOffset <= cursor.offset &&
    preceding.offset >= node.offset &&
    preceding.offset < node.endOffset
  );
}
