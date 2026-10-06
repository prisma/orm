import type { Binder } from '@internal/psl-parser';
import type { DocumentAst, SourceFile } from '@internal/psl-parser/syntax';
import type { Location } from 'vscode-languageserver';
import type { PslCursorInput } from './attribute-syntax-context';
import { identTokenAt, pslSymbolOf, resolvedNodeAt } from './cursor-resolution';

export interface ReferencesDocument {
  readonly document: DocumentAst;
  readonly sourceFile: SourceFile;
}

export interface ProvideReferencesInput extends PslCursorInput {
  readonly documents: readonly ReferencesDocument[];
  readonly binder: Binder;
  readonly includeDeclaration: boolean;
}

export function provideReferences(input: ProvideReferencesInput): Location[] {
  const token = identTokenAt(input.document.syntax, input.sourceFile.offsetAt(input.position));
  const resolved = token === undefined ? undefined : resolvedNodeAt(token, input.binder);
  const symbol = resolved === undefined ? undefined : pslSymbolOf(resolved.resolution);
  if (symbol === undefined) return [];
  // A namespace has no single declaration: every `namespace X` block both declares and
  // reopens it, so each block name is a usage and none is dropped when the declaration is excluded.
  const declarationName = symbol.kind === 'namespace' ? undefined : symbol.node.name()?.syntax;
  const locations: Location[] = [];
  for (const { document, sourceFile } of input.documents) {
    for (const offset of occurrencesOf(symbol.name, sourceFile.text)) {
      const candidate = document.syntax.tokenAtOffset(offset).rightBiased();
      if (candidate?.kind !== 'Ident') continue;
      if (candidate.offset !== offset || candidate.text !== symbol.name) continue;
      const usage = resolvedNodeAt(candidate, input.binder);
      if (usage === undefined || pslSymbolOf(usage.resolution) !== symbol) continue;
      if (!input.includeDeclaration && usage.node === declarationName) continue;
      locations.push({
        uri: sourceFile.filename,
        range: {
          start: sourceFile.positionAt(candidate.offset),
          end: sourceFile.positionAt(candidate.endOffset),
        },
      });
    }
  }
  return locations;
}

function* occurrencesOf(name: string, text: string): Iterable<number> {
  if (name.length === 0) return;
  for (
    let offset = text.indexOf(name);
    offset >= 0;
    offset = text.indexOf(name, offset + name.length)
  ) {
    yield offset;
  }
}
