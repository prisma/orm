import type { Binder, PslSymbol } from '@internal/psl-parser';
import type {
  IdentifierAst,
  PslSources,
  SourceFile,
  SyntaxNode,
} from '@internal/psl-parser/syntax';
import type { Location, LocationLink, Range } from 'vscode-languageserver';
import type { PslCursorInput } from './attribute-syntax-context';
import { identTokenAt, pslSymbolOf, resolvedNodeAt } from './cursor-resolution';

export interface ProvideDefinitionInput extends PslCursorInput {
  readonly sources: PslSources;
  readonly binder: Binder;
  readonly linkSupport: boolean;
}

interface Declaration {
  readonly node: SyntaxNode;
  readonly name: IdentifierAst | undefined;
}

export function provideDefinition(
  input: ProvideDefinitionInput,
): LocationLink[] | Location[] | null {
  const token = identTokenAt(input.document.syntax, input.sourceFile.offsetAt(input.position));
  const reference = token === undefined ? undefined : resolvedNodeAt(token, input.binder);
  const symbol = reference === undefined ? undefined : pslSymbolOf(reference.resolution);
  if (reference === undefined || symbol === undefined) return null;
  const declarations = declarationsOf(symbol);
  if (!input.linkSupport) {
    return declarations.map((declaration) => {
      const target = input.sources.sourceFileFor(declaration.node);
      return { uri: target.filename, range: rangeOf(target, nameNode(declaration)) };
    });
  }
  const originSelectionRange = rangeOf(input.sourceFile, reference.node);
  return declarations.map((declaration) => {
    const target = input.sources.sourceFileFor(declaration.node);
    return {
      originSelectionRange,
      targetUri: target.filename,
      targetRange: rangeOf(target, declaration.node),
      targetSelectionRange: rangeOf(target, nameNode(declaration)),
    };
  });
}

function declarationsOf(symbol: PslSymbol): readonly Declaration[] {
  if (symbol.kind === 'namespace') {
    return symbol.declarations.map(({ node }) => ({ node: node.syntax, name: node.name() }));
  }
  return [{ node: symbol.node.syntax, name: symbol.node.name() }];
}

function nameNode(declaration: Declaration): SyntaxNode {
  return declaration.name?.syntax ?? declaration.node;
}

function rangeOf(sourceFile: SourceFile, node: SyntaxNode): Range {
  return {
    start: sourceFile.positionAt(node.offset),
    end: sourceFile.positionAt(node.endOffset),
  };
}
