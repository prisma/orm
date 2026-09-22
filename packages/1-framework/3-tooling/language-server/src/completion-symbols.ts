import {
  type AuthoringTypeNamespace,
  isAuthoringTypeConstructorDescriptor,
} from '@internal/framework-components/authoring';
import type { FieldSymbol, ModelSymbol, SymbolTable } from '@internal/psl-parser';
import {
  type FieldDeclarationAst,
  type ModelDeclarationAst,
  NamespaceDeclarationAst,
} from '@internal/psl-parser/syntax';
import type { AttributeArgumentCompletionContext } from './completion-context';
import { refinesScalarType } from './named-type-classification';

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
  scalarTypes: readonly string[],
  typeConstructors: AuthoringTypeNamespace = {},
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
      return scalarFieldNames(
        symbols,
        modelSymbolForNode(symbols, context.model),
        scalarTypes,
        typeConstructors,
      );
  }
}

export function referencedFieldNames(
  context: AttributeArgumentCompletionContext,
  symbols: SymbolTable,
  scalarTypes: readonly string[],
  typeConstructors: AuthoringTypeNamespace = {},
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
      return scalarFieldNames(
        symbols,
        referencedModel(symbols, model, field),
        scalarTypes,
        typeConstructors,
      );
    }
  }
}

function scalarFieldNames(
  symbols: SymbolTable,
  model: ModelSymbol | undefined,
  scalarTypes: readonly string[],
  typeConstructors: AuthoringTypeNamespace,
): readonly string[] {
  if (model === undefined) return [];
  const namespaceName = model.node.syntax
    .findAncestor(NamespaceDeclarationAst.cast)
    ?.name()
    ?.name();
  const namespace =
    namespaceName === undefined ? undefined : symbols.topLevel.namespaces[namespaceName];
  return Object.values(model.fields)
    .filter((field) => {
      if (field.malformedType === true || field.typeContractSpaceId !== undefined) {
        return false;
      }
      if (field.typeConstructor !== undefined) {
        return isScalarConstructor(field.typeConstructor.path, typeConstructors);
      }
      if (field.typeNamespaceId !== undefined) return false;
      const name = field.typeName;
      if (
        namespace?.models[name] !== undefined ||
        namespace?.compositeTypes[name] !== undefined ||
        namespace?.blocks[name] !== undefined ||
        symbols.topLevel.models[name] !== undefined ||
        symbols.topLevel.compositeTypes[name] !== undefined ||
        symbols.topLevel.blocks[name] !== undefined
      ) {
        return false;
      }
      const namedType = symbols.topLevel.namedTypes[name];
      if (namedType === undefined) return scalarTypes.includes(name);
      return namedType.typeConstructor === undefined
        ? refinesScalarType(namedType, scalarTypes)
        : isScalarConstructor(namedType.typeConstructor.path, typeConstructors);
    })
    .map((field) => field.name);
}

function isScalarConstructor(
  path: readonly string[],
  typeConstructors: AuthoringTypeNamespace,
): boolean {
  let current = typeConstructors;
  for (const [index, segment] of path.entries()) {
    const value = Object.hasOwn(current, segment) ? current[segment] : undefined;
    if (value === undefined) return false;
    if (isAuthoringTypeConstructorDescriptor(value)) return index === path.length - 1;
    current = value;
  }
  return false;
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
