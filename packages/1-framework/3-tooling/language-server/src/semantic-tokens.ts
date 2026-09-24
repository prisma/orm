import type { SymbolTable } from '@internal/psl-parser';
import {
  ArrayLiteralAst,
  type AttributeArgAst,
  type AttributeArgListAst,
  type AttributeAst,
  type BlockMemberAst,
  BooleanLiteralExprAst,
  CompositeTypeDeclarationAst,
  type DeclarationAst,
  type DocumentAst,
  type ExpressionAst,
  FieldDeclarationAst,
  FunctionCallAst,
  filterChildren,
  findChildToken,
  type GenericBlockMemberAst,
  IdentifierAst,
  ModelDeclarationAst,
  type NamedTypeDeclarationAst,
  NamespaceDeclarationAst,
  NumberLiteralExprAst,
  ObjectLiteralExprAst,
  type QualifiedNameAst,
  type SourceFile,
  StringLiteralExprAst,
  type SyntaxToken,
  TaggedLiteralExprAst,
  type TypeAnnotationAst,
  TypesBlockAst,
} from '@internal/psl-parser/syntax';
import {
  type Range,
  SemanticTokenModifiers,
  type SemanticTokens,
  type SemanticTokensLegend,
  SemanticTokenTypes,
} from 'vscode-languageserver';
import { refinesScalarType } from './named-type-classification';

export type SemanticTokenType =
  | 'keyword'
  | 'namespace'
  | 'class'
  | 'struct'
  | 'type'
  | 'property'
  | 'decorator'
  | 'string'
  | 'number'
  | 'comment';

export type SemanticTokenModifier = 'declaration' | 'defaultLibrary';

export const semanticTokenTypes: readonly SemanticTokenType[] = [
  SemanticTokenTypes.keyword,
  SemanticTokenTypes.namespace,
  SemanticTokenTypes.class,
  SemanticTokenTypes.struct,
  SemanticTokenTypes.type,
  SemanticTokenTypes.property,
  SemanticTokenTypes.decorator,
  SemanticTokenTypes.string,
  SemanticTokenTypes.number,
  SemanticTokenTypes.comment,
];

export const semanticTokenModifiers = [
  SemanticTokenModifiers.declaration,
  SemanticTokenModifiers.defaultLibrary,
] as const satisfies readonly SemanticTokenModifier[];

export const semanticTokenModifierIndexes = {
  declaration: 0,
  defaultLibrary: 1,
} as const satisfies Record<SemanticTokenModifier, number>;

export const semanticTokenModifierBits = {
  declaration: 1 << semanticTokenModifierIndexes.declaration,
  defaultLibrary: 1 << semanticTokenModifierIndexes.defaultLibrary,
} as const satisfies Record<SemanticTokenModifier, number>;

export const semanticTokensLegend: SemanticTokensLegend = {
  tokenTypes: [...semanticTokenTypes],
  tokenModifiers: [...semanticTokenModifiers],
};

export interface SemanticTokenSource {
  readonly document: DocumentAst;
  readonly sourceFile: SourceFile;
  readonly symbolTable: SymbolTable;
  readonly scalarTypes: readonly string[];
}

export interface PendingSemanticToken {
  readonly startOffset: number;
  readonly endOffset: number;
  readonly tokenTypeIndex: number;
  readonly modifierBitset: number;
  readonly splitMultiline: boolean;
}

type TypeReferenceKind = 'class' | 'struct' | 'type';

interface TypeReferenceClassification {
  readonly tokenType: TypeReferenceKind;
  readonly modifierBitset?: number;
}

interface IdentifierSegment {
  readonly identifier: IdentifierAst;
  readonly text: string;
}

interface ExpressionContext {
  readonly bareIdentifierTokenType?: SemanticTokenType;
}

export function buildSemanticTokens(source: SemanticTokenSource, range?: Range): SemanticTokens {
  const builder = new SemanticTokensBuilder(source.sourceFile, range);
  for (const token of collectSemanticTokenEvents(source)) {
    builder.add(token);
  }
  return builder.build();
}

export function collectSemanticTokenEvents(
  source: SemanticTokenSource,
): readonly PendingSemanticToken[] {
  const comments = collectCommentTokens(source.document);
  const tokens: PendingSemanticToken[] = [];
  collectDeclarations(source, tokens);
  return mergeSourceOrderedTokens(comments, tokens);
}

