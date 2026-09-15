import type {
  ArgType,
  AttributeSpec,
  InspectableArgType,
  Param,
  PositionalParam,
} from '@internal/psl-parser';
import type { SourceFile } from '@internal/psl-parser/syntax';
import { blindCast } from '@internal/utils/casts';
import { type CompletionItem, CompletionItemKind, InsertTextFormat } from 'vscode-languageserver';
import type {
  AttributeArgumentPathStep,
  AttributeArgumentPosition,
  AttributeArgumentSlotPosition,
  AttributeNamedKeyPosition,
  AttributeValuePosition,
} from './completion-context';
import { requiredArgumentsSnippet } from './completion-snippets';

interface CompletionInput<Position extends AttributeArgumentPosition> {
  readonly context: Position;
  readonly sourceFile: SourceFile;
  readonly clientSupportsSnippets: boolean;
  readonly clientSupportsTriggerSuggestCommand?: boolean;
}

interface ValueCompletionInput<Position extends AttributeArgumentPosition>
  extends CompletionInput<Position> {
  readonly fieldNames: (kind: 'fieldRef' | 'referencedFieldRef') => readonly string[];
}

interface ArgumentSignature {
  readonly positional?: readonly PositionalParam<unknown, never>[];
  readonly named?: Readonly<Record<string, Param<unknown, never>>>;
}

type Grammar = ArgumentSignature | Param<unknown, never>;

export function provideAttributeNamedKeyCompletionItems(
  input: CompletionInput<AttributeNamedKeyPosition>,
  spec: AttributeSpec<never, never>,
): readonly CompletionItem[] {
  return orderedItems(
    resolveGrammar(spec, input.context.path).flatMap((grammar) =>
      'kind' in grammar ? [] : namedKeyItems(input, grammar),
    ),
  );
}

export function provideAttributeArgumentSlotCompletionItems(
  input: ValueCompletionInput<AttributeArgumentSlotPosition>,
  spec: AttributeSpec<never, never>,
): readonly CompletionItem[] {
  return orderedItems(
    resolveGrammar(spec, input.context.path).flatMap((grammar) => {
      if ('kind' in grammar) return [];
      const param = grammar.positional?.[input.context.positionalIndex]?.type;
      return [...valueItems(input, param, 'scalar'), ...namedKeyItems(input, grammar)];
    }),
  );
}

export function provideAttributeValueCompletionItems(
  input: ValueCompletionInput<AttributeValuePosition>,
  spec: AttributeSpec<never, never>,
): readonly CompletionItem[] {
  return orderedItems(
    resolveGrammar(spec, input.context.path).flatMap((grammar) =>
      'kind' in grammar ? valueItems(input, grammar, input.context.syntax) : [],
    ),
  );
}

function directArgType(param: ArgType<unknown, never>): InspectableArgType<never> {
  return blindCast<
    InspectableArgType<never>,
    'Completion inspects registry combinators whose constructors retain kind-specific metadata; public ArgType erases that metadata, and completion never invokes parse.'
  >(param);
}

function resolveGrammar(
  signature: ArgumentSignature,
  path: readonly AttributeArgumentPathStep[],
): readonly Grammar[] {
  let grammars: readonly Grammar[] = [signature];
  for (const step of path) {
    grammars = grammars.flatMap((grammar) => advanceGrammar(grammar, step));
  }
  return grammars;
}

function advanceGrammar(grammar: Grammar, step: AttributeArgumentPathStep): readonly Grammar[] {
  const type = 'kind' in grammar ? directArgType(grammar) : undefined;
  if (type?.kind === 'oneOf') {
    return type.alternatives.flatMap((alternative) => advanceGrammar(alternative, step));
  }
  switch (step.kind) {
    case 'positionalArgument': {
      if ('kind' in grammar) return [];
      const param = grammar.positional?.[step.index]?.type;
      return param === undefined ? [] : [param];
    }
    case 'namedArgument': {
      if ('kind' in grammar) return [];
      const param = grammar.named?.[step.name];
      return param === undefined ? [] : [param];
    }
    case 'listElement':
      return type?.kind === 'list' ? [type.of] : [];
    case 'recordValue':
      return type?.kind === 'record' ? [type.of] : [];
    case 'functionCall':
      return type?.kind === 'funcCall' && type.name === step.name ? [type.signature] : [];
  }
}

function namedKeyItems(
  input: CompletionInput<AttributeNamedKeyPosition>,
  signature: ArgumentSignature,
): readonly CompletionItem[] {
  return Object.keys(signature.named ?? {})
    .filter((name) => !input.context.existingNamedKeys.includes(name))
    .map((name) => {
      const snippet = input.clientSupportsSnippets && !input.context.hasColon;
      const value = snippet ? '$' + '{1:}' : '';
      const text = input.context.hasColon ? name : `${name}: ${value}`;
      return {
        ...completionItem(input, name, text, CompletionItemKind.Property, snippet),
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
  param: Param<unknown, never> | undefined,
  syntax: AttributeValuePosition['syntax'],
): readonly CompletionItem[] {
  if (param === undefined) return [];
  const type = directArgType(param);
  if (type.kind === 'oneOf') {
    return type.alternatives.flatMap((alternative) => valueItems(input, alternative, syntax));
  }
  if (type.kind === 'funcCall') {
    const snippet = input.clientSupportsSnippets && syntax !== 'functionName';
    const text = snippet ? `${type.name}(${requiredArgumentsSnippet(type.signature)})` : type.name;
    return [completionItem(input, type.name, text, CompletionItemKind.Function, snippet)];
  }
  if (syntax === 'functionName') return [];
  switch (type.kind) {
    case 'identifier':
      return scalarItems(input, [type.name]);
    case 'str':
      return scalarItems(input, type.value === undefined ? [] : [JSON.stringify(type.value)]);
    case 'num':
      return scalarItems(input, type.value === undefined ? [] : [String(type.value)]);
    case 'bool':
      return scalarItems(input, ['true', 'false']);
    case 'fieldRef':
    case 'referencedFieldRef':
      return scalarItems(input, input.fieldNames(type.kind));
    case 'list':
    case 'record':
    case 'entityRef':
    case 'int':
    case 'json':
    case 'rejecting':
      return [];
  }
}

function scalarItems(
  input: CompletionInput<AttributeArgumentPosition>,
  labels: readonly string[],
): readonly CompletionItem[] {
  return labels.map((label) => completionItem(input, label, label, CompletionItemKind.Value));
}

function completionItem(
  input: CompletionInput<AttributeArgumentPosition>,
  label: string,
  newText: string,
  kind: CompletionItemKind,
  snippet = false,
): CompletionItem {
  return {
    label,
    kind,
    detail: kind === CompletionItemKind.Property ? 'Attribute argument' : 'PSL argument value',
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
