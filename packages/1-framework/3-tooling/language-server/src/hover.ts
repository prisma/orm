import type {
  Binder,
  BlockSymbol,
  CompositeTypeSymbol,
  FieldSymbol,
  ModelSymbol,
  NamedTypeSymbol,
  PslSymbol,
  Resolution,
} from '@internal/psl-parser';
import {
  CompositeTypeDeclarationAst,
  FieldDeclarationAst,
  GenericBlockDeclarationAst,
  ModelDeclarationAst,
  NamedTypeDeclarationAst,
  printSyntax,
  type SyntaxNode,
  type SyntaxToken,
} from '@internal/psl-parser/syntax';
import { type Hover, MarkupKind } from 'vscode-languageserver';
import type { PslCursorInput } from './attribute-syntax-context';
import { readDocComment } from './doc-comment';

export interface ProvidePslHoverInput extends PslCursorInput {
  readonly binder: Binder;
}

type HoverEntitySymbol =
  | ModelSymbol
  | CompositeTypeSymbol
  | FieldSymbol
  | NamedTypeSymbol
  | BlockSymbol;

export function providePslHover(input: ProvidePslHoverInput): Hover | null {
  const offset = input.sourceFile.offsetAt(input.position);
  const token = identTokenAt(input.document.syntax, offset);
  if (token === undefined) return null;
  const entity = resolveHoverEntity(input.binder, token);
  if (entity === undefined) return null;
  return {
    contents: { kind: MarkupKind.Markdown, value: renderHoverContent(entity) },
    range: {
      start: input.sourceFile.positionAt(token.offset),
      end: input.sourceFile.positionAt(token.endOffset),
    },
  };
}

function identTokenAt(root: SyntaxNode, offset: number): SyntaxToken | undefined {
  const at = root.tokenAtOffset(offset);
  const left = at.leftBiased();
  if (left?.kind === 'Ident') return left;
  const right = at.rightBiased();
  return right?.kind === 'Ident' ? right : undefined;
}

function resolveHoverEntity(binder: Binder, token: SyntaxToken): HoverEntitySymbol | undefined {
  const identifier = token.parent;
  return declaredEntityAt(binder, identifier) ?? referencedEntityAt(binder, identifier);
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

function referencedEntityAt(binder: Binder, identifier: SyntaxNode): HoverEntitySymbol | undefined {
  return identifier.findAncestor((node) => narrowResolution(binder.symbolForNode(node)));
}

function narrowResolution(resolution: Resolution | undefined): HoverEntitySymbol | undefined {
  switch (resolution?.kind) {
    case 'model':
    case 'compositeType':
    case 'namedType':
    case 'block':
    case 'field':
      return resolution.symbol;
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

function renderHoverContent(entity: HoverEntitySymbol): string {
  const fence = ['```prisma', renderDeclarationLine(entity), '```'].join('\n');
  const doc = readDocComment(entity.node.syntax);
  return doc === undefined ? fence : `${fence}\n\n${doc}`;
}

function renderDeclarationLine(entity: HoverEntitySymbol): string {
  if (entity.kind === 'block') return `${entity.keyword} ${entity.name}`;
  if (entity.kind === 'field' || entity.kind === 'namedType') {
    return collapseWhitespace(printSyntax(entity.node.syntax));
  }
  return `${entity.node.keyword()?.text ?? ''} ${entity.name}`;
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
