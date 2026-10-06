import {
  type AuthoringPslBlockDescriptorNamespace,
  isAuthoringPslBlockDescriptor,
} from '@internal/framework-components/authoring';
import {
  type ArgType,
  type AttributeSpec,
  assembleAttributeSpecs,
  type BlockSpec,
  blockSpecFactoryOf,
  findBlockDescriptor,
  isNamespaceLike,
  memberEntries,
  type SymbolTable,
} from '@internal/psl-parser';
import type {
  GenericBlockDeclarationAst,
  SourceFile,
  SyntaxNode,
} from '@internal/psl-parser/syntax';
import { type CompletionItem, CompletionItemKind, InsertTextFormat } from 'vscode-languageserver';
import {
  type ArgumentOwner,
  type AttributeSpecSource,
  argumentRootGrammar,
  attributeSpecResolver,
} from './attribute-spec-resolution';
import type {
  AttributeNameCompletionContext,
  DeclarationKeywordCompletionContext,
  GenericBlockKeyCompletionContext,
  ModelTypeCompletionContext,
  NamespaceMemberCompletionContext,
  PslCompletionContext,
} from './completion-context';
import { type ScopeCompletionCapabilities, scopeCompletionItems } from './completion-scope';
import { requiredArgumentsSnippet } from './completion-snippets';
import { localFieldNames, referencedFieldNames } from './completion-symbols';
import {
  provideAttributeArgumentSlotCompletionItems,
  provideAttributeNamedKeyCompletionItems,
  provideAttributeValueCompletionItems,
} from './completion-values';

export interface PslCompletionCandidateSource extends AttributeSpecSource {
  readonly scalarTypes: readonly string[];
}

export interface ProvidePslCompletionItemsInput {
  readonly context: PslCompletionContext;
  readonly sourceFile: SourceFile;
  readonly candidates: PslCompletionCandidateSource;
  readonly clientSupportsSnippets: boolean;
  readonly clientSupportsTriggerSuggestCommand?: boolean;
  readonly clientSupportsTriggerParameterHintsCommand?: boolean;
}

type DeclarationKeywordCompletionCandidateCategory = 'native' | 'genericBlock';

interface DeclarationKeywordCompletionCandidate {
  readonly category: DeclarationKeywordCompletionCandidateCategory;
  readonly label: string;
  readonly insertText: string;
  readonly snippetText: string;
  readonly detail: string;
  readonly kind: CompletionItemKind;
}

const declarationKeywordCategoryOrder: Record<
  DeclarationKeywordCompletionCandidateCategory,
  number
> = {
  native: 0,
  genericBlock: 1,
};

const nameSnippetPlaceholder = '$' + '{1:Name}';
const namespaceSnippetPlaceholder = '$' + '{1:name}';

const namespaceNativeDeclarationKeywords: readonly DeclarationKeywordCompletionCandidate[] = [
  nativeDeclarationKeyword(
    'model',
    'model ',
    `model ${nameSnippetPlaceholder} {\n  \${0:// Fields}\n}`,
    'Defines a data model.',
  ),
  nativeDeclarationKeyword(
    'type',
    'type ',
    `type ${nameSnippetPlaceholder} {\n  \${0:// Fields}\n}`,
    'Defines a reusable composite type.',
  ),
];

const documentNativeDeclarationKeywords: readonly DeclarationKeywordCompletionCandidate[] = [
  ...namespaceNativeDeclarationKeywords,
  nativeDeclarationKeyword(
    'types',
    'types ',
    'types {\n  $' + '{0:// Type aliases}\n}',
    'Defines reusable named types.',
  ),
  nativeDeclarationKeyword(
    'namespace',
    'namespace ',
    `namespace ${namespaceSnippetPlaceholder} {\n  \${0:// Models and types}\n}`,
    'Groups declarations belonging to the same database schema or database.',
  ),
];

