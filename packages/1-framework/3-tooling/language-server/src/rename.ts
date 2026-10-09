import {
  type BlockSymbol,
  type FieldSymbol,
  findBlockDescriptor,
  isPslIdentifier,
  type ModelSymbol,
  type PslSymbol,
  type ResolvedAttribute,
  typeReferenceNode,
} from '@internal/psl-parser';
import type { ResolvedFormatOptions } from '@internal/psl-parser/format';
import {
  type AstNode,
  ModelDeclarationAst,
  type SourceFile,
  type SyntaxNode,
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
  readonly formatOptions: ResolvedFormatOptions;
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
  if (hasAttribute(model.attributes, 'map')) return false;
  if (hasAttribute(model.attributes, 'base')) return false;
  return (
    attributeSpecResolver({ ownerKind: 'model', model: model.node }, source)('map') !== undefined
  );
}

function fieldTakesMap(field: FieldSymbol, source: AttributeSpecSource): boolean {
  const owner = field.node.syntax.parent;
  const model = owner === undefined ? undefined : ModelDeclarationAst.cast(owner);
  if (model === undefined) return false;
  if (hasAttribute(field.attributes, 'map')) return false;
  const type = typeReferenceNode(field);
  const typeKind = type === undefined ? undefined : source.binder.symbolForNode(type)?.kind;
  if (typeKind === 'model' || typeKind === 'crossSpace') return false;
  const resolve = attributeSpecResolver({ ownerKind: 'field', field: field.node, model }, source);
  return resolve('map') !== undefined;
}

function blockTakesMap(block: BlockSymbol, source: AttributeSpecSource): boolean {
  if (hasAttribute(block.attributes, 'map')) return false;
  return findBlockDescriptor(source.pslBlockDescriptors, block.keyword)?.nameIsStorageName === true;
}

function hasAttribute(attributes: readonly ResolvedAttribute[], name: string): boolean {
  return attributes.some((attribute) => attribute.node.name()?.isSimpleName(name) === true);
}

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
  const { indentUnit, newline } = input.formatOptions;
  const indent = indentUnit.repeat(enclosingBlockCount(symbol.node.syntax) + 1);
  const before = rbrace.prevSiblingOrToken;
  const anchor = before instanceof SyntaxToken && before.kind === 'Whitespace' ? before : rbrace;
  const at = sourceFile.positionAt(anchor.offset);
  return {
    uri: sourceFile.filename,
    edit: {
      range: { start: at, end: at },
      newText: `${newline}${indent}@@map("${symbol.name}")${newline}`,
    },
  };
}

function enclosingBlockCount(node: SyntaxNode): number {
  let count = 0;
  for (let parent = node.parent; parent?.parent !== undefined; parent = parent.parent) count++;
  return count;
}

function sourceFileOf(node: AstNode, input: ProvideRenameInput): SourceFile | undefined {
  const root = node.syntax.root();
  return input.documents.find(({ document }) => document.syntax === root)?.sourceFile;
}
