import {
  ArrayLiteralAst,
  AttributeArgListAst,
  any,
  type BracedBlock,
  CompositeTypeDeclarationAst,
  type DocumentAst,
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
  type AttributeSyntaxContext,
  argumentSiblings,
  attributeContainsOffset,
  locateAttributeArguments,
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
  readonly syntax: AttributeSyntaxContext;
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
  return interpretAttributeArguments(
    {
      offset: input.offset,
      replacementStartOffset: replaceToken ? token.offset : input.offset,
      replacementEndOffset: replaceToken ? token.endOffset : input.offset,
      attributeName,
      syntax: locateAttributeArguments(attribute, input.offset),
      factory,
    },
    0,
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

function interpretAttributeArguments(
  cursor: AttributeCursor,
  frameIndex: number,
  path: readonly AttributeArgumentPathStep[],
): PslCompletionContext {
  const frame = cursor.syntax.frames[frameIndex];
  if (frame?.kind !== 'arguments' || !frame.insideDelimiters) return UNSUPPORTED;
  const active = frame.containingArgument;
  const { precedingPositionalCount: positionalIndex, otherNamedKeys: existingNamedKeys } =
    argumentSiblings(frame, active, cursor.offset);
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
  if (active.colon() !== undefined) {
    if (frame.region === 'name')
      return cursor.factory.namedKey({ ...position, existingNamedKeys, hasColon: true });
    const name = active.name()?.name();
    return name === undefined
      ? UNSUPPORTED
      : interpretAttributeExpression(cursor, frameIndex + 1, [
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
  return interpretAttributeExpression(cursor, frameIndex + 1, [
    ...path,
    { kind: 'positionalArgument', index: positionalIndex },
  ]);
}

function interpretAttributeExpression(
  cursor: AttributeCursor,
  frameIndex: number,
  path: readonly AttributeArgumentPathStep[],
): PslCompletionContext {
  const frame = cursor.syntax.frames[frameIndex];
  if (frame === undefined)
    return cursor.factory.value({ ...argumentPosition(cursor, path), syntax: 'scalar' });
  if (frame.kind !== 'expression') return UNSUPPORTED;
  const expression = frame.node;
  if (expression instanceof ArrayLiteralAst) {
    if (!frame.insideDelimiters) return UNSUPPORTED;
    return cursor.syntax.frames[frameIndex + 1] !== undefined ||
      followsSeparator(cursor, ['LBracket', 'Comma'])
      ? interpretAttributeExpression(cursor, frameIndex + 1, [...path, { kind: 'listElement' }])
      : UNSUPPORTED;
  }
  if (expression instanceof ObjectLiteralExprAst) {
    return frame.insideDelimiters && frame.childEdge === 'recordValue'
      ? interpretAttributeExpression(cursor, frameIndex + 1, [...path, { kind: 'recordValue' }])
      : UNSUPPORTED;
  }
  if (expression instanceof FunctionCallAst) {
    if (cursor.syntax.frames[frameIndex + 1]?.kind === 'arguments') {
      const name = expression.name();
      const identifier = name?.identifier()?.name();
      return identifier !== undefined && name?.isSimpleName(identifier) === true
        ? interpretAttributeArguments(cursor, frameIndex + 1, [
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
  return kinds.includes(cursor.syntax.preceding?.kind ?? '');
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
