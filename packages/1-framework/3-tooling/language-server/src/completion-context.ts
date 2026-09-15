import {
  ArrayLiteralAst,
  type AttributeArgAst,
  AttributeArgListAst,
  any,
  type BracedBlock,
  CompositeTypeDeclarationAst,
  type DocumentAst,
  type ExpressionAst,
  FieldAttributeAst,
  FieldDeclarationAst,
  FunctionCallAst,
  GenericBlockDeclarationAst,
  IdentifierAst,
  isTrivia,
  KeyValuePairAst,
  ModelAttributeAst,
  ModelDeclarationAst,
  NamespaceDeclarationAst,
  ObjectLiteralExprAst,
  type Position,
  type QualifiedNameAst,
  type SourceFile,
  type SyntaxNode,
  type SyntaxToken,
  skipTriviaToken,
  type TokenAtOffset,
  TypesBlockAst,
} from '@internal/psl-parser/syntax';

export interface ClassifyPslCompletionContextInput {
  readonly document: DocumentAst;
  readonly sourceFile: SourceFile;
  readonly position: Position;
}

export interface ModelTypeCompletionContext {
  readonly kind: 'modelType';
  readonly offset: number;
  readonly fieldName: string;
  readonly replacementStartOffset: number;
}

export interface SpaceMemberCompletionContext {
  readonly kind: 'spaceMember';
  readonly offset: number;
  readonly fieldName: string;
  readonly replacementStartOffset: number;
  readonly space: string;
}

export interface NamespaceMemberCompletionContext {
  readonly kind: 'namespaceMember';
  readonly offset: number;
  readonly fieldName: string;
  readonly replacementStartOffset: number;
  readonly namespace: string;
  readonly space?: string;
}

export interface GenericBlockKeyCompletionContext {
  readonly kind: 'genericBlockKey';
  readonly offset: number;
  readonly blockKeyword: string;
  readonly replacementStartOffset: number;
  readonly block: GenericBlockDeclarationAst;
}

export interface GenericBlockValueCompletionContext {
  readonly kind: 'genericBlockValue';
  readonly offset: number;
  readonly blockKeyword: string;
  readonly replacementStartOffset: number;
}

interface CompletionReplacement {
  readonly offset: number;
  readonly replacementStartOffset: number;
  readonly replacementEndOffset: number;
}

interface AttributeNamePosition extends CompletionReplacement {
  readonly hasArgumentList: boolean;
}

interface FieldAttributeOwner {
  readonly field: FieldDeclarationAst;
  readonly model: ModelDeclarationAst;
}

interface ModelAttributeOwner {
  readonly model: ModelDeclarationAst;
}

interface BlockAttributeOwner {
  readonly block: GenericBlockDeclarationAst;
  readonly blockKeyword: string;
}

export interface FieldAttributeNameCompletionContext
  extends FieldAttributeOwner,
    AttributeNamePosition {
  readonly kind: 'fieldAttributeName';
}

export interface ModelAttributeNameCompletionContext
  extends ModelAttributeOwner,
    AttributeNamePosition {
  readonly kind: 'modelAttributeName';
}

export interface BlockAttributeNameCompletionContext
  extends BlockAttributeOwner,
    AttributeNamePosition {
  readonly kind: 'blockAttributeName';
}

export type AttributeNameCompletionContext =
  | BlockAttributeNameCompletionContext
  | FieldAttributeNameCompletionContext
  | ModelAttributeNameCompletionContext;

export type AttributeArgumentPathStep =
  | { readonly kind: 'positionalArgument'; readonly index: number }
  | { readonly kind: 'namedArgument'; readonly name: string }
  | { readonly kind: 'listElement' }
  | { readonly kind: 'recordValue' }
  | { readonly kind: 'functionCall'; readonly name: string };

export interface AttributeArgumentPosition extends CompletionReplacement {
  readonly attributeName: string;
  readonly path: readonly AttributeArgumentPathStep[];
}

export interface AttributeNamedKeyPosition extends AttributeArgumentPosition {
  readonly existingNamedKeys: readonly string[];
  readonly hasColon: boolean;
}

