import {
  type Binder,
  type EntitySelector,
  entityReference,
  matchesSelector,
  type ScopeResolution,
} from '@internal/psl-parser';
import {
  type CompletionItem,
  CompletionItemKind,
  CompletionItemTag,
  type Range,
} from 'vscode-languageserver';
import { refinesScalarType } from './named-type-classification';

export function scopeCompletionItems(
  entries: Iterable<readonly [string, ScopeResolution]>,
  binder: Binder,
  range: Range,
  selector?: EntitySelector,
): readonly CompletionItem[] {
  const items: CompletionItem[] = [];
  for (const [name, resolution] of entries) {
    if (selector !== undefined) {
      const reference = entityReference(resolution);
      if (reference === undefined || !matchesSelector(reference, selector)) continue;
    } else if (resolution.kind === 'block') {
      continue;
    }
    const item: CompletionItem = {
      label: name,
      filterText: name,
      textEdit: { range, newText: name },
    };
    switch (resolution.kind) {
      case 'model':
        item.kind = CompletionItemKind.Class;
        item.detail = 'Model';
        break;
      case 'compositeType':
        item.kind = CompletionItemKind.Struct;
        item.detail = 'Composite type';
        break;
      case 'namedType': {
        const scalar = refinesScalarType(resolution.symbol, binder);
        item.kind = scalar ? CompletionItemKind.Unit : CompletionItemKind.Reference;
        item.detail = scalar ? 'Scalar type' : 'Type alias';
        break;
      }
      case 'namespace':
      case 'contributedNamespace':
        item.kind = CompletionItemKind.Module;
        item.detail = 'Namespace';
        break;
      case 'contributedType': {
        const descriptor = resolution.symbol.descriptor;
        item.kind = CompletionItemKind.Keyword;
        item.detail =
          descriptor.deprecated === undefined
            ? descriptor.documentation || 'Configured scalar type'
            : `Deprecated: use ${descriptor.deprecated.replacement}.`;
        if (descriptor.deprecated !== undefined) item.tags = [CompletionItemTag.Deprecated];
        break;
      }
      case 'block':
        item.kind = CompletionItemKind.Keyword;
        item.detail = resolution.symbol.keyword;
        break;
    }
    items.push(item);
  }
  return items;
}