export function providePslCompletionItems(
  input: ProvidePslCompletionItemsInput,
): readonly CompletionItem[] {
  const { context } = input;
  switch (context.kind) {
    case 'unsupported':
      return [];
    // Foreign contract-space members require the multi-input symbol table; no
    // contract-space registry exists today, so this position yields nothing yet.
    case 'spaceMember':
      return [];
    case 'fieldAttributeName':
    case 'modelAttributeName':
    case 'blockAttributeName':
      return provideAttributeNameCompletionItems(
        context,
        input.sourceFile,
        input.candidates,
        input.clientSupportsSnippets,
        input.clientSupportsTriggerParameterHintsCommand === true,
      );
    case 'fieldAttributeNamedKey':
    case 'modelAttributeNamedKey':
    case 'blockAttributeNamedKey':
    case 'blockValueNamedKey': {
      const root = argumentRootGrammar(context, input.candidates);
      return root === undefined
        ? []
        : provideAttributeNamedKeyCompletionItems(
            {
              context,
              sourceFile: input.sourceFile,
              clientSupportsSnippets: input.clientSupportsSnippets,
              clientSupportsTriggerSuggestCommand:
                input.clientSupportsTriggerSuggestCommand === true,
            },
            root,
          );
    }
    case 'fieldAttributeArgumentSlot':
    case 'modelAttributeArgumentSlot':
    case 'blockAttributeArgumentSlot':
    case 'blockValueArgumentSlot': {
      const root = argumentRootGrammar(context, input.candidates);
      return root === undefined
        ? []
        : provideAttributeArgumentSlotCompletionItems(
            {
              context,
              binder: input.candidates.binder,
              scope: input.candidates.binder.scopeAt(ownerSyntax(context)),
              sourceFile: input.sourceFile,
              clientSupportsSnippets: input.clientSupportsSnippets,
              clientSupportsTriggerSuggestCommand:
                input.clientSupportsTriggerSuggestCommand === true,
              clientSupportsTriggerParameterHintsCommand:
                input.clientSupportsTriggerParameterHintsCommand === true,
              fieldNames: (kind) =>
                kind === 'fieldRef'
                  ? localFieldNames(context, input.candidates.binder)
                  : referencedFieldNames(context, input.candidates.binder),
            },
            root,
          );
    }
    case 'fieldAttributeValue':
    case 'modelAttributeValue':
    case 'blockAttributeValue':
    case 'blockValue': {
      const root = argumentRootGrammar(context, input.candidates);
      return root === undefined
        ? []
        : provideAttributeValueCompletionItems(
            {
              context,
              binder: input.candidates.binder,
              scope: input.candidates.binder.scopeAt(ownerSyntax(context)),
              sourceFile: input.sourceFile,
              clientSupportsSnippets: input.clientSupportsSnippets,
              clientSupportsTriggerSuggestCommand:
                input.clientSupportsTriggerSuggestCommand === true,
              clientSupportsTriggerParameterHintsCommand:
                input.clientSupportsTriggerParameterHintsCommand === true,
              fieldNames: (kind) =>
                kind === 'fieldRef'
                  ? localFieldNames(context, input.candidates.binder)
                  : referencedFieldNames(context, input.candidates.binder),
            },
            root,
          );
    }
    case 'declarationKeyword':
      return provideDeclarationKeywordCompletionItems(
        context,
        input.sourceFile,
        input.candidates,
        input.clientSupportsSnippets,
      );
    case 'genericBlockKey':
      return provideGenericBlockKeyCompletionItems(context, input.sourceFile, input.candidates, {
        clientSupportsSnippets: input.clientSupportsSnippets,
        clientSupportsTriggerSuggestCommand: input.clientSupportsTriggerSuggestCommand === true,
      });
    case 'modelType':
      return provideModelTypeCompletionItems(context, input.sourceFile, input.candidates, input);
    case 'namespaceMember':
      return provideNamespaceMemberCompletionItems(
        context,
        input.sourceFile,
        input.candidates,
        input,
      );
  }
}

function ownerSyntax(owner: ArgumentOwner): SyntaxNode {
  switch (owner.ownerKind) {
    case 'field':
      return owner.field.syntax;
    case 'model':
      return owner.model.syntax;
    case 'block':
    case 'blockValue':
      return owner.block.syntax;
  }
}

function provideAttributeNameCompletionItems(
  context: AttributeNameCompletionContext,
  sourceFile: SourceFile,
  source: PslCompletionCandidateSource,
  clientSupportsSnippets: boolean,
  clientSupportsTriggerParameterHintsCommand: boolean,
): readonly CompletionItem[] {
  const names = attributeNames(context, source);
  const replacementRange = {
    start: sourceFile.positionAt(context.replacementStartOffset),
    end: sourceFile.positionAt(context.replacementEndOffset),
  };

  const resolveSpec = attributeSpecResolver(context, source);

  return names.map((name) => {
    const spec = resolveSpec(name);
    const newText = attributeNameEditText({
      name,
      spec,
      hasArgumentList: context.hasArgumentList,
      clientSupportsSnippets,
    });
    return {
      label: name,
      kind: CompletionItemKind.Function,
      detail: spec?.documentation || 'PSL attribute',
      sortText: name,
      filterText: name,
      textEdit: { range: replacementRange, newText },
      ...(newText !== name ? { insertTextFormat: InsertTextFormat.Snippet } : {}),
      ...(newText !== name && clientSupportsTriggerParameterHintsCommand
        ? {
            command: {
              title: 'Show argument hints',
              command: 'editor.action.triggerParameterHints',
            },
          }
        : {}),
    };
  });
}

