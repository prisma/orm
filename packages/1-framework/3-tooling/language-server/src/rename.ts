import {
  type BlockSymbol,
  type FieldSymbol,
  findBlockDescriptor,
  isPslIdentifier,
  type ModelSymbol,
  type PslSymbol,
  typeReferenceNode,
} from '@internal/psl-parser';
import {
  type AstNode,
  type GenericBlockDeclarationAst,
  ModelAttributeAst,
  ModelDeclarationAst,
  type SourceFile,
  type SyntaxElement,
  SyntaxToken,
} from '@internal/psl-parser/syntax';
import {
  LSPErrorCodes,
  type Range,
  ResponseError,
  type TextEdit,
  type WorkspaceEdit,
} from 'vscode-languageserver';
import { type AttributeSpecSource, attributeSpecResolver } from './attribute-spec-resolution';
import { identTokenAt, pslSymbolOf, resolvedNodeAt } from './cursor-resolution';
import { type ProvideReferencesInput, provideReferences } from './references';

export type ProvidePrepareRenameInput = Omit<ProvideReferencesInput, 'includeDeclaration'>;

export interface ProvideRenameInput
  extends ProvidePrepareRenameInput,
    Omit<AttributeSpecSource, 'binder'> {
  readonly newName: string;
}

export interface PrepareRenameResult {
  readonly range: Range;
  readonly placeholder: string;
}

export function providePrepareRename(input: ProvidePrepareRenameInput): PrepareRenameResult | null {
  const { sourceFile } = input;
  const token = identTokenAt(input.document.syntax, sourceFile.offsetAt(input.position));
  if (token === undefined) return null;
  if (provideReferences({ ...input, includeDeclaration: true }).length === 0) return null;
  return {
    range: {
      start: sourceFile.positionAt(token.offset),
      end: sourceFile.positionAt(token.endOffset),
    },
    placeholder: token.text,
  };
}

export function provideRename(input: ProvideRenameInput): WorkspaceEdit | null {
  const { newName } = input;
  if (!isPslIdentifier(newName)) {
    throw new ResponseError(
      LSPErrorCodes.RequestFailed,
      `"${newName}" is not a valid PSL identifier`,
    );
  }
  const locations = provideReferences({ ...input, includeDeclaration: true });
  if (locations.length === 0) return null;
  const changes: Record<string, TextEdit[]> = {};
  const editsOf = (uri: string): TextEdit[] => {
    const edits = changes[uri] ?? [];
    changes[uri] = edits;
    return edits;
  };
  for (const { uri, range } of locations) {
    editsOf(uri).push({ range, newText: newName });
  }
  const insertion = mapAttributeEdit(input);
  if (insertion !== undefined) editsOf(insertion.uri).push(insertion.edit);
  return { changes };
}

interface MapAttributeEdit {
  readonly uri: string;
  readonly edit: TextEdit;
}

function mapAttributeEdit(input: ProvideRenameInput): MapAttributeEdit | undefined {
  const symbol = renamedSymbol(input);
  if (symbol === undefined || symbol.name === input.newName) return undefined;
  switch (symbol.kind) {
    case 'model':
      return modelTakesMap(symbol, input) ? blockMapEdit(symbol, input) : undefined;
    case 'field':
      return fieldTakesMap(symbol, input) ? fieldMapEdit(symbol, input) : undefined;
    case 'block':
      return blockTakesMap(symbol, input) ? blockMapEdit(symbol, input) : undefined;
    case 'compositeType':
    case 'namedType':
    case 'namespace':
      return undefined;
  }
}

function renamedSymbol(input: ProvideRenameInput): PslSymbol | undefined {
  const token = identTokenAt(input.document.syntax, input.sourceFile.offsetAt(input.position));
  const resolved = token === undefined ? undefined : resolvedNodeAt(token, input.binder);
  return resolved === undefined ? undefined : pslSymbolOf(resolved.resolution);
}

function modelTakesMap(model: ModelSymbol, source: AttributeSpecSource): boolean {
  if (hasAttribute(model.node.attributes(), 'map')) return false;
  if (hasAttribute(model.node.attributes(), 'base')) return false;
  return (
    attributeSpecResolver({ ownerKind: 'model', model: model.node }, source)('map') !== undefined
  );
}

