import type { AuthoringPslBlockDescriptorNamespace } from '@internal/framework-components/authoring';
import type {
  AttributeSymbol,
  Binder,
  BlockSymbol,
  CompositeTypeSymbol,
  ContributedTypeSymbol,
  FieldSymbol,
  ModelSymbol,
  NamedTypeSymbol,
  PslSymbol,
  Resolution,
} from '@internal/psl-parser';
import { findBlockDescriptor } from '@internal/psl-parser';
import {
  CompositeTypeDeclarationAst,
  FieldDeclarationAst,
  GenericBlockDeclarationAst,
  ModelDeclarationAst,
  NamedTypeDeclarationAst,
  type SyntaxNode,
  type SyntaxToken,
} from '@internal/psl-parser/syntax';
import { type Hover, MarkupKind } from 'vscode-languageserver';
import type { PslCursorInput } from './attribute-syntax-context';
import { readDocComment } from './doc-comment';
import { renderSignatureLabel, resolveSignatureParameters } from './signature-help';

export interface ProvidePslHoverInput extends PslCursorInput {
  readonly binder: Binder;
  readonly pslBlockDescriptors?: AuthoringPslBlockDescriptorNamespace;
}

type HoverEntitySymbol =
  | ModelSymbol
  | CompositeTypeSymbol
  | FieldSymbol
  | NamedTypeSymbol
  | BlockSymbol;

type HoverResult =
  | { readonly kind: 'entity'; readonly symbol: HoverEntitySymbol }
  | { readonly kind: 'attribute'; readonly symbol: AttributeSymbol }
  | { readonly kind: 'contributedType'; readonly symbol: ContributedTypeSymbol };

export function providePslHover(input: ProvidePslHoverInput): Hover | null {
  const offset = input.sourceFile.offsetAt(input.position);
  const token = identTokenAt(input.document.syntax, offset);
  if (token === undefined) return null;
  const value = hoverValueAt(input.binder, token, input.pslBlockDescriptors);
  if (value === undefined) return null;
  return {
    contents: { kind: MarkupKind.Markdown, value },
    range: {
      start: input.sourceFile.positionAt(token.offset),
      end: input.sourceFile.positionAt(token.endOffset),
    },
  };
}

function hoverValueAt(
  binder: Binder,
  token: SyntaxToken,
  pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace | undefined,
): string | undefined {
  const result = resolveHoverResult(binder, token);
  if (result !== undefined) return renderHoverResult(result);
  return blockKeywordDocumentationAt(token, pslBlockDescriptors);
}

function identTokenAt(root: SyntaxNode, offset: number): SyntaxToken | undefined {
  const at = root.tokenAtOffset(offset);
  const left = at.leftBiased();
  if (left?.kind === 'Ident') return left;
  const right = at.rightBiased();
  return right?.kind === 'Ident' ? right : undefined;
}

function resolveHoverResult(binder: Binder, token: SyntaxToken): HoverResult | undefined {
  const identifier = token.parent;
  const declared = declaredEntityAt(binder, identifier);
  if (declared !== undefined) return { kind: 'entity', symbol: declared };
  return identifier.findAncestor((node) => narrowHoverResult(binder.symbolForNode(node)));
}

function declaredEntityAt(binder: Binder, identifier: SyntaxNode): HoverEntitySymbol | undefined {
  const owner = declarationNamedBy(identifier);
  return owner === undefined ? undefined : narrowDeclaredSymbol(binder.declaredSymbol(owner));
}

function declarationNamedBy(identifier: SyntaxNode): SyntaxNode | undefined {
  const parent = identifier.parent;
  if (parent === undefined) return undefined;
  const declaration =
    ModelDeclarationAst.cast(parent) ??
    CompositeTypeDeclarationAst.cast(parent) ??
    GenericBlockDeclarationAst.cast(parent) ??
    NamedTypeDeclarationAst.cast(parent) ??
    FieldDeclarationAst.cast(parent);
  return declaration?.name()?.syntax === identifier ? parent : undefined;
}

function narrowHoverResult(resolution: Resolution | undefined): HoverResult | undefined {
  switch (resolution?.kind) {
    case 'model':
    case 'compositeType':
    case 'namedType':
    case 'block':
    case 'field':
      return { kind: 'entity', symbol: resolution.symbol };
    case 'attribute':
      return { kind: 'attribute', symbol: resolution.symbol };
    case 'contributedType':
      return { kind: 'contributedType', symbol: resolution.symbol };
    default:
      return undefined;
  }
}

function narrowDeclaredSymbol(symbol: PslSymbol | undefined): HoverEntitySymbol | undefined {
  switch (symbol?.kind) {
    case 'model':
    case 'compositeType':
    case 'namedType':
    case 'block':
    case 'field':
      return symbol;
    default:
      return undefined;
  }
}

function renderHoverResult(result: HoverResult): string {
  if (result.kind === 'entity') return renderEntityContent(result.symbol);
  if (result.kind === 'attribute') return renderAttributeContent(result.symbol);
  return renderContributedTypeContent(result.symbol);
}

function renderEntityContent(entity: HoverEntitySymbol): string {
  const fence = ['```prisma', renderDeclarationLine(entity), '```'].join('\n');
  const doc = readDocComment(entity.node.syntax);
  return doc === undefined ? fence : `${fence}\n\n${doc}`;
}

function renderAttributeContent(symbol: AttributeSymbol): string {
  const name = `${symbol.level === 'field' ? '@' : '@@'}${symbol.name}`;
  const params = resolveSignatureParameters(symbol.spec, undefined);
  const { label } = renderSignatureLabel(name, symbol.spec, params);
  const fence = ['```prisma', label, '```'].join('\n');
  return `${fence}\n\n${symbol.spec.documentation}`;
}

function renderContributedTypeContent(symbol: ContributedTypeSymbol): string {
  const fence = ['```prisma', renderContributedTypeLabel(symbol), '```'].join('\n');
  const doc = symbol.descriptor.documentation;
  return doc === undefined ? fence : `${fence}\n\n${doc}`;
}

function renderContributedTypeLabel(symbol: ContributedTypeSymbol): string {
  const path = symbol.path.join('.');
  const args = symbol.descriptor.args ?? [];
  if (args.length === 0) return path;
  const labels = args.map((arg, index) => {
    const key = arg.name ?? `arg${index + 1}`;
    return `${key}${arg.optional === true ? '?' : ''}: ${arg.kind}`;
  });
  return `${path}(${labels.join(', ')})`;
}

function blockKeywordDocumentationAt(
  token: SyntaxToken,
  pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace | undefined,
): string | undefined {
  const declaration = GenericBlockDeclarationAst.cast(token.parent);
  if (declaration === undefined || declaration.keyword()?.offset !== token.offset) return undefined;
  return findBlockDescriptor(pslBlockDescriptors, token.text)?.documentation;
}

function renderDeclarationLine(entity: HoverEntitySymbol): string {
  if (entity.kind === 'block') return `${entity.keyword} ${entity.name}`;
  if (entity.kind === 'field' || entity.kind === 'namedType') {
    return collapseWhitespace(printSyntaxWithoutComments(entity.node.syntax));
  }
  return `${entity.node.keyword()?.text ?? ''} ${entity.name}`;
}

function printSyntaxWithoutComments(node: SyntaxNode): string {
  let text = '';
  for (const token of node.tokens()) {
    if (token.kind === 'Comment') continue;
    text += token.text;
  }
  return text;
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