function attributeNames(
  context: AttributeNameCompletionContext,
  source: PslCompletionCandidateSource,
): readonly string[] {
  switch (context.kind) {
    case 'blockAttributeName': {
      const descriptor = findBlockDescriptor(source.pslBlockDescriptors, context.blockKeyword);
      return sortedUnique(Object.keys(descriptor?.attributes ?? {}));
    }
    case 'fieldAttributeName': {
      if (source.authoringContributions === undefined) {
        return [];
      }
      return sortedUnique(Object.keys(assembleAttributeSpecs(source.authoringContributions).field));
    }
    case 'modelAttributeName': {
      if (source.authoringContributions === undefined) {
        return [];
      }
      return sortedUnique(Object.keys(assembleAttributeSpecs(source.authoringContributions).model));
    }
  }
}

function attributeNameEditText(input: {
  readonly name: string;
  readonly spec: AttributeSpec<never, never> | undefined;
  readonly hasArgumentList: boolean;
  readonly clientSupportsSnippets: boolean;
}): string {
  if (!input.clientSupportsSnippets || input.spec === undefined || input.hasArgumentList) {
    return input.name;
  }

  const required = requiredArgumentsSnippet(input.spec);
  return required.length === 0 ? input.name : `${input.name}(${required})`;
}

function provideDeclarationKeywordCompletionItems(
  context: DeclarationKeywordCompletionContext,
  sourceFile: SourceFile,
  source: PslCompletionCandidateSource,
  clientSupportsSnippets: boolean,
): readonly CompletionItem[] {
  const replacementRange = {
    start: sourceFile.positionAt(context.replacementStartOffset),
    end: sourceFile.positionAt(context.offset),
  };

  return declarationKeywordCandidates(context.scope, source).map((candidate) => ({
    label: candidate.label,
    kind: candidate.kind,
    detail: candidate.detail,
    sortText: declarationKeywordSortText(candidate),
    filterText: candidate.label,
    ...(clientSupportsSnippets ? { insertTextFormat: InsertTextFormat.Snippet } : {}),
    textEdit: {
      range: replacementRange,
      newText: clientSupportsSnippets ? candidate.snippetText : candidate.insertText,
    },
  }));
}

function declarationKeywordCandidates(
  scope: DeclarationKeywordCompletionContext['scope'],
  source: PslCompletionCandidateSource,
): readonly DeclarationKeywordCompletionCandidate[] {
  const nativeCandidates =
    scope === 'namespace' ? namespaceNativeDeclarationKeywords : documentNativeDeclarationKeywords;
  return [
    ...nativeCandidates,
    ...genericBlockDeclarationKeywordCandidates(source.pslBlockDescriptors, source.symbolTable),
  ];
}

function nativeDeclarationKeyword(
  label: string,
  insertText: string,
  snippetText: string,
  documentation: string,
): DeclarationKeywordCompletionCandidate {
  return {
    category: 'native',
    label,
    insertText,
    snippetText,
    detail: documentation,
    kind: CompletionItemKind.Keyword,
  };
}

function genericBlockDeclarationKeywordCandidates(
  descriptors: AuthoringPslBlockDescriptorNamespace,
  symbols: SymbolTable,
): readonly DeclarationKeywordCompletionCandidate[] {
  return descriptorBlockKeywords(descriptors).map((keyword) => {
    const descriptor = findBlockDescriptor(descriptors, keyword);
    return {
      category: 'genericBlock',
      label: keyword,
      insertText: `${keyword} `,
      snippetText: genericBlockSnippet(
        keyword,
        descriptor === undefined ? undefined : blockSpecFactoryOf(descriptor)({ symbols }),
      ),
      detail: descriptor?.documentation || 'Generic block keyword',
      kind: CompletionItemKind.Keyword,
    };
  });
}

function genericBlockSnippet(keyword: string, spec: BlockSpec | undefined): string {
  const required =
    spec?.mode === 'struct'
      ? Object.entries(spec.parameters).filter(([, parameter]) => !isOptionalType(parameter.type))
      : [];
  const lines = required.map(([name, parameter], index) => {
    const placeholder = `\${${index + 2}:${name}}`;
    return `  ${name} = ${parameter.type.kind === 'list' ? `[${placeholder}]` : placeholder}`;
  });
  const cursor = lines.length === 0 ? '$' + '{0:// Block keys and attributes}' : '$0';
  return [`${keyword} ${nameSnippetPlaceholder} {`, ...lines, `  ${cursor}`, '}'].join('\n');
}

function isOptionalType(type: ArgType<unknown, never>): boolean {
  return 'optional' in type && type.optional === true;
}