export interface AttributeArgumentSlotPosition extends AttributeNamedKeyPosition {
  readonly positionalIndex: number;
}

export interface AttributeValuePosition extends AttributeArgumentPosition {
  readonly syntax: 'scalar' | 'functionName';
}

export interface FieldAttributeNamedKeyCompletionContext
  extends FieldAttributeOwner,
    AttributeNamedKeyPosition {
  readonly kind: 'fieldAttributeNamedKey';
}

export interface ModelAttributeNamedKeyCompletionContext
  extends ModelAttributeOwner,
    AttributeNamedKeyPosition {
  readonly kind: 'modelAttributeNamedKey';
}

export interface BlockAttributeNamedKeyCompletionContext
  extends BlockAttributeOwner,
    AttributeNamedKeyPosition {
  readonly kind: 'blockAttributeNamedKey';
}

export interface FieldAttributeArgumentSlotCompletionContext
  extends FieldAttributeOwner,
    AttributeArgumentSlotPosition {
  readonly kind: 'fieldAttributeArgumentSlot';
}

export interface ModelAttributeArgumentSlotCompletionContext
  extends ModelAttributeOwner,
    AttributeArgumentSlotPosition {
  readonly kind: 'modelAttributeArgumentSlot';
}

export interface BlockAttributeArgumentSlotCompletionContext
  extends BlockAttributeOwner,
    AttributeArgumentSlotPosition {
  readonly kind: 'blockAttributeArgumentSlot';
}

export type AttributeArgumentSlotCompletionContext =
  | FieldAttributeArgumentSlotCompletionContext
  | ModelAttributeArgumentSlotCompletionContext
  | BlockAttributeArgumentSlotCompletionContext;

export type AttributeNamedKeyCompletionContext =
  | BlockAttributeNamedKeyCompletionContext
  | FieldAttributeNamedKeyCompletionContext
  | ModelAttributeNamedKeyCompletionContext;

export interface FieldAttributeValueCompletionContext
  extends FieldAttributeOwner,
    AttributeValuePosition {
  readonly kind: 'fieldAttributeValue';
}

export interface ModelAttributeValueCompletionContext
  extends ModelAttributeOwner,
    AttributeValuePosition {
  readonly kind: 'modelAttributeValue';
}

export interface BlockAttributeValueCompletionContext
  extends BlockAttributeOwner,
    AttributeValuePosition {
  readonly kind: 'blockAttributeValue';
}

export type AttributeValueCompletionContext =
  | FieldAttributeValueCompletionContext
  | ModelAttributeValueCompletionContext
  | BlockAttributeValueCompletionContext;

export type AttributeArgumentCompletionContext =
  | AttributeNamedKeyCompletionContext
  | AttributeArgumentSlotCompletionContext
  | AttributeValueCompletionContext;

export type DeclarationKeywordCompletionScope = 'document' | 'namespace';

export interface DeclarationKeywordCompletionContext {
  readonly kind: 'declarationKeyword';
  readonly offset: number;
  readonly scope: DeclarationKeywordCompletionScope;
  readonly replacementStartOffset: number;
}

export interface UnsupportedPslCompletionContext {
  readonly kind: 'unsupported';
}

export type PslCompletionContext =
  | AttributeNameCompletionContext
  | AttributeArgumentCompletionContext
  | DeclarationKeywordCompletionContext
  | GenericBlockKeyCompletionContext
  | GenericBlockValueCompletionContext
  | ModelTypeCompletionContext
  | NamespaceMemberCompletionContext
  | SpaceMemberCompletionContext
  | UnsupportedPslCompletionContext;

const UNSUPPORTED: UnsupportedPslCompletionContext = { kind: 'unsupported' };