export class SemanticTokensBuilder {
  readonly #data: number[] = [];
  readonly #sourceFile: SourceFile;
  readonly #rangeOffsets: { readonly lower: number; readonly upper: number } | undefined;
  #previousLine = 0;
  #previousCharacter = 0;
  #first = true;

  constructor(sourceFile: SourceFile, range?: Range) {
    this.#sourceFile = sourceFile;
    if (range !== undefined) {
      const startOffset = sourceFile.offsetAt(range.start);
      const endOffset = sourceFile.offsetAt(range.end);
      this.#rangeOffsets = {
        lower: Math.min(startOffset, endOffset),
        upper: Math.max(startOffset, endOffset),
      };
    }
  }

  add(token: PendingSemanticToken): void {
    if (!this.#intersectsRange(token.startOffset, token.endOffset)) {
      return;
    }

    if (token.splitMultiline) {
      this.#addMultilineSplitToken(token);
      return;
    }

    this.#encode(token.startOffset, token.endOffset, token.tokenTypeIndex, token.modifierBitset);
  }

  build(): SemanticTokens {
    return { data: this.#data };
  }

  #intersectsRange(startOffset: number, endOffset: number): boolean {
    const rangeOffsets = this.#rangeOffsets;
    return (
      rangeOffsets === undefined ||
      (startOffset < rangeOffsets.upper && endOffset > rangeOffsets.lower)
    );
  }

  #addMultilineSplitToken(token: PendingSemanticToken): void {
    const start = this.#sourceFile.positionAt(token.startOffset);
    const end = this.#sourceFile.positionAt(token.endOffset);
    if (start.line === end.line) {
      this.#encode(token.startOffset, token.endOffset, token.tokenTypeIndex, token.modifierBitset);
      return;
    }

    for (let line = start.line; line <= end.line; line++) {
      const startOffset =
        line === start.line ? token.startOffset : this.#sourceFile.lineStartOffset(line);
      const endOffset = line === end.line ? token.endOffset : this.#sourceFile.lineEndOffset(line);
      if (endOffset > startOffset && this.#intersectsRange(startOffset, endOffset)) {
        this.#encode(startOffset, endOffset, token.tokenTypeIndex, token.modifierBitset);
      }
    }
  }

  #encode(
    startOffset: number,
    endOffset: number,
    tokenTypeIndex: number,
    modifierBitset: number,
  ): void {
    const start = this.#sourceFile.positionAt(startOffset);
    const deltaLine = this.#first ? start.line : start.line - this.#previousLine;
    const deltaStart =
      this.#first || deltaLine !== 0 ? start.character : start.character - this.#previousCharacter;
    this.#data.push(deltaLine, deltaStart, endOffset - startOffset, tokenTypeIndex, modifierBitset);
    this.#previousLine = start.line;
    this.#previousCharacter = start.character;
    this.#first = false;
  }
}

function collectCommentTokens(document: DocumentAst): readonly PendingSemanticToken[] {
  const tokens: PendingSemanticToken[] = [];
  for (const token of document.syntax.tokens()) {
    if (token.kind === 'Comment') {
      tokens.push(pendingTokenForToken(token, 'comment'));
    }
  }
  return tokens;
}

function collectDeclarations(source: SemanticTokenSource, tokens: PendingSemanticToken[]): void {
  for (const declaration of source.document.declarations()) {
    collectDeclaration(declaration, source, tokens, undefined);
  }
}

function collectDeclaration(
  declaration: DeclarationAst,
  source: SemanticTokenSource,
  tokens: PendingSemanticToken[],
  namespace: string | undefined,
): void {
  if (declaration instanceof ModelDeclarationAst) {
    addToken(declaration.keyword(), 'keyword', tokens);
    addIdentifier(declaration.name(), 'class', tokens, semanticTokenModifierBits.declaration);
    collectBlockMembers(declaration.members(), source, tokens, namespace);
    return;
  }

  if (declaration instanceof CompositeTypeDeclarationAst) {
    addToken(declaration.keyword(), 'keyword', tokens);
    addIdentifier(declaration.name(), 'struct', tokens, semanticTokenModifierBits.declaration);
    collectBlockMembers(declaration.members(), source, tokens, namespace);
    return;
  }

  if (declaration instanceof NamespaceDeclarationAst) {
    addToken(declaration.keyword(), 'keyword', tokens);
    addIdentifier(declaration.name(), 'namespace', tokens, semanticTokenModifierBits.declaration);
    const nestedNamespace = declaration.name()?.name();
    for (const nested of declaration.declarations()) {
      collectDeclaration(nested, source, tokens, nestedNamespace);
    }
    return;
  }

  if (declaration instanceof TypesBlockAst) {
    addToken(declaration.keyword(), 'keyword', tokens);
    for (const namedType of declaration.declarations()) {
      collectNamedTypeDeclaration(namedType, source, tokens, namespace);
    }
    return;
  }

  addToken(declaration.keyword(), 'keyword', tokens);
  addIdentifier(declaration.name(), 'type', tokens, semanticTokenModifierBits.declaration);
  collectGenericBlockMembers(declaration.members(), source, tokens, namespace);
}

