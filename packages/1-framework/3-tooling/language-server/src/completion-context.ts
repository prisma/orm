import {
  ArrayLiteralAst,
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
import {
  type AttributeArgumentPathStep,
  argumentAtCursor,
  argumentSiblings,
  attributeCursor,
  betweenDelimiters,
  isWithinAttributeOrOpenArguments,
  listElementAtCursor,
  recordFieldAtCursor,
} from './attribute-syntax-context';

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
  readonly ownerKind: 'field';
  readonly field: FieldDeclarationAst;
  readonly model: ModelDeclarationAst;
}

interface ModelAttributeOwner {
  readonly ownerKind: 'model';
  readonly model: ModelDeclarationAst;
}

interface BlockAttributeOwner {
  readonly ownerKind: 'block';
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
  if (attribute === undefined || !isWithinAttributeOrOpenArguments(attribute, input.offset)) {
    return undefined;
  }
  const field = attribute.syntax.findAncestor(FieldDeclarationAst.cast);
  const model = attribute.syntax.findAncestor(ModelDeclarationAst.cast);
  if (field === undefined || model === undefined) {
    return UNSUPPORTED;
  }
  const owner: FieldAttributeOwner = { ownerKind: 'field', field, model };
  return classifyAttributePosition(attribute, input, {
    name: (position) => ({ kind: 'fieldAttributeName', ...position, ...owner }),
    namedKey: (position) => ({ kind: 'fieldAttributeNamedKey', ...position, ...owner }),
    argumentSlot: (position) => ({ kind: 'fieldAttributeArgumentSlot', ...position, ...owner }),
    value: (position) => ({ kind: 'fieldAttributeValue', ...position, ...owner }),
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
  const owner: BlockAttributeOwner = { ownerKind: 'block', block, blockKeyword };
  return classifyAttributePosition(attribute, input, {
    name: (position) => ({ kind: 'blockAttributeName', ...position, ...owner }),
    namedKey: (position) => ({ kind: 'blockAttributeNamedKey', ...position, ...owner }),
    argumentSlot: (position) => ({ kind: 'blockAttributeArgumentSlot', ...position, ...owner }),
    value: (position) => ({ kind: 'blockAttributeValue', ...position, ...owner }),
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
  const owner: ModelAttributeOwner = { ownerKind: 'model', model };
  return classifyAttributePosition(attribute, input, {
    name: (position) => ({ kind: 'modelAttributeName', ...position, ...owner }),
    namedKey: (position) => ({ kind: 'modelAttributeNamedKey', ...position, ...owner }),
    argumentSlot: (position) => ({ kind: 'modelAttributeArgumentSlot', ...position, ...owner }),
    value: (position) => ({ kind: 'modelAttributeValue', ...position, ...owner }),
  });
}

function activeModelAttribute(input: AttributeClassifierInput): ModelAttributeAst | undefined {
  const attribute = input.node?.findAncestor(ModelAttributeAst.cast);
  if (attribute === undefined || !isWithinAttributeOrOpenArguments(attribute, input.offset)) {
    return undefined;
  }
  return attribute;
}

function attributeAnchor(at: TokenAtOffset): SyntaxNode | undefined {
  const token = at.leftBiased() ?? at.rightBiased();
  return token === undefined ? undefined : skipTriviaToken(token, 'prev')?.parent;
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
  if (args === undefined || input.offset < args.syntax.offset) {
    return factory.name({
      offset: input.offset,
      replacementStartOffset: input.replacementStartOffset,
      replacementEndOffset: attribute.name()?.syntax.endOffset ?? input.offset,
      hasArgumentList: args !== undefined,
    });
  }
  const attributeName = attribute.name()?.identifier()?.name();
  if (attributeName === undefined) return UNSUPPORTED;
  const at = attribute.syntax.tokenAtOffset(input.offset);
  const right = at.rightBiased();
  const token = isValueToken(right) ? right : at.leftBiased();
  const replaceToken = isValueToken(token);
  return classifyAttributeArguments(
    {
      offset: input.offset,
      replacementStartOffset: replaceToken ? token.offset : input.offset,
      replacementEndOffset: replaceToken ? token.endOffset : input.offset,
      attributeName,
      preceding: attributeCursor(attribute, input.offset).preceding,
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

function classifyAttributeArguments(
  cursor: AttributeCursor,
  args: AttributeArgListAst | FunctionCallAst,
  path: readonly AttributeArgumentPathStep[],
): PslCompletionContext {
  if (!betweenDelimiters(cursor.offset, args.lparen(), args.rparen())) return UNSUPPORTED;
  const active = argumentAtCursor(cursor, args);
  const { precedingPositionalCount: positionalIndex, otherNamedKeys: existingNamedKeys } =
    argumentSiblings(args, active, cursor.offset);
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
      : classifyAttributeExpression(cursor, active.value(), [
          ...path,
          { kind: 'namedArgument', name },
        ]);
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
  return classifyAttributeExpression(cursor, value, [
    ...path,
    { kind: 'positionalArgument', index: positionalIndex },
  ]);
}

function classifyAttributeExpression(
  cursor: AttributeCursor,
  expression: ExpressionAst | undefined,
  path: readonly AttributeArgumentPathStep[],
): PslCompletionContext {
  if (expression === undefined)
    return cursor.factory.value({ ...argumentPosition(cursor, path), syntax: 'scalar' });
  if (expression instanceof ArrayLiteralAst) {
    if (!betweenDelimiters(cursor.offset, expression.lbracket(), expression.rbracket()))
      return UNSUPPORTED;
    const element = listElementAtCursor(cursor, expression);
    return element !== undefined || followsSeparator(cursor, ['LBracket', 'Comma'])
      ? classifyAttributeExpression(cursor, element, [...path, { kind: 'listElement' }])
      : UNSUPPORTED;
  }
  if (expression instanceof ObjectLiteralExprAst) {
    const closing = expression.rbrace();
    if (closing !== undefined && cursor.offset >= closing.endOffset) return UNSUPPORTED;
    const field = recordFieldAtCursor(cursor, expression);
    return field !== undefined
      ? classifyAttributeExpression(cursor, field.value(), [...path, { kind: 'recordValue' }])
      : UNSUPPORTED;
  }
  if (expression instanceof FunctionCallAst) {
    const opening = expression.lparen();
    if (opening !== undefined && cursor.offset > opening.offset) {
      const name = expression.name();
      const identifier = name?.identifier()?.name();
      return identifier !== undefined && name?.isSimpleName(identifier) === true
        ? classifyAttributeArguments(cursor, expression, [
            ...path,
            { kind: 'functionCall', name: identifier },
          ])
        : UNSUPPORTED;
    }
    return expression.name()?.syntax.isInside(cursor.offset) === true
      ? cursor.factory.value({ ...argumentPosition(cursor, path), syntax: 'functionName' })
      : UNSUPPORTED;
  }
  return expression.syntax.isOutside(cursor.offset)
    ? UNSUPPORTED
    : cursor.factory.value({ ...argumentPosition(cursor, path), syntax: 'scalar' });
}

function isValueToken(token: SyntaxToken | undefined): token is SyntaxToken {
  return (
    token !== undefined &&
    (token.kind === 'Ident' || token.kind === 'StringLiteral' || token.kind === 'NumberLiteral')
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