export function classifyPslCompletionContext(
  input: ClassifyPslCompletionContextInput,
): PslCompletionContext {
  const root = input.document.syntax;
  const offset = input.sourceFile.offsetAt(input.position);
  const at = root.tokenAtOffset(offset);

  // Completion is never offered when the cursor sits inside a comment.
  if (at.leftBiased()?.kind === 'Comment') {
    return UNSUPPORTED;
  }

  // The edit replaces the identifier under the cursor, or is empty when the
  // cursor sits in trivia.
  const edit = cursorIdentifier(at, offset);

  // Anchor on the significant token preceding the cursor and navigate outward
  // via `token.parent` rather than scanning the whole tree.
  const preceding = precedingToken(at, edit);
  const precedingNode = preceding?.parent;
  const replacementStartOffset = edit?.offset ?? offset;

  const attributeClassifierInput = {
    offset,
    node: attributeAnchor(at),
    replacementStartOffset,
  };
  const attributeContext =
    classifyFieldAttribute(attributeClassifierInput) ??
    classifyGenericBlockAttribute(attributeClassifierInput) ??
    classifyModelAttribute(attributeClassifierInput);
  if (attributeContext !== undefined) {
    return attributeContext;
  }

  const declarationKeywordContext = classifyDeclarationKeyword({
    node: precedingNode,
    offset,
    replacementStartOffset,
  });
  if (declarationKeywordContext !== undefined) {
    return declarationKeywordContext;
  }

  const genericBlockContext = classifyGenericBlockParameter({
    offset,
    at,
    precedingToken: preceding,
    replacementStartOffset,
  });
  if (genericBlockContext !== undefined) {
    return genericBlockContext;
  }

  const field = fieldForTypeSlot(precedingNode);
  if (field === undefined) {
    return UNSUPPORTED;
  }
  if (
    field.syntax.findAncestor(any(ModelDeclarationAst.cast, CompositeTypeDeclarationAst.cast)) ===
    undefined
  ) {
    return UNSUPPORTED;
  }

  return classifyModelFieldType({
    field,
    offset,
    replacementStartOffset,
    precedingToken: preceding,
  });
}

/**
 * Locates the field whose type position the cursor occupies. The preceding token
 * climbs to the field whether the cursor sits inside a present type (the type
 * identifier's predecessor still belongs to the field) or in the empty type slot
 * of a typeless field (whose trailing trivia lives in the enclosing block, so
 * the nearest significant token to the left is the field's own name).
 */
function fieldForTypeSlot(precedingNode: SyntaxNode | undefined): FieldDeclarationAst | undefined {
  return precedingNode?.findAncestor(FieldDeclarationAst.cast);
}

function classifyModelFieldType(input: {
  readonly field: FieldDeclarationAst;
  readonly offset: number;
  readonly replacementStartOffset: number;
  readonly precedingToken: SyntaxToken | undefined;
}): PslCompletionContext {
  const fieldName = input.field.name();
  if (fieldName === undefined) {
    return UNSUPPORTED;
  }
  const fieldNameText = fieldName.name();
  if (fieldNameText === undefined) {
    return UNSUPPORTED;
  }

  if (fieldName.syntax.isInside(input.offset)) {
    return UNSUPPORTED;
  }

  const typeAnnotation = input.field.typeAnnotation();
  if (typeAnnotation === undefined) {
    if (
      input.precedingToken !== undefined &&
      fieldName.syntax.isInside(input.precedingToken.offset)
    ) {
      return {
        kind: 'modelType',
        offset: input.offset,
        fieldName: fieldNameText,
        replacementStartOffset: input.offset,
      };
    }
    return UNSUPPORTED;
  }

  if (typeAnnotation.syntax.isOutside(input.offset)) {
    return UNSUPPORTED;
  }

  const constructorArgList = typeAnnotation.argList();
  if (constructorArgList?.syntax.isInside(input.offset)) {
    return UNSUPPORTED;
  }

  const name = typeAnnotation.name();
  if (name === undefined) {
    return UNSUPPORTED;
  }
  if (name.syntax.isOutside(input.offset)) {
    return UNSUPPORTED;
  }
  if (name.isOverQualified()) {
    return UNSUPPORTED;
  }

  return classifyTypePosition(name, input.offset, fieldNameText, input.replacementStartOffset);
}

