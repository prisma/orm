import {
  ArrayLiteralAst,
  FieldAttributeAst,
  FieldDeclarationAst,
  FunctionCallAst,
  GenericBlockDeclarationAst,
  IdentifierAst,
  ModelDeclarationAst,
  ObjectLiteralExprAst,
} from '@internal/psl-parser/syntax';
import type { AttributeSpecOwner } from './attribute-spec-resolution';
import {
  type AttributeArgumentPathStep,
  type AttributeSyntaxContext,
  argumentSiblings,
  locateAttributeSyntax,
  type PslCursorInput,
} from './attribute-syntax-context';

interface SignaturePosition {
  readonly path: readonly AttributeArgumentPathStep[];
  readonly argumentSlot:
    | {
        readonly positionalIndex: number;
        readonly existingNamedKeys: readonly string[];
      }
    | undefined;
}

export type AttributeSignatureContext = AttributeSpecOwner &
  SignaturePosition & {
    readonly attributeName: string;
  };

export function classifyPslSignatureContext(
  input: PslCursorInput,
): AttributeSignatureContext | undefined {
  const syntax = locateAttributeSyntax(input);
  if (syntax === undefined) return undefined;
  const attributeName = syntax.attribute.name()?.identifier()?.name();
  const position = interpretArguments(syntax, 0, []);
  const owner = signatureOwner(syntax);
  return attributeName === undefined || position === undefined || owner === undefined
    ? undefined
    : { ...owner, ...position, attributeName };
}

function signatureOwner(context: AttributeSyntaxContext): AttributeSpecOwner | undefined {
  const attribute = context.attribute;
  if (attribute instanceof FieldAttributeAst) {
    const field = attribute.syntax.findAncestor(FieldDeclarationAst.cast);
    const model = attribute.syntax.findAncestor(ModelDeclarationAst.cast);
    return field === undefined || model === undefined ? undefined : { field, model };
  }
  const block = attribute.syntax.findAncestor(GenericBlockDeclarationAst.cast);
  if (block !== undefined) {
    const blockKeyword = block.keyword()?.text;
    return blockKeyword === undefined || blockKeyword.length === 0
      ? undefined
      : { block, blockKeyword };
  }
  const model = attribute.syntax.findAncestor(ModelDeclarationAst.cast);
  return model === undefined ? undefined : { model };
}

function interpretArguments(
  context: AttributeSyntaxContext,
  index: number,
  path: readonly AttributeArgumentPathStep[],
): SignaturePosition | undefined {
  const frame = context.frames[index];
  if (frame?.kind !== 'arguments' || !frame.insideDelimiters) return undefined;
  const active = frame.containingArgument ?? frame.followingArgument;
  const { precedingPositionalCount: positionalIndex, otherNamedKeys: existingNamedKeys } =
    argumentSiblings(frame, active, context.offset);
  if (active === undefined) {
    return ['LParen', 'Comma'].includes(context.preceding?.kind ?? '')
      ? { path, argumentSlot: { positionalIndex, existingNamedKeys } }
      : undefined;
  }
  if (active.colon() !== undefined) {
    const name = active.name()?.name();
    if (name === undefined) return undefined;
    const valuePath: readonly AttributeArgumentPathStep[] = [
      ...path,
      { kind: 'namedArgument', name },
    ];
    return active === frame.containingArgument
      ? interpretExpression(context, index + 1, valuePath)
      : { path: valuePath, argumentSlot: undefined };
  }
  const value = active.value();
  if (
    value === undefined ||
    (value instanceof IdentifierAst && value.syntax.isInside(context.offset))
  ) {
    return { path, argumentSlot: { positionalIndex, existingNamedKeys } };
  }
  const valuePath: readonly AttributeArgumentPathStep[] = [
    ...path,
    { kind: 'positionalArgument', index: positionalIndex },
  ];
  return active === frame.containingArgument
    ? interpretExpression(context, index + 1, valuePath)
    : { path: valuePath, argumentSlot: undefined };
}

function interpretExpression(
  context: AttributeSyntaxContext,
  index: number,
  path: readonly AttributeArgumentPathStep[],
): SignaturePosition | undefined {
  const frame = context.frames[index];
  const position = { path, argumentSlot: undefined };
  if (frame === undefined) return position;
  if (frame.kind !== 'expression') return undefined;
  if (frame.atBoundaryOrOutside) return position;
  const expression = frame.node;
  if (expression instanceof ArrayLiteralAst) {
    return frame.insideDelimiters
      ? interpretExpression(context, index + 1, [...path, { kind: 'listElement' }])
      : undefined;
  }
  if (expression instanceof ObjectLiteralExprAst) {
    if (!frame.insideDelimiters) return undefined;
    return frame.childEdge === 'recordValue'
      ? interpretExpression(context, index + 1, [...path, { kind: 'recordValue' }])
      : position;
  }
  if (expression instanceof FunctionCallAst) {
    if (context.frames[index + 1]?.kind === 'arguments') {
      const name = expression.name();
      const identifier = name?.identifier()?.name();
      return identifier !== undefined && name?.isSimpleName(identifier) === true
        ? interpretArguments(context, index + 1, [
            ...path,
            { kind: 'functionCall', name: identifier },
          ])
        : undefined;
    }
    return expression.name()?.syntax.isInside(context.offset) === true ? position : undefined;
  }
  return position;
}
