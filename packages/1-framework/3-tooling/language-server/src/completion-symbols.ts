import type { FieldSymbol, ModelSymbol, SymbolTable } from '@internal/psl-parser';
import {
  type FieldDeclarationAst,
  type ModelDeclarationAst,
  NamespaceDeclarationAst,
} from '@internal/psl-parser/syntax';
import type { AttributeArgumentCompletionContext } from './completion-context';

export function modelSymbolForNode(
  symbolTable: SymbolTable,
  node: ModelDeclarationAst,
): ModelSymbol | undefined {
  const topLevelMatch = Object.values(symbolTable.topLevel.models).find((model) =>
    sameSyntax(model.node.syntax, node.syntax),
  );
  if (topLevelMatch !== undefined) return topLevelMatch;
  for (const namespace of Object.values(symbolTable.topLevel.namespaces)) {
    const namespaceMatch = Object.values(namespace.models).find((model) =>
      sameSyntax(model.node.syntax, node.syntax),
    );
    if (namespaceMatch !== undefined) return namespaceMatch;
  }
  return undefined;
}

export function fieldSymbolForNode(
  model: ModelSymbol,
  node: FieldDeclarationAst,
): FieldSymbol | undefined {
  return Object.values(model.fields).find((field) => sameSyntax(field.node.syntax, node.syntax));
}

export function localFieldNames(
  context: AttributeArgumentCompletionContext,
  symbols: SymbolTable,
): readonly string[] {
  switch (context.kind) {
    case 'blockAttributeNamedKey':
    case 'blockAttributeArgumentSlot':
    case 'blockAttributeValue':
      return [];
    case 'fieldAttributeNamedKey':
    case 'fieldAttributeArgumentSlot':
    case 'fieldAttributeValue':
    case 'modelAttributeNamedKey':
    case 'modelAttributeArgumentSlot':
    case 'modelAttributeValue':
      return Object.keys(modelSymbolForNode(symbols, context.model)?.fields ?? {});
  }
}

export function referencedFieldNames(
  context: AttributeArgumentCompletionContext,
  symbols: SymbolTable,
): readonly string[] {
  switch (context.kind) {
    case 'blockAttributeNamedKey':
    case 'blockAttributeArgumentSlot':
    case 'blockAttributeValue':
    case 'modelAttributeNamedKey':
    case 'modelAttributeArgumentSlot':
    case 'modelAttributeValue':
      return [];
    case 'fieldAttributeNamedKey':
    case 'fieldAttributeArgumentSlot':
    case 'fieldAttributeValue': {
      const model = modelSymbolForNode(symbols, context.model);
      if (model === undefined) return [];
      const field = fieldSymbolForNode(model, context.field);
      if (field === undefined) return [];
      return Object.keys(referencedModel(symbols, model, field)?.fields ?? {});
    }
  }
}

function referencedModel(
  symbols: SymbolTable,
  model: ModelSymbol,
  field: FieldSymbol,
): ModelSymbol | undefined {
  if (field.malformedType === true || field.typeContractSpaceId !== undefined) return undefined;
  if (field.typeNamespaceId !== undefined) {
    return symbols.topLevel.namespaces[field.typeNamespaceId]?.models[field.typeName];
  }
  const namespace = model.node.syntax.findAncestor(NamespaceDeclarationAst.cast)?.name()?.name();
  const local =
    namespace === undefined
      ? undefined
      : symbols.topLevel.namespaces[namespace]?.models[field.typeName];
  return local ?? symbols.topLevel.models[field.typeName];
}

function sameSyntax(
  left: { readonly offset: number; readonly endOffset: number },
  right: { readonly offset: number; readonly endOffset: number },
): boolean {
  return left.offset === right.offset && left.endOffset === right.endOffset;
}