/**
 * Builds the type-completion context for a qualified name. Roles are read
 * straight off the separator-positional accessors: a populated namespace
 * segment is a `.`-qualified name, a populated space segment is a `:`-qualified
 * name, and the absence of both is a bare model type.
 *
 * Behaviour change: a `:`-qualified name with no `.` (e.g. `supabase:`,
 * `supabase:U`) is a `spaceMember` position rather than falling through to bare
 * model-type completions. A malformed leading-separator name (`:User`, `.User`)
 * carries no populated segment and resolves to `modelType` rather than
 * `unsupported`.
 */
function classifyTypePosition(
  name: QualifiedNameAst,
  offset: number,
  fieldName: string,
  replacementStartOffset: number,
): ModelTypeCompletionContext | SpaceMemberCompletionContext | NamespaceMemberCompletionContext {
  const namespace = name.namespace()?.name();
  if (namespace !== undefined && namespace.length > 0) {
    const namespaceSpace = name.space()?.name();
    return {
      kind: 'namespaceMember',
      offset,
      fieldName,
      replacementStartOffset,
      namespace,
      ...(namespaceSpace !== undefined && namespaceSpace.length > 0
        ? { space: namespaceSpace }
        : {}),
    };
  }
  const space = name.space()?.name();
  if (space !== undefined && space.length > 0) {
    return { kind: 'spaceMember', offset, fieldName, replacementStartOffset, space };
  }
  return { kind: 'modelType', offset, fieldName, replacementStartOffset };
}

const declarationCast = any(
  ModelDeclarationAst.cast,
  CompositeTypeDeclarationAst.cast,
  TypesBlockAst.cast,
  GenericBlockDeclarationAst.cast,
  NamespaceDeclarationAst.cast,
);

type DeclarationAst = NonNullable<ReturnType<typeof declarationCast>>;

function classifyDeclarationKeyword(input: {
  readonly node: SyntaxNode | undefined;
  readonly offset: number;
  readonly replacementStartOffset: number;
}): DeclarationKeywordCompletionContext | undefined {
  const precedingDeclaration = input.node?.findAncestor(declarationCast);
  const namespace = input.node?.findAncestor(NamespaceDeclarationAst.cast);
  const inNamespaceBody = blockBodyContainsOffset(namespace, input.offset);

  if (
    precedingDeclaration !== undefined &&
    !canCompleteDeclaration(precedingDeclaration, input.offset, inNamespaceBody)
  ) {
    return undefined;
  }

  return {
    kind: 'declarationKeyword',
    offset: input.offset,
    scope: inNamespaceBody ? 'namespace' : 'document',
    replacementStartOffset: input.replacementStartOffset,
  };
}

/**
 * Whether a new declaration can begin at the cursor, given the nearest enclosing
 * declaration. Allowed when that declaration is still nascent (only its keyword
 * typed, no name or body yet), when it is a namespace whose body holds further
 * declarations, or when the cursor sits past its closing `}`.
 */
function canCompleteDeclaration(
  precedingDeclaration: DeclarationAst,
  offset: number,
  inNamespaceBody: boolean,
): boolean {
  const keywordOnly =
    precedingDeclaration.lbrace() === undefined &&
    (precedingDeclaration instanceof TypesBlockAst || precedingDeclaration.name() === undefined);
  if (keywordOnly) {
    return true;
  }
  if (precedingDeclaration instanceof NamespaceDeclarationAst && inNamespaceBody) {
    return true;
  }
  const rbrace = precedingDeclaration.rbrace();
  return rbrace !== undefined && offset >= rbrace.endOffset;
}

function blockBodyContainsOffset(block: BracedBlock | undefined, offset: number): boolean {
  if (block === undefined) {
    return false;
  }
  const lbrace = block.lbrace();
  if (lbrace === undefined) {
    return false;
  }
  const bodyStart = lbrace.endOffset;
  const bodyEnd = block.rbrace()?.offset ?? block.syntax.endOffset;
  return offset >= bodyStart && offset <= bodyEnd;
}

