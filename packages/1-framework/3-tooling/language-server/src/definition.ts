import type { Binder, PslSymbol, Resolution } from '@internal/psl-parser';
import type {
  DocumentAst,
  IdentifierAst,
  PslSources,
  SourceFile,
  SyntaxNode,
} from '@internal/psl-parser/syntax';
import type { Location, LocationLink, Position, Range } from 'vscode-languageserver';
import { identTokenAt, resolvedNodeAt } from './cursor-resolution';

export interface DefinitionSource {
  readonly document: DocumentAst;
  readonly sourceFile: SourceFile;
  readonly sources: PslSources;
  readonly binder: Binder;
}

interface Declaration {
  readonly node: SyntaxNode;
  readonly name: IdentifierAst | undefined;
}

export function provideDefinition(
  source: DefinitionSource,
  position: Position,
  linkSupport: boolean,
): LocationLink[] | Location[] | null {
  const token = identTokenAt(source.document.syntax, source.sourceFile.offsetAt(position));
  const reference = token === undefined ? undefined : resolvedNodeAt(token, source.binder);
  if (reference === undefined) return null;
  const declarations = declarationsOf(reference.resolution);
  if (declarations.length === 0) return null;
  if (!linkSupport) {
    return declarations.map((declaration) => {
      const target = source.sources.sourceFileFor(declaration.node);
      return { uri: target.filename, range: rangeOf(target, nameNode(declaration)) };
    });
  }
  const originSelectionRange = rangeOf(source.sourceFile, reference.node);
  return declarations.map((declaration) => {
    const target = source.sources.sourceFileFor(declaration.node);
    return {
      originSelectionRange,
      targetUri: target.filename,
      targetRange: rangeOf(target, declaration.node),
      targetSelectionRange: rangeOf(target, nameNode(declaration)),
    };
  });
}

function declarationsOf(resolution: Resolution): readonly Declaration[] {
  switch (resolution.kind) {
    case 'model':
    case 'compositeType':
    case 'namedType':
    case 'block':
    case 'field':
      return [declarationOf(resolution.symbol)];
    case 'namespace':
      return resolution.symbol.declarations.map(({ node }) => ({
        node: node.syntax,
        name: node.name(),
      }));
    case 'contributedType':
    case 'contributedNamespace':
    case 'crossSpace':
    case 'attribute':
    case 'parameter':
    case 'function':
    case 'constant':
    case 'unresolved':
      return [];
  }
}

function declarationOf(symbol: Exclude<PslSymbol, { kind: 'namespace' }>): Declaration {
  return { node: symbol.node.syntax, name: symbol.node.name() };
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
