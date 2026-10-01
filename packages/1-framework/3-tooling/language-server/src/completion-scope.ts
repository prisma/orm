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
  InsertTextFormat,
  type Range,
} from 'vscode-languageserver';
import { typeConstructorSnippet } from './completion-snippets';
import { refinesScalarType } from './named-type-classification';

export interface ScopeCompletionCapabilities {
  readonly clientSupportsSnippets: boolean;
  readonly clientSupportsTriggerSuggestCommand?: boolean;
}

export function scopeCompletionItems(
  entries: Iterable<readonly [string, ScopeResolution]>,
  binder: Binder,
  range: Range,
  capabilities: ScopeCompletionCapabilities,
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
        item.textEdit = { range, newText: `${name}.` };
        if (capabilities.clientSupportsTriggerSuggestCommand === true) {
          item.command = {
            title: 'Suggest namespace members',
            command: 'editor.action.triggerSuggest',
          };
        }
        break;
      case 'contributedType': {
        const descriptor = resolution.symbol.descriptor;
        const callable = descriptor.args !== undefined || descriptor.entityRefArg !== undefined;
        item.kind = callable ? CompletionItemKind.Function : CompletionItemKind.Keyword;
        if (callable) {
          item.textEdit = {
            range,
            newText: capabilities.clientSupportsSnippets
              ? typeConstructorSnippet(name, descriptor)
              : `${name}()`,
          };
          if (capabilities.clientSupportsSnippets) item.insertTextFormat = InsertTextFormat.Snippet;
        }
        item.detail =
          descriptor.deprecated === undefined
            ? descriptor.documentation || 'Configured scalar type'
            : `Deprecated: use ${descriptor.deprecated.replacement}.`;
        if (descriptor.deprecated !== undefined) item.tags = [CompletionItemTag.Deprecated];
        break;
      }
      case 'block':
        item.kind =
          resolution.symbol.keyword === 'enum'
            ? CompletionItemKind.Enum
            : CompletionItemKind.Keyword;
        item.detail = resolution.symbol.keyword;
        break;
    }
    items.push(item);
  }
  return items;
}