interface AttributeClassifierInput {
  readonly offset: number;
  readonly node: SyntaxNode | undefined;
  readonly replacementStartOffset: number;
}

function classifyFieldAttribute(input: AttributeClassifierInput): PslCompletionContext | undefined {
  const attribute = input.node?.findAncestor(FieldAttributeAst.cast);
  if (attribute === undefined || !attributeContainsOffset(attribute, input.offset)) {
    return undefined;
  }
  const field = attribute.syntax.findAncestor(FieldDeclarationAst.cast);
  const model = attribute.syntax.findAncestor(ModelDeclarationAst.cast);
  if (field === undefined || model === undefined) {
    return UNSUPPORTED;
  }
  return classifyAttributePosition(attribute, input, {
    name: (position) => ({ kind: 'fieldAttributeName', ...position, field, model }),
    namedKey: (position) => ({ kind: 'fieldAttributeNamedKey', ...position, field, model }),
    argumentSlot: (position) => ({ kind: 'fieldAttributeArgumentSlot', ...position, field, model }),
    value: (position) => ({ kind: 'fieldAttributeValue', ...position, field, model }),
  });
}

function classifyGenericBlockAttribute(
  input: AttributeClassifierInput,
): PslCompletionContext | undefined {
  const attribute = activeModelAttribute(input);
  const block = attribute?.syntax.findAncestor(GenericBlockDeclarationAst.cast);
  if (attribute === undefined || block === undefined) {
    return undefined;
  }
  const blockKeyword = block.keyword()?.text;
  if (blockKeyword === undefined || blockKeyword.length === 0) {
    return UNSUPPORTED;
  }
  return classifyAttributePosition(attribute, input, {
    name: (position) => ({ kind: 'blockAttributeName', ...position, block, blockKeyword }),
    namedKey: (position) => ({ kind: 'blockAttributeNamedKey', ...position, block, blockKeyword }),
    argumentSlot: (position) => ({
      kind: 'blockAttributeArgumentSlot',
      ...position,
      block,
      blockKeyword,
    }),
    value: (position) => ({ kind: 'blockAttributeValue', ...position, block, blockKeyword }),
  });
}

function classifyModelAttribute(input: AttributeClassifierInput): PslCompletionContext | undefined {
  const attribute = activeModelAttribute(input);
  if (attribute === undefined) {
    return undefined;
  }
  const model = attribute.syntax.findAncestor(ModelDeclarationAst.cast);
  if (model === undefined) {
    return undefined;
  }
  return classifyAttributePosition(attribute, input, {
    name: (position) => ({ kind: 'modelAttributeName', ...position, model }),
    namedKey: (position) => ({ kind: 'modelAttributeNamedKey', ...position, model }),
    argumentSlot: (position) => ({ kind: 'modelAttributeArgumentSlot', ...position, model }),
    value: (position) => ({ kind: 'modelAttributeValue', ...position, model }),
  });
}

function activeModelAttribute(input: AttributeClassifierInput): ModelAttributeAst | undefined {
  const attribute = input.node?.findAncestor(ModelAttributeAst.cast);
  if (attribute === undefined || !attributeContainsOffset(attribute, input.offset)) {
    return undefined;
  }
  return attribute;
}

function attributeAnchor(at: TokenAtOffset): SyntaxNode | undefined {
  const token = at.leftBiased() ?? at.rightBiased();
  return token === undefined ? undefined : skipTriviaToken(token, 'prev')?.parent;
}

function attributeContainsOffset(
  attribute: FieldAttributeAst | ModelAttributeAst,
  offset: number,
): boolean {
  if (attribute.syntax.isInside(offset)) return true;
  const args = attribute.argList();
  return args !== undefined && args.rparen() === undefined && offset >= args.syntax.endOffset;
}

function isAttributeNamePosition(
  attribute: FieldAttributeAst | ModelAttributeAst,
  offset: number,
): boolean {
  const argList = attribute.argList();
  return argList === undefined || offset < argList.syntax.offset;
}