function collectNamedTypeDeclaration(
  declaration: NamedTypeDeclarationAst,
  source: SemanticTokenSource,
  tokens: PendingSemanticToken[],
  namespace: string | undefined,
): void {
  addIdentifier(declaration.name(), 'type', tokens, semanticTokenModifierBits.declaration);
  collectTypeAnnotation(declaration.typeAnnotation(), source, tokens, namespace);
  collectAttributes(declaration.attributes(), source, tokens, namespace);
}

function collectGenericBlockMembers(
  members: Iterable<GenericBlockMemberAst>,
  source: SemanticTokenSource,
  tokens: PendingSemanticToken[],
  namespace: string | undefined,
): void {
  for (const member of members) {
    if ('key' in member) {
      addIdentifier(member.key(), 'property', tokens);
      collectExpression(member.value(), source, tokens, namespace);
      continue;
    }
    collectAttribute(member, source, tokens, namespace);
  }
}

function collectBlockMembers(
  members: Iterable<BlockMemberAst>,
  source: SemanticTokenSource,
  tokens: PendingSemanticToken[],
  namespace: string | undefined,
): void {
  for (const member of members) {
    if (member instanceof FieldDeclarationAst) {
      collectField(member, source, tokens, namespace);
      continue;
    }
    collectAttribute(member, source, tokens, namespace);
  }
}

function collectField(
  field: FieldDeclarationAst,
  source: SemanticTokenSource,
  tokens: PendingSemanticToken[],
  namespace: string | undefined,
): void {
  addIdentifier(field.name(), 'property', tokens, semanticTokenModifierBits.declaration);
  collectTypeAnnotation(field.typeAnnotation(), source, tokens, namespace);
  collectAttributes(field.attributes(), source, tokens, namespace);
}

function collectTypeAnnotation(
  annotation: TypeAnnotationAst | undefined,
  source: SemanticTokenSource,
  tokens: PendingSemanticToken[],
  namespace: string | undefined,
): void {
  if (annotation === undefined) {
    return;
  }
  collectTypeReference(annotation.name(), source, tokens, namespace);
  collectAttributeArgList(annotation.argList(), source, tokens, namespace);
}

function collectAttributes(
  attributes: Iterable<AttributeAst>,
  source: SemanticTokenSource,
  tokens: PendingSemanticToken[],
  namespace: string | undefined,
): void {
  for (const attribute of attributes) {
    collectAttribute(attribute, source, tokens, namespace);
  }
}

function collectAttribute(
  attribute: AttributeAst,
  source: SemanticTokenSource,
  tokens: PendingSemanticToken[],
  namespace: string | undefined,
): void {
  const marker =
    findChildToken(attribute.syntax, 'At') ?? findChildToken(attribute.syntax, 'DoubleAt');
  collectDecoratorName(attribute.name(), marker, tokens);
  collectAttributeArgList(attribute.argList(), source, tokens, namespace);
}

function collectDecoratorName(
  name: QualifiedNameAst | undefined,
  marker: SyntaxToken | undefined,
  tokens: PendingSemanticToken[],
): void {
  if (name === undefined) {
    return;
  }
  const segments = identifierSegments(name);
  for (const [index, segment] of segments.entries()) {
    tokens.push(rangeForDecoratorIdentifier(segment.identifier, index === 0 ? marker : undefined));
  }
}

function collectAttributeArgList(
  argList: AttributeArgListAst | undefined,
  source: SemanticTokenSource,
  tokens: PendingSemanticToken[],
  namespace: string | undefined,
): void {
  if (argList === undefined) {
    return;
  }
  for (const arg of argList.args()) {
    collectAttributeArg(arg, source, tokens, namespace);
  }
}