function fieldTakesMap(field: FieldSymbol, source: AttributeSpecSource): boolean {
  const owner = field.node.syntax.parent;
  const model = owner === undefined ? undefined : ModelDeclarationAst.cast(owner);
  if (model === undefined) return false;
  if (hasAttribute(field.node.attributes(), 'map')) return false;
  const type = typeReferenceNode(field);
  const typeKind = type === undefined ? undefined : source.binder.symbolForNode(type)?.kind;
  if (typeKind === 'model' || typeKind === 'crossSpace') return false;
  const resolve = attributeSpecResolver({ ownerKind: 'field', field: field.node, model }, source);
  return resolve('map') !== undefined;
}

function blockTakesMap(block: BlockSymbol, source: AttributeSpecSource): boolean {
  if (hasAttribute(block.node.attributes(), 'map')) return false;
  return findBlockDescriptor(source.pslBlockDescriptors, block.keyword)?.nameIsStorageName === true;
}

function hasAttribute(attributes: Iterable<AttributeNameHolder>, name: string): boolean {
  for (const attribute of attributes) {
    if (attribute.name()?.isSimpleName(name) === true) return true;
  }
  return false;
}

type AttributeNameHolder = Pick<ModelAttributeAst, 'name'>;

function fieldMapEdit(field: FieldSymbol, input: ProvideRenameInput): MapAttributeEdit | undefined {
  const sourceFile = sourceFileOf(field.node, input);
  if (sourceFile === undefined) return undefined;
  const end = sourceFile.positionAt(field.node.syntax.endOffset);
  return {
    uri: sourceFile.filename,
    edit: { range: { start: end, end }, newText: ` @map("${field.name}")` },
  };
}

function blockMapEdit(
  symbol: ModelSymbol | BlockSymbol,
  input: ProvideRenameInput,
): MapAttributeEdit | undefined {
  const sourceFile = sourceFileOf(symbol.node, input);
  const rbrace = symbol.node.rbrace();
  if (sourceFile === undefined || rbrace === undefined) return undefined;
  const newline = sourceFile.text.includes('\r\n') ? '\r\n' : '\n';
  const declarationIndent = lineIndent(symbol.node.syntax) ?? '';
  const members = lastAndFirstMember(symbol.node);
  const memberIndent = members === undefined ? undefined : lineIndent(members.first.syntax);
  const line = `${memberIndent ?? `${declarationIndent}  `}@@map("${symbol.name}")${newline}`;
  const afterField = members !== undefined && !(members.last instanceof ModelAttributeAst);
  const closingIndent = whitespaceBefore(rbrace);
  const closingLineStart = closingIndent ?? rbrace;
  if (startsLine(closingLineStart)) {
    const blank = afterField && !followsBlankLine(closingLineStart) ? newline : '';
    const at = sourceFile.positionAt(closingLineStart.offset);
    return {
      uri: sourceFile.filename,
      edit: { range: { start: at, end: at }, newText: `${blank}${line}` },
    };
  }
  return {
    uri: sourceFile.filename,
    edit: {
      range: {
        start: sourceFile.positionAt(closingLineStart.offset),
        end: sourceFile.positionAt(rbrace.offset),
      },
      newText: `${newline}${afterField ? newline : ''}${line}${declarationIndent}`,
    },
  };
}

function startsLine(element: SyntaxElement): boolean {
  const before = element.prevSiblingOrToken;
  return before === undefined || before.kind === 'Newline';
}

function followsBlankLine(lineStart: SyntaxElement): boolean {
  const lineBreak = lineStart.prevSiblingOrToken;
  const before = lineBreak?.prevSiblingOrToken;
  return (before?.kind === 'Whitespace' ? before.prevSiblingOrToken : before)?.kind === 'Newline';
}

function lineIndent(element: SyntaxElement): string | undefined {
  const whitespace = whitespaceBefore(element);
  return startsLine(whitespace ?? element) ? (whitespace?.text ?? '') : undefined;
}

function lastAndFirstMember(
  node: ModelDeclarationAst | GenericBlockDeclarationAst,
): { readonly first: AstNode; readonly last: AstNode } | undefined {
  let first: AstNode | undefined;
  let last: AstNode | undefined;
  for (const member of node.members()) {
    first ??= member;
    last = member;
  }
  return first === undefined || last === undefined ? undefined : { first, last };
}

function whitespaceBefore(element: SyntaxElement): SyntaxToken | undefined {
  const before = element.prevSiblingOrToken;
  return before instanceof SyntaxToken && before.kind === 'Whitespace' ? before : undefined;
}

function sourceFileOf(node: AstNode, input: ProvideRenameInput): SourceFile | undefined {
  const root = node.syntax.root();
  return input.documents.find(({ document }) => document.syntax === root)?.sourceFile;
}