function attributeArgumentName(
  attribute: FieldAttributeAst | ModelAttributeAst,
  offset: number,
): string | undefined {
  const args = attribute.argList();
  if (args === undefined || offset < args.syntax.offset) return undefined;
  const closing = args.rparen();
  if (closing !== undefined && offset >= closing.endOffset) return undefined;
  return attribute.name()?.identifier()?.name();
}

interface AttributeContextFactory {
  readonly name: (position: AttributeNamePosition) => AttributeNameCompletionContext;
  readonly namedKey: (position: AttributeNamedKeyPosition) => AttributeNamedKeyCompletionContext;
  readonly argumentSlot: (
    position: AttributeArgumentSlotPosition,
  ) => AttributeArgumentSlotCompletionContext;
  readonly value: (position: AttributeValuePosition) => AttributeValueCompletionContext;
}

interface AttributeCursor extends CompletionReplacement {
  readonly attributeName: string;
  readonly preceding: SyntaxToken | undefined;
  readonly factory: AttributeContextFactory;
}

function classifyAttributePosition(
  attribute: FieldAttributeAst | ModelAttributeAst,
  input: AttributeClassifierInput,
  factory: AttributeContextFactory,
): PslCompletionContext {
  const args = attribute.argList();
  if (isAttributeNamePosition(attribute, input.offset)) {
    return factory.name({
      offset: input.offset,
      replacementStartOffset: input.replacementStartOffset,
      replacementEndOffset: attribute.name()?.syntax.endOffset ?? input.offset,
      hasArgumentList: args !== undefined,
    });
  }
  const attributeName = attributeArgumentName(attribute, input.offset);
  if (attributeName === undefined || args === undefined) return UNSUPPORTED;
  const at = attribute.syntax.tokenAtOffset(input.offset);
  const right = at.rightBiased();
  const token = isValueToken(right) ? right : at.leftBiased();
  const replaceToken = isValueToken(token);
  const anchor = at.leftBiased() ?? attribute.syntax.lastToken;
  return classifyArguments(
    {
      offset: input.offset,
      replacementStartOffset: replaceToken ? token.offset : input.offset,
      replacementEndOffset: replaceToken ? token.endOffset : input.offset,
      attributeName,
      preceding: anchor === undefined ? undefined : skipTriviaToken(anchor, 'prev'),
      factory,
    },
    args,
    [],
  );
}

function argumentPosition(
  cursor: AttributeCursor,
  path: readonly AttributeArgumentPathStep[],
): AttributeArgumentPosition {
  return {
    offset: cursor.offset,
    replacementStartOffset: cursor.replacementStartOffset,
    replacementEndOffset: cursor.replacementEndOffset,
    attributeName: cursor.attributeName,
    path,
  };
}

function classifyArguments(
  cursor: AttributeCursor,
  container: AttributeArgListAst | FunctionCallAst,
  path: readonly AttributeArgumentPathStep[],
): PslCompletionContext {
  const opening = container.lparen();
  const closing = container.rparen();
  if (
    opening === undefined ||
    cursor.offset <= opening.offset ||
    (closing !== undefined && cursor.offset >= closing.endOffset)
  )
    return UNSUPPORTED;
  let positionalIndex = 0;
  let active: AttributeArgAst | undefined;
  const existingNamedKeys: string[] = [];
  for (const arg of container.args()) {
    const name = arg.name()?.name();
    const selected =
      arg.syntax.offset <= cursor.offset &&
      (containsCursor(arg.syntax, cursor) ||
        recoveredContainerContainsCursor(arg.value(), cursor.offset));
    if (active === undefined && selected) {
      active = arg;
    } else {
      if (name !== undefined) existingNamedKeys.push(name);
      if (active === undefined && arg.syntax.offset <= cursor.offset && name === undefined)
        positionalIndex += 1;
    }
  }
  const position = argumentPosition(cursor, path);
  if (active === undefined) {
    return followsSeparator(cursor, ['LParen', 'Comma'])
      ? cursor.factory.argumentSlot({
          ...position,
          positionalIndex,
          existingNamedKeys,
          hasColon: false,
        })
      : UNSUPPORTED;
  }
  const colon = active.colon();
  if (colon !== undefined) {
    if (cursor.offset <= colon.offset)
      return cursor.factory.namedKey({ ...position, existingNamedKeys, hasColon: true });
    const name = active.name()?.name();
    return name === undefined
      ? UNSUPPORTED
      : classifyExpression(cursor, active.value(), [...path, { kind: 'namedArgument', name }]);
  }
  const value = active.value();
  if (
    value === undefined ||
    (value instanceof IdentifierAst && value.syntax.isInside(cursor.offset))
  ) {
    return cursor.factory.argumentSlot({
      ...position,
      positionalIndex,
      existingNamedKeys,
      hasColon: false,
    });
  }
  return classifyExpression(cursor, value, [
    ...path,
    { kind: 'positionalArgument', index: positionalIndex },
  ]);
}

