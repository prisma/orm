import type { Binder, PslSymbol, Resolution } from '@internal/psl-parser';
import type { DocumentAst, SourceFile } from '@internal/psl-parser/syntax';
import type { Location, Position } from 'vscode-languageserver';
import { identTokenAt, resolvedNodeAt } from './cursor-resolution';

export interface ReferencesDocument {
  readonly text: string;
  readonly document: DocumentAst;
  readonly sourceFile: SourceFile;
}

export interface ReferencesSource {
  readonly document: DocumentAst;
  readonly sourceFile: SourceFile;
  readonly documents: readonly ReferencesDocument[];
  readonly binder: Binder;
}

export function provideReferences(
  source: ReferencesSource,
  position: Position,
  includeDeclaration: boolean,
): Location[] {
  const token = identTokenAt(source.document.syntax, source.sourceFile.offsetAt(position));
  const resolved = token === undefined ? undefined : resolvedNodeAt(token, source.binder);
  const target = resolved === undefined ? undefined : targetOf(resolved.resolution);
  if (target === undefined) return [];
  // A namespace has no single declaration: every `namespace X` block both declares and
  // reopens it, so each block name is a usage and none is dropped when the declaration is excluded.
  const declarationName = target.kind === 'namespace' ? undefined : target.node.name()?.syntax;
  const locations: Location[] = [];
  for (const { text, document, sourceFile } of source.documents) {
    for (const offset of occurrencesOf(target.name, text)) {
      const candidate = document.syntax.tokenAtOffset(offset).rightBiased();
      if (candidate?.kind !== 'Ident') continue;
      if (candidate.offset !== offset || candidate.text !== target.name) continue;
      const usage = resolvedNodeAt(candidate, source.binder);
      if (usage === undefined || !names(usage.resolution, target)) continue;
      if (!includeDeclaration && usage.node === declarationName) continue;
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

function targetOf(resolution: Resolution): PslSymbol | undefined {
  switch (resolution.kind) {
    case 'model':
    case 'compositeType':
    case 'namedType':
    case 'block':
    case 'field':
    case 'namespace':
      return resolution.symbol;
    case 'contributedType':
    case 'contributedNamespace':
    case 'crossSpace':
    case 'attribute':
    case 'parameter':
    case 'function':
    case 'constant':
    case 'unresolved':
      return undefined;
  }
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

function names(resolution: Resolution, target: PslSymbol): boolean {
  return (
    resolution.kind !== 'unresolved' &&
    resolution.kind !== 'crossSpace' &&
    resolution.symbol === target
  );
}
