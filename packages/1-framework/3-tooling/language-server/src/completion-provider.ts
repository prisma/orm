import {
  type AuthoringPslBlockDescriptor,
  type AuthoringPslBlockDescriptorNamespace,
  isAuthoringPslBlockDescriptor,
  isAuthoringTypeConstructorDescriptor,
} from '@internal/framework-components/authoring';
import {
  type AttributeSpec,
  assembleAttributeSpecs,
  findBlockDescriptor,
  type NamespaceSymbol,
  type SymbolTable,
} from '@internal/psl-parser';
import type { GenericBlockDeclarationAst, SourceFile } from '@internal/psl-parser/syntax';
import { type CompletionItem, CompletionItemKind, InsertTextFormat } from 'vscode-languageserver';
import { type AttributeSpecSource, attributeSpecResolver } from './attribute-spec-resolution';
import type {
  AttributeNameCompletionContext,
  DeclarationKeywordCompletionContext,
  GenericBlockKeyCompletionContext,
  ModelTypeCompletionContext,
  NamespaceMemberCompletionContext,
  PslCompletionContext,
} from './completion-context';
import { requiredArgumentsSnippet } from './completion-snippets';
import { localFieldNames, referencedFieldNames } from './completion-symbols';
import {
  provideAttributeArgumentSlotCompletionItems,
  provideAttributeNamedKeyCompletionItems,
  provideAttributeValueCompletionItems,
} from './completion-values';
import { refinesScalarType } from './named-type-classification';

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

type ModelTypeCompletionCandidateCategory =
  | 'configuredScalar'
  | 'topLevelModel'
  | 'topLevelCompositeType'
  | 'scalar'
  | 'typeAlias'
  | 'namespace'
  | 'namespaceModel'
  | 'namespaceCompositeType';

interface DeclarationKeywordCompletionCandidate {
  readonly category: DeclarationKeywordCompletionCandidateCategory;
  readonly label: string;
  readonly insertText: string;
  readonly snippetText: string;
  readonly detail: string;
  readonly kind: CompletionItemKind;
}

interface ModelTypeCompletionCandidate {
  readonly category: ModelTypeCompletionCandidateCategory;
  readonly label: string;
  readonly insertText: string;
  readonly filterText: string;
  readonly detail: string;
  readonly kind: CompletionItemKind;
}

