import {
  type Binder,
  type EntitySelector,
  entityReference,
  isNamespaceLike,
  matchesSelector,
  memberEntries,
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

export interface EntitySelection {
  readonly selector: EntitySelector;
  readonly namespaces: boolean;
}

export function scopeCompletionItems(
  entries: Iterable<readonly [string, ScopeResolution]>,
  binder: Binder,
  range: Range,
  capabilities: ScopeCompletionCapabilities,
  selection?: EntitySelection,
): readonly CompletionItem[] {
  const items: CompletionItem[] = [];
  for (const [name, resolution] of entries) {
    if (selection !== undefined) {
      if (!offersEntity(resolution, selection)) continue;
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
        const callable =
          descriptor.kind === 'fieldPreset' ||
          descriptor.args !== undefined ||
          descriptor.entityRefArg !== undefined;
        item.kind = callable ? CompletionItemKind.Function : CompletionItemKind.Class;
        if (callable) {
          item.textEdit = {
            range,
            newText: capabilities.clientSupportsSnippets
              ? typeConstructorSnippet(name, descriptor)
              : `${name}()`,
          };
          if (capabilities.clientSupportsSnippets) item.insertTextFormat = InsertTextFormat.Snippet;
        }
        if (descriptor.kind === 'fieldPreset') {
          item.detail = 'Field preset';
          break;
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

function offersEntity(resolution: ScopeResolution, selection: EntitySelection): boolean {
  if (isNamespaceLike(resolution)) {
    if (!selection.namespaces) return false;
    for (const [, member] of memberEntries(resolution)) {
      if (matchesEntity(member, selection.selector)) return true;
    }
    return false;
  }
  return matchesEntity(resolution, selection.selector);
}

function matchesEntity(resolution: ScopeResolution, selector: EntitySelector): boolean {
  const reference = entityReference(resolution);
  return reference !== undefined && matchesSelector(reference, selector);
}