function classifyExpression(
  cursor: AttributeCursor,
  expression: ExpressionAst | undefined,
  path: readonly AttributeArgumentPathStep[],
): PslCompletionContext {
  if (expression instanceof ArrayLiteralAst) return classifyList(cursor, expression, path);
  if (expression instanceof ObjectLiteralExprAst) return classifyRecord(cursor, expression, path);
  if (expression instanceof FunctionCallAst) {
    const opening = expression.lparen();
    if (opening !== undefined && cursor.offset > opening.offset) {
      const name = expression.name();
      const identifier = name?.identifier()?.name();
      return identifier !== undefined && name?.isSimpleName(identifier) === true
        ? classifyArguments(cursor, expression, [
            ...path,
            { kind: 'functionCall', name: identifier },
          ])
        : UNSUPPORTED;
    }
    return expression.name()?.syntax.isInside(cursor.offset) === true
      ? cursor.factory.value({ ...argumentPosition(cursor, path), syntax: 'functionName' })
      : UNSUPPORTED;
  }
  return expression?.syntax.isOutside(cursor.offset) === true
    ? UNSUPPORTED
    : cursor.factory.value({ ...argumentPosition(cursor, path), syntax: 'scalar' });
}

function classifyList(
  cursor: AttributeCursor,
  expression: ArrayLiteralAst,
  path: readonly AttributeArgumentPathStep[],
): PslCompletionContext {
  const opening = expression.lbracket();
  const closing = expression.rbracket();
  if (
    opening === undefined ||
    cursor.offset <= opening.offset ||
    (closing !== undefined && cursor.offset >= closing.endOffset)
  )
    return UNSUPPORTED;
  const elementPath: readonly AttributeArgumentPathStep[] = [...path, { kind: 'listElement' }];
  for (const element of expression.elements()) {
    if (
      containsCursor(element.syntax, cursor) ||
      recoveredContainerContainsCursor(element, cursor.offset)
    ) {
      return classifyExpression(cursor, element, elementPath);
    }
  }
  return followsSeparator(cursor, ['LBracket', 'Comma'])
    ? classifyExpression(cursor, undefined, elementPath)
    : UNSUPPORTED;
}

function classifyRecord(
  cursor: AttributeCursor,
  expression: ObjectLiteralExprAst,
  path: readonly AttributeArgumentPathStep[],
): PslCompletionContext {
  const closing = expression.rbrace();
  if (closing !== undefined && cursor.offset >= closing.endOffset) return UNSUPPORTED;
  for (const field of expression.fields()) {
    const colon = field.colon();
    if (
      colon !== undefined &&
      cursor.offset > colon.offset &&
      (containsCursor(field.syntax, cursor) ||
        recoveredContainerContainsCursor(field.value(), cursor.offset))
    ) {
      return classifyExpression(cursor, field.value(), [...path, { kind: 'recordValue' }]);
    }
  }
  return UNSUPPORTED;
}

