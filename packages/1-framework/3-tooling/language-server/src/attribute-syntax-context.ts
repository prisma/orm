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
  nonTriviaSibling,
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

interface SyntaxCursor {
  readonly offset: number;
  readonly preceding: SyntaxToken | undefined;
}

export interface ArgumentListSyntaxFrame {
  readonly kind: 'arguments';
  readonly node: AttributeArgListAst | FunctionCallAst;
  readonly insideDelimiters: boolean;
  readonly containingArgument: AttributeArgAst | undefined;
  readonly precedingArgument: AttributeArgAst | undefined;
  readonly followingArgument: AttributeArgAst | undefined;
  readonly region: 'name' | 'value' | 'separator' | 'trivia';
}

export interface ExpressionSyntaxFrame {
  readonly kind: 'expression';
  readonly node: ExpressionAst;
  readonly recovered: boolean;
  readonly atBoundaryOrOutside: boolean;
  readonly insideDelimiters: boolean;
  readonly childEdge: 'listElement' | 'recordValue' | undefined;
}

export type AttributeSyntaxFrame = ArgumentListSyntaxFrame | ExpressionSyntaxFrame;

export interface AttributeSyntaxContext extends SyntaxCursor {
  readonly attribute: FieldAttributeAst | ModelAttributeAst;
  readonly frames: readonly AttributeSyntaxFrame[];
}

export function locateAttributeSyntax(input: PslCursorInput): AttributeSyntaxContext | undefined {
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
  if (attribute === undefined || !attributeContainsOffset(attribute, offset)) return undefined;
  return locateAttributeArguments(attribute, offset);
}

export function attributeContainsOffset(
  attribute: FieldAttributeAst | ModelAttributeAst,
  offset: number,
): boolean {
  if (attribute.syntax.isInside(offset)) return true;
  const args = attribute.argList();
  return args !== undefined && args.rparen() === undefined && offset >= args.syntax.endOffset;
}

export function locateAttributeArguments(
  attribute: FieldAttributeAst | ModelAttributeAst,
  offset: number,
): AttributeSyntaxContext {
  const at = attribute.syntax.tokenAtOffset(offset);
  const anchor = at.leftBiased() ?? attribute.syntax.lastToken;
  const cursor = {
    offset,
    preceding: anchor === undefined ? undefined : skipTriviaToken(anchor, 'prev'),
  };
  const frames: AttributeSyntaxFrame[] = [];
  const args = attribute.argList();
  if (args !== undefined) locateArguments(cursor, args, frames);
  return { ...cursor, attribute, frames };
}

export function argumentSiblings(
  frame: ArgumentListSyntaxFrame,
  selected: AttributeArgAst | undefined,
  offset: number,
): { precedingPositionalCount: number; otherNamedKeys: readonly string[] } {
  let precedingPositionalCount = 0;
  const otherNamedKeys: string[] = [];
  let beforeSelected = true;
  for (const arg of frame.node.args()) {
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

function locateArguments(
  cursor: SyntaxCursor,
  node: AttributeArgListAst | FunctionCallAst,
  frames: AttributeSyntaxFrame[],
): void {
  const insideDelimiters = betweenDelimiters(cursor.offset, node.lparen(), node.rparen());
  let containingArgument: AttributeArgAst | undefined;
  let precedingArgument: AttributeArgAst | undefined;
  let followingArgument: AttributeArgAst | undefined;
  const next =
    cursor.preceding?.kind === 'Comma' ? nonTriviaSibling(cursor.preceding, 'next') : undefined;
  for (const arg of node.args()) {
    if (next?.offset === arg.syntax.offset) followingArgument = arg;
    if (arg.syntax.endOffset <= cursor.offset) precedingArgument = arg;
    if (
      containingArgument === undefined &&
      arg.syntax.offset <= cursor.offset &&
      (containsCursor(arg.syntax, cursor) ||
        recoveredContainerContainsCursor(arg.value(), cursor.offset))
    )
      containingArgument = arg;
  }
  frames.push({
    kind: 'arguments',
    node,
    insideDelimiters,
    containingArgument,
    precedingArgument,
    followingArgument,
    region: argumentRegion(cursor, containingArgument),
  });
  if (insideDelimiters) locateExpression(cursor, containingArgument?.value(), frames);
}

function locateExpression(
  cursor: SyntaxCursor,
  node: ExpressionAst | undefined,
  frames: AttributeSyntaxFrame[],
): void {
  if (node === undefined) return;
  const recovered = recoveredContainerContainsCursor(node, cursor.offset);
  const atBoundaryOrOutside =
    cursor.offset <= node.syntax.offset || (cursor.offset >= node.syntax.endOffset && !recovered);
  let insideDelimiters = true;
  let child: ExpressionAst | undefined;
  let childEdge: ExpressionSyntaxFrame['childEdge'];
  if (node instanceof ArrayLiteralAst) {
    insideDelimiters = betweenDelimiters(cursor.offset, node.lbracket(), node.rbracket());
    if (insideDelimiters) {
      child = listElementAtCursor(cursor, node);
      childEdge = 'listElement';
    }
  } else if (node instanceof ObjectLiteralExprAst) {
    const closing = node.rbrace();
    insideDelimiters = closing === undefined || cursor.offset < closing.endOffset;
    if (insideDelimiters) {
      const field = recordFieldAtCursor(cursor, node);
      child = field?.value();
      childEdge = field === undefined ? undefined : 'recordValue';
    }
  } else if (node instanceof FunctionCallAst) {
    insideDelimiters = betweenDelimiters(cursor.offset, node.lparen(), node.rparen());
  }
  frames.push({
    kind: 'expression',
    node,
    recovered,
    atBoundaryOrOutside,
    insideDelimiters,
    childEdge,
  });
  const opening = node instanceof FunctionCallAst ? node.lparen() : undefined;
  if (node instanceof FunctionCallAst && opening !== undefined && cursor.offset > opening.offset) {
    locateArguments(cursor, node, frames);
  } else {
    locateExpression(cursor, child, frames);
  }
}

function argumentRegion(
  cursor: SyntaxCursor,
  argument: AttributeArgAst | undefined,
): ArgumentListSyntaxFrame['region'] {
  if (argument !== undefined) {
    const colon = argument.colon();
    return colon !== undefined && cursor.offset <= colon.offset ? 'name' : 'value';
  }
  return cursor.preceding?.kind === 'Comma' && cursor.offset === cursor.preceding.endOffset
    ? 'separator'
    : 'trivia';
}

function listElementAtCursor(cursor: SyntaxCursor, node: ArrayLiteralAst) {
  for (const element of node.elements()) {
    if (
      containsCursor(element.syntax, cursor) ||
      recoveredContainerContainsCursor(element, cursor.offset)
    )
      return element;
  }
  return undefined;
}

function recordFieldAtCursor(cursor: SyntaxCursor, node: ObjectLiteralExprAst) {
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

function betweenDelimiters(
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

function recoveredContainerContainsCursor(
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