const categoryOrder: Record<ModelTypeCompletionCandidateCategory, number> = {
  configuredScalar: 0,
  topLevelModel: 1,
  topLevelCompositeType: 2,
  scalar: 3,
  typeAlias: 4,
  namespace: 5,
  namespaceModel: 6,
  namespaceCompositeType: 7,
};

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
    // Parameter-value completion (option allowed-values / ref scopes) is future
    // work.
    case 'genericBlockValue':
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
    case 'blockAttributeNamedKey': {
      const spec = attributeSpecResolver(context, input.candidates)(context.attributeName);
      return spec === undefined
        ? []
        : provideAttributeNamedKeyCompletionItems(
            {
              context,
              sourceFile: input.sourceFile,
              clientSupportsSnippets: input.clientSupportsSnippets,
              clientSupportsTriggerSuggestCommand:
                input.clientSupportsTriggerSuggestCommand === true,
            },
            spec,
          );
    }
    case 'fieldAttributeArgumentSlot':
    case 'modelAttributeArgumentSlot':
    case 'blockAttributeArgumentSlot': {
      const spec = attributeSpecResolver(context, input.candidates)(context.attributeName);
      return spec === undefined
        ? []
        : provideAttributeArgumentSlotCompletionItems(
            {
              context,
              sourceFile: input.sourceFile,
              clientSupportsSnippets: input.clientSupportsSnippets,
              clientSupportsTriggerSuggestCommand:
                input.clientSupportsTriggerSuggestCommand === true,
              clientSupportsTriggerParameterHintsCommand:
                input.clientSupportsTriggerParameterHintsCommand === true,
              fieldNames: (kind) =>
                kind === 'fieldRef'
                  ? localFieldNames(
                      context,
                      input.candidates.symbolTable,
                      input.candidates.scalarTypes,
                      input.candidates.authoringContributions?.type,
                    )
                  : referencedFieldNames(
                      context,
                      input.candidates.symbolTable,
                      input.candidates.scalarTypes,
                      input.candidates.authoringContributions?.type,
                    ),
            },
            spec,
          );
    }
    case 'fieldAttributeValue':
    case 'modelAttributeValue':
    case 'blockAttributeValue': {
      const spec = attributeSpecResolver(context, input.candidates)(context.attributeName);
      return spec === undefined
        ? []
        : provideAttributeValueCompletionItems(
            {
              context,
              sourceFile: input.sourceFile,
              clientSupportsSnippets: input.clientSupportsSnippets,
              clientSupportsTriggerParameterHintsCommand:
                input.clientSupportsTriggerParameterHintsCommand === true,
              fieldNames: (kind) =>
                kind === 'fieldRef'
                  ? localFieldNames(
                      context,
                      input.candidates.symbolTable,
                      input.candidates.scalarTypes,
                      input.candidates.authoringContributions?.type,
                    )
                  : referencedFieldNames(
                      context,
                      input.candidates.symbolTable,
                      input.candidates.scalarTypes,
                      input.candidates.authoringContributions?.type,
                    ),
            },
            spec,
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
      return provideGenericBlockKeyCompletionItems(context, input.sourceFile, input.candidates);
    case 'modelType':
      return provideModelTypeCompletionItems(context, input.sourceFile, input.candidates);
    case 'namespaceMember':
      return provideNamespaceMemberCompletionItems(context, input.sourceFile, input.candidates);
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
    ...genericBlockDeclarationKeywordCandidates(source.pslBlockDescriptors),
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
): readonly DeclarationKeywordCompletionCandidate[] {
  return descriptorBlockKeywords(descriptors).map((keyword) => {
    const descriptor = findBlockDescriptor(descriptors, keyword);
    return {
      category: 'genericBlock',
      label: keyword,
      insertText: `${keyword} `,
      snippetText: genericBlockSnippet(keyword, descriptor),
      detail: descriptor?.documentation || 'Generic block keyword',
      kind: CompletionItemKind.Keyword,
    };
  });
}

function genericBlockSnippet(
  keyword: string,
  descriptor: AuthoringPslBlockDescriptor | undefined,
): string {
  const parameters = Object.entries(descriptor?.parameters ?? {})
    .filter(([, parameter]) => parameter.required === true)
    .map(([name, parameter], index) => {
      const placeholder = `\${${index + 2}:${name}}`;
      const value = parameter.kind === 'list' ? `[${placeholder}]` : placeholder;
      return `  ${name} = ${value}`;
    });
  const cursor = parameters.length === 0 ? '$' + '{0:// Block parameters and attributes}' : '$0';
  return [`${keyword} ${nameSnippetPlaceholder} {`, ...parameters, `  ${cursor}`, '}'].join('\n');
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
): readonly CompletionItem[] {
  const descriptor = findBlockDescriptor(source.pslBlockDescriptors, context.blockKeyword);
  if (descriptor === undefined) {
    return [];
  }

  const existing = existingGenericBlockParameterNames(context.block, context.offset);
  const replacementRange = {
    start: sourceFile.positionAt(context.replacementStartOffset),
    end: sourceFile.positionAt(context.offset),
  };

  return Object.keys(descriptor.parameters)
    .filter((parameterName) => !existing.has(parameterName))
    .map((parameterName, index) => ({
      label: parameterName,
      kind: CompletionItemKind.Property,
      detail: descriptor.parameters[parameterName]?.documentation || 'Generic block parameter',
      sortText: genericBlockParameterSortText(index, parameterName),
      filterText: parameterName,
      textEdit: {
        range: replacementRange,
        newText: parameterName,
      },
    }));
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
): readonly CompletionItem[] {
  return modelTypeCompletionItems(context, sourceFile, [
    ...configuredScalarCandidates(source),
    ...topLevelSymbolCandidates(source.symbolTable, source.scalarTypes),
    ...allNamespaceCandidates(source.symbolTable),
  ]);
}

function provideNamespaceMemberCompletionItems(
  context: NamespaceMemberCompletionContext,
  sourceFile: SourceFile,
  source: PslCompletionCandidateSource,
): readonly CompletionItem[] {
  // A foreign contract-space reference resolves against external symbols that no
  // registry exposes yet; local namespace members must not stand in for them.
  if (context.space !== undefined) {
    return [];
  }
  return modelTypeCompletionItems(
    context,
    sourceFile,
    namespaceCandidates(source.symbolTable.topLevel.namespaces[context.namespace]),
  );
}

function modelTypeCompletionItems(
  context: ModelTypeCompletionContext | NamespaceMemberCompletionContext,
  sourceFile: SourceFile,
  candidates: readonly ModelTypeCompletionCandidate[],
): readonly CompletionItem[] {
  const replacementRange = {
    start: sourceFile.positionAt(context.replacementStartOffset),
    end: sourceFile.positionAt(context.offset),
  };

  return candidates.map((candidate) => ({
    label: candidate.label,
    kind: candidate.kind,
    detail: candidate.detail,
    sortText: sortText(candidate),
    filterText: candidate.filterText,
    textEdit: {
      range: replacementRange,
      newText: candidate.insertText,
    },
  }));
}

function configuredScalarCandidates(
  source: PslCompletionCandidateSource,
): readonly ModelTypeCompletionCandidate[] {
  const constructors = source.authoringContributions?.type ?? {};
  return sortedUnique(source.scalarTypes).map((name) => ({
    category: 'configuredScalar',
    label: name,
    insertText: name,
    filterText: name,
    detail:
      constructors[name] !== undefined && isAuthoringTypeConstructorDescriptor(constructors[name])
        ? constructors[name].documentation || 'Configured scalar type'
        : 'Configured scalar type',
    kind: CompletionItemKind.Keyword,
  }));
}

function topLevelSymbolCandidates(
  symbolTable: SymbolTable,
  scalarTypes: readonly string[],
): readonly ModelTypeCompletionCandidate[] {
  const { topLevel } = symbolTable;
  const namedTypes = Object.values(topLevel.namedTypes);
  const scalarRefinementNames = namedTypes
    .filter((symbol) => refinesScalarType(symbol, scalarTypes))
    .map((symbol) => symbol.name)
    .sort(compareNames);
  const aliasNames = namedTypes
    .filter((symbol) => !refinesScalarType(symbol, scalarTypes))
    .map((symbol) => symbol.name)
    .sort(compareNames);
  return [
    ...symbolCandidates(
      recordNames(topLevel.models),
      'topLevelModel',
      'Model',
      CompletionItemKind.Class,
    ),
    ...symbolCandidates(
      recordNames(topLevel.compositeTypes),
      'topLevelCompositeType',
      'Composite type',
      CompletionItemKind.Struct,
    ),
    ...symbolCandidates(scalarRefinementNames, 'scalar', 'Scalar type', CompletionItemKind.Unit),
    ...symbolCandidates(aliasNames, 'typeAlias', 'Type alias', CompletionItemKind.Reference),
  ];
}

function allNamespaceCandidates(symbolTable: SymbolTable): readonly ModelTypeCompletionCandidate[] {
  return Object.values(symbolTable.topLevel.namespaces)
    .sort((left, right) => compareNames(left.name, right.name))
    .map(namespaceQualifierCandidate);
}

function namespaceCandidates(
  namespace: NamespaceSymbol | undefined,
): readonly ModelTypeCompletionCandidate[] {
  if (namespace === undefined) {
    return [];
  }
  return [
    ...symbolCandidates(
      recordNames(namespace.models),
      'namespaceModel',
      `Model in namespace ${namespace.name}`,
      CompletionItemKind.Class,
    ),
    ...symbolCandidates(
      recordNames(namespace.compositeTypes),
      'namespaceCompositeType',
      `Composite type in namespace ${namespace.name}`,
      CompletionItemKind.Struct,
    ),
  ];
}

function namespaceQualifierCandidate(namespace: NamespaceSymbol): ModelTypeCompletionCandidate {
  return {
    category: 'namespace',
    label: namespace.name,
    insertText: namespace.name,
    filterText: namespace.name,
    detail: 'Namespace',
    kind: CompletionItemKind.Module,
  };
}

function symbolCandidates(
  names: readonly string[],
  category: ModelTypeCompletionCandidateCategory,
  detail: string,
  kind: CompletionItemKind,
): readonly ModelTypeCompletionCandidate[] {
  return names.map((name) => ({
    category,
    label: name,
    insertText: name,
    filterText: name,
    detail,
    kind,
  }));
}

function recordNames<T extends { readonly name: string }>(
  record: Record<string, T>,
): readonly string[] {
  return Object.values(record)
    .map((symbol) => symbol.name)
    .sort(compareNames);
}

function sortedUnique(names: readonly string[]): readonly string[] {
  return [...new Set(names)].sort(compareNames);
}

function sortText(candidate: ModelTypeCompletionCandidate): string {
  return `${categoryOrder[candidate.category]}:${candidate.label}`;
}

function genericBlockParameterSortText(index: number, label: string): string {
  return `${index.toString().padStart(4, '0')}:${label}`;
}

function compareNames(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
