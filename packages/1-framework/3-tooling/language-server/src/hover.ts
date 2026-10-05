import type {
  AuthoringArgumentDescriptor,
  AuthoringPslBlockDescriptorNamespace,
} from '@internal/framework-components/authoring';
import type {
  AttributeSymbol,
  Binder,
  BlockSymbol,
  CompositeTypeSymbol,
  ConstantSymbol,
  ContributedTypeSymbol,
  FieldSymbol,
  FunctionSymbol,
  ModelSymbol,
  NamedTypeSymbol,
  ParameterSymbol,
  NamespaceSymbol,
  Resolution,
} from '@internal/psl-parser';
import { findBlockDescriptor } from '@internal/psl-parser';
import {
  GenericBlockDeclarationAst,
  type SyntaxNode,
  type SyntaxToken,
} from '@internal/psl-parser/syntax';
import { type Hover, MarkupKind } from 'vscode-languageserver';
import type { PslCursorInput } from './attribute-syntax-context';
import { resolvedNodeAt } from './cursor-resolution';
import {
  namedParameterText,
  renderSignatureLabel,
  resolveSignatureParameters,
} from './signature-help';

export interface ProvidePslHoverInput extends PslCursorInput {
  readonly binder: Binder;
  readonly pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace;
}

type HoverEntitySymbol =
  | ModelSymbol
  | CompositeTypeSymbol
  | FieldSymbol
  | NamedTypeSymbol
  | BlockSymbol;

type HoverResult =
  | { readonly kind: 'entity'; readonly symbol: HoverEntitySymbol }
  | { readonly kind: 'namespace'; readonly symbol: NamespaceSymbol }
  | { readonly kind: 'attribute'; readonly symbol: AttributeSymbol }
  | { readonly kind: 'contributedType'; readonly symbol: ContributedTypeSymbol }
  | { readonly kind: 'parameter'; readonly symbol: ParameterSymbol }
  | { readonly kind: 'function'; readonly symbol: FunctionSymbol }
  | { readonly kind: 'constant'; readonly symbol: ConstantSymbol };

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
  pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace,
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
  return narrowHoverResult(resolvedNodeAt(token, binder)?.resolution);
}

function narrowHoverResult(resolution: Resolution | undefined): HoverResult | undefined {
  switch (resolution?.kind) {
    case 'model':
    case 'compositeType':
    case 'namedType':
    case 'block':
    case 'field':
      return { kind: 'entity', symbol: resolution.symbol };
    case 'namespace':
      return { kind: 'namespace', symbol: resolution.symbol };
    case 'attribute':
      return { kind: 'attribute', symbol: resolution.symbol };
    case 'contributedType':
      return { kind: 'contributedType', symbol: resolution.symbol };
    case 'parameter':
      return { kind: 'parameter', symbol: resolution.symbol };
    case 'function':
      return { kind: 'function', symbol: resolution.symbol };
    case 'constant':
      return { kind: 'constant', symbol: resolution.symbol };
    default:
      return undefined;
  }
}

function renderHoverResult(result: HoverResult): string {
  if (result.kind === 'entity') return renderEntityContent(result.symbol);
  if (result.kind === 'namespace') return renderNamespaceContent(result.symbol);
  if (result.kind === 'attribute') return renderAttributeContent(result.symbol);
  if (result.kind === 'contributedType') return renderContributedTypeContent(result.symbol);
  if (result.kind === 'parameter') return renderParameterContent(result.symbol);
  if (result.kind === 'function') return renderFunctionContent(result.symbol);
  return renderConstantContent(result.symbol);
}

function renderEntityContent(entity: HoverEntitySymbol): string {
  const fence = ['```prisma', renderDeclarationLine(entity), '```'].join('\n');
  return withDocumentation(fence, entity.node.docComment());
}

function renderNamespaceContent(namespace: NamespaceSymbol): string {
  return ['```prisma', `namespace ${namespace.name}`, '```'].join('\n');
}

function renderAttributeContent(symbol: AttributeSymbol): string {
  const name = `${symbol.level === 'field' ? '@' : '@@'}${symbol.name}`;
  const params = resolveSignatureParameters(symbol.spec, undefined);
  const { label } = renderSignatureLabel(name, symbol.spec, params);
  const fence = ['```prisma', label, '```'].join('\n');
  return withDocumentation(fence, symbol.spec.documentation);
}

function renderContributedTypeContent(symbol: ContributedTypeSymbol): string {
  const fence = ['```prisma', renderContributedTypeLabel(symbol), '```'].join('\n');
  const documentation =
    symbol.descriptor.kind === 'typeConstructor' ? symbol.descriptor.documentation : undefined;
  return withDocumentation(fence, documentation);
}

function renderParameterContent(symbol: ParameterSymbol): string {
  const fence = ['```prisma', namedParameterText(symbol.name, symbol.param.type), '```'].join('\n');
  return withDocumentation(fence, symbol.param.documentation);
}

function renderFunctionContent(symbol: FunctionSymbol): string {
  const params = resolveSignatureParameters(symbol.signature, undefined);
  const { label } = renderSignatureLabel(symbol.name, symbol.signature, params);
  const fence = ['```prisma', label, '```'].join('\n');
  return withDocumentation(fence, symbol.signature.documentation);
}

function renderConstantContent(symbol: ConstantSymbol): string {
  const fence = ['```prisma', symbol.name, '```'].join('\n');
  return withDocumentation(fence, symbol.documentation);
}

function withDocumentation(fence: string, documentation: string | undefined): string {
  return documentation === undefined || documentation === ''
    ? fence
    : `${fence}\n\n${documentation}`;
}

function renderContributedTypeLabel(symbol: ContributedTypeSymbol): string {
  const path = symbol.path.join('.');
  const args = symbol.descriptor.args ?? [];
  if (args.length === 0) return path;
  const labels = args.map((arg, index) => {
    const key = arg.name ?? `arg${index + 1}`;
    return `${key}${arg.optional === true ? '?' : ''}: ${argumentTypeLabel(arg)}`;
  });
  return `${path}(${labels.join(', ')})`;
}

function argumentTypeLabel(arg: AuthoringArgumentDescriptor): string {
  if (arg.kind === 'string') return 'string';
  if (arg.kind === 'boolean') return 'boolean';
  if (arg.kind === 'number') return 'number';
  if (arg.kind === 'stringArray') return 'string[]';
  if (arg.kind === 'object') return 'object';
  return arg.values.map((value) => `'${value}'`).join(' | ');
}

function blockKeywordDocumentationAt(
  token: SyntaxToken,
  pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace,
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