function descriptorBlockKeywords(
  descriptors: AuthoringPslBlockDescriptorNamespace,
): readonly string[] {
  const keywords: string[] = [];
  collectDescriptorBlockKeywords(descriptors, keywords);
  return sortedUnique(keywords);
}

function collectDescriptorBlockKeywords(
  descriptors: AuthoringPslBlockDescriptorNamespace,
  keywords: string[],
): void {
  for (const value of Object.values(descriptors)) {
    if (isAuthoringPslBlockDescriptor(value)) {
      keywords.push(value.keyword);
      continue;
    }
    collectDescriptorBlockKeywords(value, keywords);
  }
}

function declarationKeywordSortText(candidate: DeclarationKeywordCompletionCandidate): string {
  return `${declarationKeywordCategoryOrder[candidate.category]}:${candidate.label}`;
}

function provideGenericBlockKeyCompletionItems(
  context: GenericBlockKeyCompletionContext,
  sourceFile: SourceFile,
  source: PslCompletionCandidateSource,
  capabilities: ScopeCompletionCapabilities,
): readonly CompletionItem[] {
  const descriptor = findBlockDescriptor(source.pslBlockDescriptors, context.blockKeyword);
  if (descriptor === undefined) {
    return [];
  }
  const spec = blockSpecFactoryOf(descriptor)({ symbols: source.symbolTable });
  if (spec.mode !== 'struct') {
    return [];
  }

  const existing = existingGenericBlockParameterNames(context.block, context.offset);
  const hasEquals = editedKeyHasEquals(context.block, context.offset);
  const replacementRange = {
    start: sourceFile.positionAt(context.replacementStartOffset),
    end: sourceFile.positionAt(context.offset),
  };

  return Object.entries(spec.parameters)
    .filter(([parameterName]) => !existing.has(parameterName))
    .map(([parameterName, parameter], index) => {
      const snippet =
        !hasEquals && capabilities.clientSupportsSnippets && parameter.type.kind === 'list';
      const newText = hasEquals
        ? parameterName
        : snippet
          ? `${parameterName} = [$1]`
          : `${parameterName} = `;
      return {
        label: parameterName,
        kind: CompletionItemKind.Property,
        detail: parameter.documentation || 'Generic block parameter',
        sortText: genericBlockParameterSortText(index, parameterName),
        filterText: parameterName,
        textEdit: { range: replacementRange, newText },
        ...(snippet ? { insertTextFormat: InsertTextFormat.Snippet } : {}),
        ...(!hasEquals && capabilities.clientSupportsTriggerSuggestCommand === true
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

function editedKeyHasEquals(block: GenericBlockDeclarationAst, cursorOffset: number): boolean {
  for (const entry of block.entries()) {
    if (!entry.syntax.isOutside(cursorOffset)) return entry.equals() !== undefined;
  }
  return false;
}

function existingGenericBlockParameterNames(
  block: GenericBlockDeclarationAst,
  cursorOffset: number,
): Set<string> {
  const names = new Set<string>();
  for (const entry of block.entries()) {
    if (!entry.syntax.isOutside(cursorOffset)) {
      continue;
    }
    const name = entry.key()?.name();
    if (name !== undefined) {
      names.add(name);
    }
  }
  return names;
}

function provideModelTypeCompletionItems(
  context: ModelTypeCompletionContext,
  sourceFile: SourceFile,
  source: PslCompletionCandidateSource,
  capabilities: ScopeCompletionCapabilities,
): readonly CompletionItem[] {
  return scopeCompletionItems(
    source.binder.scopeAt(context.field.syntax).entries(),
    source.binder,
    {
      start: sourceFile.positionAt(context.replacementStartOffset),
      end: sourceFile.positionAt(context.offset),
    },
    capabilities,
  );
}

function provideNamespaceMemberCompletionItems(
  context: NamespaceMemberCompletionContext,
  sourceFile: SourceFile,
  source: PslCompletionCandidateSource,
  capabilities: ScopeCompletionCapabilities,
): readonly CompletionItem[] {
  // A foreign contract-space reference resolves against external symbols that no
  // registry exposes yet; local namespace members must not stand in for them.
  if (context.space !== undefined) {
    return [];
  }
  const qualifier = source.binder.scopeAt(context.field.syntax).lookup(context.namespace);
  return scopeCompletionItems(
    qualifier !== undefined && isNamespaceLike(qualifier) ? memberEntries(qualifier) : [],
    source.binder,
    {
      start: sourceFile.positionAt(context.replacementStartOffset),
      end: sourceFile.positionAt(context.offset),
    },
    capabilities,
  );
}

function sortedUnique(names: readonly string[]): readonly string[] {
  return [...new Set(names)].sort(compareNames);
}

function genericBlockParameterSortText(index: number, label: string): string {
  return `${index.toString().padStart(4, '0')}:${label}`;
}

function compareNames(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
