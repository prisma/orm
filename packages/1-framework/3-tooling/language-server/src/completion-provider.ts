import {
  type AuthoringPslBlockDescriptorNamespace,
  isAuthoringPslBlockDescriptor,
} from '@internal/framework-components/authoring';
import {
  type AttributeSpec,
  assembleAttributeSpecs,
  blockSpecFactoryOf,
  findBlockDescriptor,
  isNamespaceLike,
  memberEntries,
  type ScopeResolution,
} from '@internal/psl-parser';
import type { GenericBlockDeclarationAst, SourceFile } from '@internal/psl-parser/syntax';
import {
  type CompletionItem,
  CompletionItemKind,
  CompletionItemTag,
  InsertTextFormat,
} from 'vscode-languageserver';
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
  | 'namespaceCompositeType'
  | 'deprecatedScalar';

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
  readonly deprecated?: boolean;
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
  deprecatedScalar: 8,
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
                  ? localFieldNames(context, input.candidates.binder)
                  : referencedFieldNames(context, input.candidates.binder),
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
                  ? localFieldNames(context, input.candidates.binder)
                  : referencedFieldNames(context, input.candidates.binder),
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
      snippetText: genericBlockSnippet(keyword),
      detail: descriptor?.documentation || 'Generic block keyword',
      kind: CompletionItemKind.Keyword,
    };
  });
}

function genericBlockSnippet(keyword: string): string {
  const cursor = '$' + '{0:// Block keys and attributes}';
  return [`${keyword} ${nameSnippetPlaceholder} {`, `  ${cursor}`, '}'].join('\n');
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
  const block = source.binder.declaredSymbol(context.block.syntax);
  if (block?.kind !== 'block') {
    return [];
  }
  const spec = blockSpecFactoryOf(descriptor)({ symbols: source.symbolTable, block });
  if (spec.mode !== 'struct') {
    return [];
  }

  const existing = existingGenericBlockParameterNames(context.block, context.offset);
  const replacementRange = {
    start: sourceFile.positionAt(context.replacementStartOffset),
    end: sourceFile.positionAt(context.offset),
  };

  return Object.entries(spec.parameters)
    .filter(([parameterName]) => !existing.has(parameterName))
    .map(([parameterName, parameter], index) => ({
      label: parameterName,
      kind: CompletionItemKind.Property,
      detail: parameter.documentation || 'Generic block parameter',
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
  return modelTypeCompletionItems(
    context,
    sourceFile,
    typeCandidates(source.binder.scopeAt(context.field.syntax).entries(), source),
  );
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
  const qualifier = source.binder.scopeAt(context.field.syntax).lookup(context.namespace);
  return modelTypeCompletionItems(
    context,
    sourceFile,
    qualifier !== undefined && isNamespaceLike(qualifier)
      ? typeCandidates(memberEntries(qualifier), source)
      : [],
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
    ...(candidate.deprecated === true ? { tags: [CompletionItemTag.Deprecated] } : {}),
  }));
}

function typeCandidates(
  entries: Iterable<readonly [string, ScopeResolution]>,
  source: PslCompletionCandidateSource,
): readonly ModelTypeCompletionCandidate[] {
  const candidates: ModelTypeCompletionCandidate[] = [];
  for (const [name, resolution] of entries) {
    const base = { label: name, insertText: name, filterText: name };
    switch (resolution.kind) {
      case 'model':
      case 'compositeType': {
        const model = resolution.kind === 'model';
        const detail = model ? 'Model' : 'Composite type';
        candidates.push({
          ...base,
          category:
            resolution.namespace === undefined
              ? model
                ? 'topLevelModel'
                : 'topLevelCompositeType'
              : model
                ? 'namespaceModel'
                : 'namespaceCompositeType',
          detail:
            resolution.namespace === undefined
              ? detail
              : `${detail} in namespace ${resolution.namespace.name}`,
          kind: model ? CompletionItemKind.Class : CompletionItemKind.Struct,
        });
        break;
      }
      case 'namedType': {
        const scalar = refinesScalarType(resolution.symbol, source.binder);
        candidates.push({
          ...base,
          category: scalar ? 'scalar' : 'typeAlias',
          detail: scalar ? 'Scalar type' : 'Type alias',
          kind: scalar ? CompletionItemKind.Unit : CompletionItemKind.Reference,
        });
        break;
      }
      case 'namespace':
      case 'contributedNamespace':
        candidates.push({
          ...base,
          category: 'namespace',
          detail: 'Namespace',
          kind: CompletionItemKind.Module,
        });
        break;
      case 'contributedType': {
        const descriptor = resolution.symbol.descriptor;
        candidates.push({
          ...base,
          category: descriptor.deprecated === undefined ? 'configuredScalar' : 'deprecatedScalar',
          detail:
            descriptor.deprecated === undefined
              ? descriptor.documentation || 'Configured scalar type'
              : `Deprecated: use ${descriptor.deprecated.replacement}.`,
          kind: CompletionItemKind.Keyword,
          ...(descriptor.deprecated === undefined ? {} : { deprecated: true }),
        });
        break;
      }
      case 'block':
        break;
    }
  }
  return candidates.sort((left, right) => compareNames(sortText(left), sortText(right)));
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