function collectAttributeArg(
  arg: AttributeArgAst,
  source: SemanticTokenSource,
  tokens: PendingSemanticToken[],
  namespace: string | undefined,
): void {
  const name = arg.name();
  addIdentifier(name, 'property', tokens);
  collectExpression(arg.value(), source, tokens, namespace, expressionContextForAttributeArg(name));
}

function collectExpression(
  expression: ExpressionAst | undefined,
  source: SemanticTokenSource,
  tokens: PendingSemanticToken[],
  namespace: string | undefined,
  context: ExpressionContext = {},
): void {
  if (expression === undefined) {
    return;
  }

  if (expression instanceof StringLiteralExprAst) {
    addToken(expression.token(), 'string', tokens);
    return;
  }

  if (expression instanceof NumberLiteralExprAst) {
    addToken(expression.token(), 'number', tokens);
    return;
  }

  if (expression instanceof BooleanLiteralExprAst) {
    addToken(expression.token(), 'keyword', tokens);
    return;
  }

  if (expression instanceof FunctionCallAst) {
    collectTypeReference(expression.name(), source, tokens, namespace);
    for (const arg of expression.args()) {
      collectAttributeArg(arg, source, tokens, namespace);
    }
    return;
  }

  if (expression instanceof ArrayLiteralAst) {
    for (const element of expression.elements()) {
      collectExpression(element, source, tokens, namespace, context);
    }
    return;
  }

  if (expression instanceof ObjectLiteralExprAst) {
    for (const field of expression.fields()) {
      addIdentifier(field.key(), 'property', tokens);
      collectExpression(field.value(), source, tokens, namespace);
    }
    return;
  }

  if (expression instanceof TaggedLiteralExprAst) {
    return;
  }

  collectIdentifierExpression(expression, source, tokens, namespace, context);
}

function collectIdentifierExpression(
  identifier: IdentifierAst,
  source: SemanticTokenSource,
  tokens: PendingSemanticToken[],
  namespace: string | undefined,
  context: ExpressionContext,
): void {
  const text = identifier.name();
  if (text === undefined) {
    return;
  }
  const bareIdentifierTokenType = context.bareIdentifierTokenType;
  if (bareIdentifierTokenType !== undefined) {
    tokens.push(rangeForIdentifier(identifier, bareIdentifierTokenType));
    return;
  }
  const classification = classifyTypeReference([text], source, namespace);
  tokens.push(
    rangeForIdentifier(identifier, classification.tokenType, classification.modifierBitset),
  );
}

function expressionContextForAttributeArg(name: IdentifierAst | undefined): ExpressionContext {
  const argName = name?.name();
  return argName === 'fields' || argName === 'references'
    ? { bareIdentifierTokenType: 'property' }
    : {};
}

function collectTypeReference(
  name: QualifiedNameAst | undefined,
  source: SemanticTokenSource,
  tokens: PendingSemanticToken[],
  namespace: string | undefined,
): void {
  if (name === undefined) {
    return;
  }

  const segments = identifierSegments(name);
  if (segments.length === 0) {
    return;
  }

  const path = segments.map((segment) => segment.text);
  for (const segment of segments.slice(0, -1)) {
    if (isKnownNamespace(segment.text, source.symbolTable)) {
      tokens.push(rangeForIdentifier(segment.identifier, 'namespace'));
    }
  }

  const finalSegment = segments[segments.length - 1];
  if (finalSegment === undefined) {
    return;
  }
  const classification = classifyTypeReference(path, source, namespace);
  tokens.push(
    rangeForIdentifier(
      finalSegment.identifier,
      classification.tokenType,
      classification.modifierBitset,
    ),
  );
}

function classifyTypeReference(
  path: readonly string[],
  source: SemanticTokenSource,
  namespace: string | undefined,
): TypeReferenceClassification {
  const name = path[path.length - 1];
  if (name === undefined) {
    return { tokenType: 'type' };
  }

  const symbols = source.symbolTable;
  const namespaceName = path.length > 1 ? path[path.length - 2] : namespace;
  const namespaceScope =
    namespaceName !== undefined ? symbols.topLevel.namespaces[namespaceName] : undefined;

  if (namespaceScope !== undefined) {
    if (Object.hasOwn(namespaceScope.models, name)) {
      return { tokenType: 'class' };
    }
    if (Object.hasOwn(namespaceScope.compositeTypes, name)) {
      return { tokenType: 'struct' };
    }
    if (Object.hasOwn(namespaceScope.blocks, name)) {
      return { tokenType: 'type' };
    }
  }

  if (Object.hasOwn(symbols.topLevel.models, name)) {
    return { tokenType: 'class' };
  }
  if (Object.hasOwn(symbols.topLevel.compositeTypes, name)) {
    return { tokenType: 'struct' };
  }
  const namedType = symbols.topLevel.namedTypes[name];
  if (namedType !== undefined) {
    return refinesScalarType(namedType, source.scalarTypes)
      ? { tokenType: 'type', modifierBitset: semanticTokenModifierBits.defaultLibrary }
      : { tokenType: 'type' };
  }
  if (Object.hasOwn(symbols.topLevel.blocks, name)) {
    return { tokenType: 'type' };
  }

  if (source.scalarTypes.includes(name)) {
    return { tokenType: 'type', modifierBitset: semanticTokenModifierBits.defaultLibrary };
  }

  return { tokenType: 'type' };
}

