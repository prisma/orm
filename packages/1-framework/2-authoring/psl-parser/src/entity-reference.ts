import type {
  BlockSymbol,
  CompositeTypeSymbol,
  ModelSymbol,
  NamedTypeSymbol,
  NamespaceSymbol,
  SymbolTable,
  TopLevelScope,
} from './symbol-table';
import { NamespaceDeclarationAst } from './syntax/ast/declarations';
import type { ExpressionAst } from './syntax/ast/expressions';

export type EntitySelector =
  | { readonly kind: 'model' }
  | { readonly kind: 'compositeType' }
  | { readonly kind: 'namedType' }
  | { readonly kind: 'block'; readonly keyword: string };

export type EntityDeclaration = ModelSymbol | CompositeTypeSymbol | NamedTypeSymbol | BlockSymbol;

export type DeclarationFor<S extends EntitySelector> = Extract<
  EntityDeclaration,
  { kind: S['kind'] }
>;

export interface ResolvedEntityReference<D extends EntityDeclaration = EntityDeclaration> {
  readonly declaration: D;
  readonly namespace: NamespaceSymbol | undefined;
}

const references = new WeakMap<
  TopLevelScope | NamespaceSymbol,
  WeakMap<EntityDeclaration, ResolvedEntityReference>
>();

export function resolveEntityReference(
  expression: ExpressionAst,
  name: string,
  symbols: SymbolTable,
): ResolvedEntityReference | undefined {
  const namespaceName = expression.syntax
    .findAncestor(NamespaceDeclarationAst.cast)
    ?.name()
    ?.name();
  const namespace =
    namespaceName === undefined ? undefined : ownValue(symbols.topLevel.namespaces, namespaceName);
  if (namespace !== undefined) {
    const declaration = declarationIn(namespace, name);
    if (declaration !== undefined) return referenceFor(namespace, declaration, namespace);
  }
  const declaration = declarationIn(symbols.topLevel, name);
  return declaration === undefined
    ? undefined
    : referenceFor(symbols.topLevel, declaration, undefined);
}

function ownValue<T>(values: Readonly<Record<string, T>>, name: string): T | undefined {
  return Object.hasOwn(values, name) ? values[name] : undefined;
}

function declarationIn(
  scope: TopLevelScope | NamespaceSymbol,
  name: string,
): EntityDeclaration | undefined {
  return (
    ownValue(scope.models, name) ??
    ownValue(scope.compositeTypes, name) ??
    ownValue(scope.blocks, name) ??
    ('namedTypes' in scope ? ownValue(scope.namedTypes, name) : undefined)
  );
}

function referenceFor(
  scope: TopLevelScope | NamespaceSymbol,
  declaration: EntityDeclaration,
  namespace: NamespaceSymbol | undefined,
): ResolvedEntityReference {
  let byDeclaration = references.get(scope);
  if (byDeclaration === undefined) {
    byDeclaration = new WeakMap();
    references.set(scope, byDeclaration);
  }
  let reference = byDeclaration.get(declaration);
  if (reference === undefined) {
    reference = { declaration, namespace };
    byDeclaration.set(declaration, reference);
  }
  return reference;
}