function isValueToken(token: SyntaxToken | undefined): token is SyntaxToken {
  return (
    token !== undefined &&
    (token.kind === 'Ident' || token.kind === 'StringLiteral' || token.kind === 'NumberLiteral')
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

function containsCursor(node: SyntaxNode, cursor: AttributeCursor): boolean {
  if (node.isInside(cursor.offset)) return true;
  const preceding = cursor.preceding;
  return (
    preceding !== undefined &&
    preceding.endOffset <= cursor.offset &&
    preceding.offset >= node.offset &&
    preceding.offset < node.endOffset
  );
}

function followsSeparator(cursor: AttributeCursor, kinds: readonly string[]): boolean {
  return kinds.includes(cursor.preceding?.kind ?? '');
}

function classifyGenericBlockParameter(input: {
  readonly offset: number;
  readonly at: TokenAtOffset;
  readonly precedingToken: SyntaxToken | undefined;
  readonly replacementStartOffset: number;
}): PslCompletionContext | undefined {
  // Whether the cursor sits in a key, value, or attribute slot is a structural
  // question, so it anchors on the cursor's own node — including any in-progress
  // identifier — rather than the edit-skipped `precedingToken` used for gaps.
  const node = input.at.leftBiased()?.parent;
  const block = node?.findAncestor(GenericBlockDeclarationAst.cast);
  if (block === undefined) {
    return undefined;
  }

  if (hasUnsupportedAncestor(node)) {
    return UNSUPPORTED;
  }

  if (!blockBodyContainsOffset(block, input.offset)) {
    return UNSUPPORTED;
  }

  const field = node?.findAncestor(FieldDeclarationAst.cast);
  if (field?.syntax.isInside(input.offset)) {
    return UNSUPPORTED;
  }

  const keyword = block.keyword()?.text;
  if (keyword === undefined || keyword.length === 0) {
    return UNSUPPORTED;
  }

  // Value position: the cursor follows a `=`. The position is now classified
  // distinctly from keys; populating value candidates is the provider's concern.
  if (input.precedingToken?.kind === 'Equals') {
    return {
      kind: 'genericBlockValue',
      offset: input.offset,
      blockKeyword: keyword,
      replacementStartOffset: input.replacementStartOffset,
    };
  }

  const activePair = activeKeyValuePair(node, input.offset);
  if (activePair !== undefined && isAfterEquals(activePair, input.offset)) {
    return UNSUPPORTED;
  }

  return {
    kind: 'genericBlockKey',
    offset: input.offset,
    blockKeyword: keyword,
    replacementStartOffset: input.replacementStartOffset,
    block,
  };
}

function activeKeyValuePair(
  node: SyntaxNode | undefined,
  offset: number,
): KeyValuePairAst | undefined {
  const pair = node?.findAncestor(KeyValuePairAst.cast);
  if (pair === undefined || pair.syntax.isOutside(offset)) {
    return undefined;
  }
  return pair;
}

function isAfterEquals(pair: KeyValuePairAst, offset: number): boolean {
  const equals = pair.equals();
  return equals !== undefined && offset > equals.offset;
}

function hasUnsupportedAncestor(node: SyntaxNode | undefined): boolean {
  return (
    node?.findAncestor(
      any(AttributeArgListAst.cast, FieldAttributeAst.cast, ModelAttributeAst.cast),
    ) !== undefined
  );
}

/** The significant token preceding the cursor — the in-progress edit identifier
 *  is skipped, so the result is the token the classifier anchors on. */
function precedingToken(at: TokenAtOffset, edit: SyntaxToken | undefined): SyntaxToken | undefined {
  const start = edit !== undefined ? edit.prevToken : at.leftBiased();
  return start === undefined ? undefined : skipTriviaToken(start, 'prev');
}

/** The identifier token the cursor is editing, if any. */
function cursorIdentifier(at: TokenAtOffset, offset: number): SyntaxToken | undefined {
  const right = at.rightBiased();
  if (right?.kind === 'Ident' && offset < right.endOffset) {
    return right;
  }
  const left = at.leftBiased();
  if (left?.kind === 'Ident' && left.endOffset === offset) {
    return left;
  }
  return undefined;
}