function isKnownNamespace(name: string, symbols: SymbolTable): boolean {
  return Object.hasOwn(symbols.topLevel.namespaces, name);
}

function identifierSegments(name: QualifiedNameAst): readonly IdentifierSegment[] {
  const segments: IdentifierSegment[] = [];
  for (const identifier of filterChildren(name.syntax, IdentifierAst.cast)) {
    const text = identifier.name();
    if (text !== undefined) {
      segments.push({ identifier, text });
    }
  }
  return segments;
}

function addIdentifier(
  identifier: IdentifierAst | undefined,
  tokenType: SemanticTokenType,
  tokens: PendingSemanticToken[],
  modifierBitset = 0,
): void {
  if (identifier === undefined) {
    return;
  }
  tokens.push(rangeForIdentifier(identifier, tokenType, modifierBitset));
}

function addToken(
  token: SyntaxToken | undefined,
  tokenType: SemanticTokenType,
  tokens: PendingSemanticToken[],
  modifierBitset = 0,
): void {
  if (token === undefined) {
    return;
  }
  tokens.push(pendingTokenForToken(token, tokenType, modifierBitset));
}

function rangeForIdentifier(
  identifier: IdentifierAst,
  tokenType: SemanticTokenType,
  modifierBitset = 0,
): PendingSemanticToken {
  const token = identifier.token();
  if (token === undefined) {
    return createPendingSemanticToken(
      identifier.syntax.offset,
      identifier.syntax.offset,
      tokenType,
      modifierBitset,
    );
  }
  return pendingTokenForToken(token, tokenType, modifierBitset);
}

function rangeForDecoratorIdentifier(
  identifier: IdentifierAst,
  marker: SyntaxToken | undefined,
): PendingSemanticToken {
  const range = rangeForIdentifier(identifier, 'decorator');
  if (marker === undefined || marker.offset >= range.startOffset) {
    return range;
  }
  return createPendingSemanticToken(
    marker.offset,
    range.endOffset,
    'decorator',
    range.modifierBitset,
  );
}

function pendingTokenForToken(
  token: SyntaxToken,
  tokenType: SemanticTokenType,
  modifierBitset = 0,
): PendingSemanticToken {
  return createPendingSemanticToken(
    token.offset,
    token.offset + token.text.length,
    tokenType,
    modifierBitset,
  );
}

function mergeSourceOrderedTokens(
  left: readonly PendingSemanticToken[],
  right: readonly PendingSemanticToken[],
): readonly PendingSemanticToken[] {
  const result: PendingSemanticToken[] = [];
  let leftIndex = 0;
  let rightIndex = 0;

  while (leftIndex < left.length || rightIndex < right.length) {
    const leftToken = left[leftIndex];
    const rightToken = right[rightIndex];
    if (
      leftToken !== undefined &&
      (rightToken === undefined || leftToken.startOffset <= rightToken.startOffset)
    ) {
      result.push(leftToken);
      leftIndex++;
    } else if (rightToken !== undefined) {
      result.push(rightToken);
      rightIndex++;
    }
  }

  return result;
}

function createPendingSemanticToken(
  startOffset: number,
  endOffset: number,
  tokenType: SemanticTokenType,
  modifierBitset = 0,
): PendingSemanticToken {
  return {
    startOffset,
    endOffset,
    tokenTypeIndex: tokenTypeIndex(tokenType),
    modifierBitset,
    splitMultiline: tokenType === 'string' || tokenType === 'comment',
  };
}

function tokenTypeIndex(tokenType: SemanticTokenType): number {
  return semanticTokenTypes.indexOf(tokenType);
}
