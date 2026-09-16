import {
  ArrayLiteralAst,
  AttributeArgAst,
  type AttributeArgListAst,
  type ExpressionAst,
  FieldAttributeAst,
  FieldDeclarationAst,
  FunctionCallAst,
  GenericBlockDeclarationAst,
  IdentifierAst,
  type ModelAttributeAst,
  ModelDeclarationAst,
  nonTriviaSibling,
  ObjectLiteralExprAst,
  SyntaxNode,
} from '@internal/psl-parser/syntax';
import type { AttributeSpecOwner } from './attribute-spec-resolution';
import {
  type AttributeArgumentPathStep,
  argumentAtCursor,
  argumentSiblings,
  betweenDelimiters,
  listElementAtCursor,
  locateAttributeSyntax,
  type PslCursorInput,
  recordFieldAtCursor,
  recoveredContainerContainsCursor,
  type SyntaxCursor,
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
  const args = syntax.attribute.argList();
  const position = args === undefined ? undefined : signatureArguments(syntax, args, []);
  const owner = signatureOwner(syntax.attribute);
  return attributeName === undefined || position === undefined || owner === undefined
    ? undefined
    : { ...owner, ...position, attributeName };
}

function signatureOwner(
  attribute: FieldAttributeAst | ModelAttributeAst,
): AttributeSpecOwner | undefined {
  if (attribute instanceof FieldAttributeAst) {
    const field = attribute.syntax.findAncestor(FieldDeclarationAst.cast);
    const model = attribute.syntax.findAncestor(ModelDeclarationAst.cast);
    return field === undefined || model === undefined
      ? undefined
      : { ownerKind: 'field', field, model };
  }
  const block = attribute.syntax.findAncestor(GenericBlockDeclarationAst.cast);
  if (block !== undefined) {
    const blockKeyword = block.keyword()?.text;
    return blockKeyword === undefined || blockKeyword.length === 0
      ? undefined
      : { ownerKind: 'block', block, blockKeyword };
  }
  const model = attribute.syntax.findAncestor(ModelDeclarationAst.cast);
  return model === undefined ? undefined : { ownerKind: 'model', model };
}

function signatureArguments(
  context: SyntaxCursor,
  args: AttributeArgListAst | FunctionCallAst,
  path: readonly AttributeArgumentPathStep[],
): SignaturePosition | undefined {
  if (!betweenDelimiters(context.offset, args.lparen(), args.rparen())) return undefined;
  const containing = argumentAtCursor(context, args);
  const next =
    context.preceding?.kind === 'Comma' ? nonTriviaSibling(context.preceding, 'next') : undefined;
  const following =
    next instanceof SyntaxNode && next.parent?.offset === args.syntax.offset
      ? AttributeArgAst.cast(next)
      : undefined;
  const active = containing ?? following;
  const { precedingPositionalCount: positionalIndex, otherNamedKeys: existingNamedKeys } =
    argumentSiblings(args, active, context.offset);
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
    return active === containing
      ? signatureExpression(context, active.value(), valuePath)
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
  return active === containing
    ? signatureExpression(context, value, valuePath)
    : { path: valuePath, argumentSlot: undefined };
}

function signatureExpression(
  context: SyntaxCursor,
  expression: ExpressionAst | undefined,
  path: readonly AttributeArgumentPathStep[],
): SignaturePosition | undefined {
  const position = { path, argumentSlot: undefined };
  if (
    expression === undefined ||
    context.offset <= expression.syntax.offset ||
    (context.offset >= expression.syntax.endOffset &&
      !recoveredContainerContainsCursor(expression, context.offset))
  )
    return position;
  if (expression instanceof ArrayLiteralAst) {
    return betweenDelimiters(context.offset, expression.lbracket(), expression.rbracket())
      ? signatureExpression(context, listElementAtCursor(context, expression), [
          ...path,
          { kind: 'listElement' },
        ])
      : undefined;
  }
  if (expression instanceof ObjectLiteralExprAst) {
    const closing = expression.rbrace();
    if (closing !== undefined && context.offset >= closing.endOffset) return undefined;
    const field = recordFieldAtCursor(context, expression);
    return field !== undefined
      ? signatureExpression(context, field.value(), [...path, { kind: 'recordValue' }])
      : position;
  }
  if (expression instanceof FunctionCallAst) {
    const opening = expression.lparen();
    if (opening !== undefined && context.offset > opening.offset) {
      const name = expression.name();
      const identifier = name?.identifier()?.name();
      return identifier !== undefined && name?.isSimpleName(identifier) === true
        ? signatureArguments(context, expression, [
            ...path,
            { kind: 'functionCall', name: identifier },
          ])
        : undefined;
    }
    return expression.name()?.syntax.isInside(context.offset) === true ? position : undefined;
  }
  return position;
}
