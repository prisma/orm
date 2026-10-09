import {
  type ArgType,
  type Binder,
  isNamespaceLike,
  memberEntries,
  type Scope,
  type ScopeResolution,
} from '@internal/psl-parser';
import type { SourceFile } from '@internal/psl-parser/syntax';
import { type CompletionItem, CompletionItemKind, InsertTextFormat } from 'vscode-languageserver';
import {
  type ArgumentGrammar,
  type ArgumentSignature,
  resolveGrammar,
} from './attribute-argument-grammar';
import type {
  AttributeArgumentPosition,
  AttributeArgumentSlotPosition,
  AttributeNamedKeyPosition,
  AttributeValuePosition,
} from './completion-context';
import { type EntitySelection, scopeCompletionItems } from './completion-scope';
import { requiredArgumentsSnippet } from './completion-snippets';

interface CompletionInput<Position extends AttributeArgumentPosition> {
  readonly context: Position;
  readonly sourceFile: SourceFile;
  readonly clientSupportsSnippets: boolean;
  readonly clientSupportsTriggerSuggestCommand?: boolean;
  readonly clientSupportsTriggerParameterHintsCommand?: boolean;
}

interface ValueCompletionInput<Position extends AttributeArgumentPosition>
  extends CompletionInput<Position> {
  readonly fieldNames: (kind: 'fieldRef' | 'referencedFieldRef') => readonly string[];
  readonly scope: Scope;
  readonly binder: Binder;
}

export function provideAttributeNamedKeyCompletionItems(
  input: CompletionInput<AttributeNamedKeyPosition>,
  root: ArgumentGrammar,
): readonly CompletionItem[] {
  return orderedItems(
    resolveGrammar(root, input.context.path).flatMap((grammar) =>
      'kind' in grammar ? [] : namedKeyItems(input, grammar),
    ),
  );
}

export function provideAttributeArgumentSlotCompletionItems(
  input: ValueCompletionInput<AttributeArgumentSlotPosition>,
  root: ArgumentGrammar,
): readonly CompletionItem[] {
  return orderedItems(
    resolveGrammar(root, input.context.path).flatMap((grammar) => {
      if ('kind' in grammar) return [];
      const param = grammar.positional?.[input.context.positionalIndex]?.type;
      return [...valueItems(input, param, 'scalar', undefined), ...namedKeyItems(input, grammar)];
    }),
  );
}

export function provideAttributeValueCompletionItems(
  input: ValueCompletionInput<AttributeValuePosition>,
  root: ArgumentGrammar,
): readonly CompletionItem[] {
  return orderedItems(
    resolveGrammar(root, input.context.path).flatMap((grammar) =>
      'kind' in grammar
        ? valueItems(input, grammar, input.context.syntax, input.context.qualifier)
        : [],
    ),
  );
}

function namedKeyItems(
  input: CompletionInput<AttributeNamedKeyPosition>,
  signature: ArgumentSignature,
): readonly CompletionItem[] {
  return Object.entries(signature.named ?? {})
    .filter(([name]) => !input.context.existingNamedKeys.includes(name))
    .map(([name, param]) => {
      const snippet = input.clientSupportsSnippets && !input.context.hasColon;
      const value = snippet ? `\${1:${name}}` : '';
      const text = input.context.hasColon ? name : `${name}: ${value}`;
      return {
        ...completionItem(
          input,
          name,
          text,
          CompletionItemKind.Property,
          snippet,
          param.documentation,
        ),
        ...(!input.context.hasColon && input.clientSupportsTriggerSuggestCommand === true
          ? {
              command: {
                title: 'Suggest argument values',
                command: 'editor.action.triggerSuggest',
              },
            }
          : {}),
      };
    });
}

