import {
  type DocumentAst,
  NamespaceDeclarationAst,
  type NamespaceMemberAst,
  type PslSources,
  type TypesBlockAst,
} from '@internal/psl-parser/syntax';
import { type FoldingRange, FoldingRangeKind } from 'vscode-languageserver';

type Declaration = NamespaceMemberAst | TypesBlockAst | NamespaceDeclarationAst;

/**
 * Computes folding ranges for block declarations in a PSL document.
 *
 * Block types that produce folding ranges:
 * - model (e.g., `model User { ... }`)
 * - composite type (e.g., `type Address { ... }`)
 * - namespace (e.g., `namespace billing { ... }`)
 * - generic blocks (generator, datasource, extension blocks)
 * - types block (e.g., `types { ... }`)
 *
 * The range spans from the line containing `{` to the line containing `}`.
 */
export function computeFoldingRanges(document: DocumentAst, sources: PslSources): FoldingRange[] {
  const ranges: FoldingRange[] = [];
  collectFoldingRanges(document, sources, ranges);
  return ranges;
}

function collectFoldingRanges(
  document: DocumentAst,
  sources: PslSources,
  ranges: FoldingRange[],
): void {
  for (const declaration of document.declarations()) {
    addFoldingRange(declaration, sources, ranges);

    const namespace = NamespaceDeclarationAst.cast(declaration.syntax);
    if (namespace !== undefined) {
      for (const nested of namespace.declarations()) {
        addFoldingRange(nested, sources, ranges);
      }
    }
  }
}

function addFoldingRange(
  declaration: Declaration,
  sources: PslSources,
  ranges: FoldingRange[],
): void {
  const lbrace = declaration.lbrace();
  const rbrace = declaration.rbrace();

  if (lbrace === undefined || rbrace === undefined) {
    return;
  }

  const sourceFile = sources.sourceFileFor(declaration.syntax);
  const startLine = sourceFile.positionAt(lbrace.offset).line;
  const endLine = sourceFile.positionAt(rbrace.offset).line;

  ranges.push({
    startLine,
    endLine,
    kind: FoldingRangeKind.Region,
  });
}
