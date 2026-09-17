import type {
  BlockSymbol,
  CompositeTypeSymbol,
  ModelSymbol,
  NamedTypeSymbol,
  NamespaceSymbol,
  SymbolTable,
  TopLevelScope,
} from './symbol-table';

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

export type EntityResolver = (name: string) => ResolvedEntityReference | undefined;

export function createEntityResolver(input: {
  readonly symbols: SymbolTable;
  readonly owner: ModelSymbol | CompositeTypeSymbol | BlockSymbol;
}): EntityResolver {
  const { symbols, owner } = input;
  const namespace = Object.values(symbols.topLevel.namespaces).find((scope) =>
    declarationsIn(scope).some((declaration) => declaration === owner),
  );
  const references = new Map<string, ResolvedEntityReference>();
  for (const declaration of declarationsIn(symbols.topLevel)) {
    references.set(declaration.name, { declaration, namespace: undefined });
  }
  if (namespace !== undefined) {
    for (const declaration of declarationsIn(namespace)) {
      references.set(declaration.name, { declaration, namespace });
    }
  }
  return (name) => references.get(name);
}

function declarationsIn(scope: TopLevelScope | NamespaceSymbol): EntityDeclaration[] {
  return [
    ...Object.values(scope.models),
    ...Object.values(scope.compositeTypes),
    ...Object.values(scope.blocks),
    ...('namedTypes' in scope ? Object.values(scope.namedTypes) : []),
  ];
}