function valueItems(
  input: ValueCompletionInput<AttributeArgumentPosition>,
  type: ArgType<unknown, never> | undefined,
  syntax: AttributeValuePosition['syntax'],
  qualifier: string | undefined,
): readonly CompletionItem[] {
  if (type === undefined) return [];
  if (type.kind === 'oneOf') {
    return type.alternatives.flatMap((alternative) =>
      valueItems(input, alternative, syntax, qualifier),
    );
  }
  if (type.kind === 'funcCall') {
    const snippet = input.clientSupportsSnippets && syntax !== 'functionName';
    const hasParameters =
      (type.signature.positional?.length ?? 0) > 0 ||
      Object.keys(type.signature.named ?? {}).length > 0;
    const args = requiredArgumentsSnippet(type.signature) || (hasParameters ? '$' + '{1:}' : '');
    const text = snippet ? `${type.name}(${args})` : type.name;
    return [
      {
        ...completionItem(
          input,
          type.name,
          text,
          CompletionItemKind.Function,
          snippet,
          type.signature.documentation,
        ),
        ...(snippet && input.clientSupportsTriggerParameterHintsCommand === true && hasParameters
          ? {
              command: {
                title: 'Show argument hints',
                command: 'editor.action.triggerParameterHints',
              },
            }
          : {}),
      },
    ];
  }
  if (syntax === 'functionName') return [];
  if (qualifier !== undefined) return qualifiedItems(input, type, qualifier);
  if (type.kind === 'taggedLiteral' || type.kind === 'dataTypeValue') {
    return type.tags.map((tag) => ({
      ...completionItem(
        input,
        tag,
        input.clientSupportsSnippets ? `${tag}\`$1\`` : tag,
        CompletionItemKind.Value,
        input.clientSupportsSnippets,
      ),
      detail: type.documentation,
    }));
  }
  switch (type.kind) {
    case 'identifier':
      return type.name === undefined ? [] : scalarItems(input, [type.name], type.documentation);
    case 'str':
      return scalarItems(input, type.value === undefined ? [] : [JSON.stringify(type.value)]);
    case 'num':
      return scalarItems(input, type.value === undefined ? [] : [String(type.value)]);
    case 'bool':
      return scalarItems(input, ['true', 'false']);
    case 'null':
      return scalarItems(input, ['null']);
    case 'fieldRef':
    case 'referencedFieldRef':
      return scalarItems(input, input.fieldNames(type.kind));
    case 'entityRef':
      return entityItems(input, input.scope.entries(), {
        selector: type.expected,
        namespaces: true,
      });
    case 'list':
    case 'record':
    case 'int':
    case 'json':
    case 'rejecting':
      return [];
  }
}

function qualifiedItems(
  input: ValueCompletionInput<AttributeArgumentPosition>,
  type: ArgType<unknown, never>,
  qualifier: string,
): readonly CompletionItem[] {
  if (type.kind !== 'entityRef') return [];
  const namespace = input.scope.lookup(qualifier);
  if (namespace === undefined || !isNamespaceLike(namespace)) return [];
  return entityItems(input, memberEntries(namespace), {
    selector: type.expected,
    namespaces: false,
  });
}

function entityItems(
  input: ValueCompletionInput<AttributeArgumentPosition>,
  entries: Iterable<readonly [string, ScopeResolution]>,
  selection: EntitySelection,
): readonly CompletionItem[] {
  return scopeCompletionItems(
    entries,
    input.binder,
    {
      start: input.sourceFile.positionAt(input.context.replacementStartOffset),
      end: input.sourceFile.positionAt(input.context.replacementEndOffset),
    },
    input,
    selection,
  );
}

function scalarItems(
  input: CompletionInput<AttributeArgumentPosition>,
  labels: readonly string[],
  documentation?: string,
): readonly CompletionItem[] {
  return labels.map((label) =>
    completionItem(input, label, label, CompletionItemKind.Value, false, documentation),
  );
}

function completionItem(
  input: CompletionInput<AttributeArgumentPosition>,
  label: string,
  newText: string,
  kind: CompletionItemKind,
  snippet = false,
  documentation?: string,
): CompletionItem {
  return {
    label,
    kind,
    detail:
      documentation ??
      (kind === CompletionItemKind.Property ? 'Attribute argument' : 'PSL argument value'),
    filterText: label,
    textEdit: {
      range: {
        start: input.sourceFile.positionAt(input.context.replacementStartOffset),
        end: input.sourceFile.positionAt(input.context.replacementEndOffset),
      },
      newText,
    },
    ...(snippet ? { insertTextFormat: InsertTextFormat.Snippet } : {}),
  };
}

function orderedItems(items: readonly CompletionItem[]): readonly CompletionItem[] {
  const seen = new Set<string>();
  return items
    .filter((item) => {
      const key = JSON.stringify([item.label, item.textEdit, item.insertTextFormat]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((item, index) => ({ ...item, sortText: index.toString().padStart(4, '0') }));
}
