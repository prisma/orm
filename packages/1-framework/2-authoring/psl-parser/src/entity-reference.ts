import type { Resolution } from './binder';
import type {
  BlockSymbol,
  CompositeTypeSymbol,
  ModelSymbol,
  NamedTypeSymbol,
  NamespaceSymbol,
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

const references = new WeakMap<EntityDeclaration, ResolvedEntityReference>();

export function entityReference(resolution: Resolution): ResolvedEntityReference | undefined {
  switch (resolution.kind) {
    case 'model':
    case 'compositeType':
    case 'namedType':
    case 'block':
      return interned(resolution.symbol, resolution.namespace);
    default:
      return undefined;
  }
}

function interned(
  declaration: EntityDeclaration,
  namespace: NamespaceSymbol | undefined,
): ResolvedEntityReference {
  const existing = references.get(declaration);
  if (existing !== undefined) return existing;
  const reference: ResolvedEntityReference = { declaration, namespace };
  references.set(declaration, reference);
  return reference;
}

export function matchesSelector<S extends EntitySelector>(
  reference: ResolvedEntityReference,
  expected: S,
): reference is ResolvedEntityReference<DeclarationFor<S>> {
  const declaration = reference.declaration;
  if (declaration.kind !== expected.kind) return false;
  return (
    expected.kind !== 'block' ||
    (declaration.kind === 'block' && declaration.keyword === expected.keyword)
  );
}

export function describeResolution(resolution: Resolution): string {
  switch (resolution.kind) {
    case 'block':
      return resolution.symbol.keyword;
    case 'contributedType':
      return 'scalar type';
    case 'crossSpace':
      return 'cross-space reference';
    case 'unresolved':
      return 'unresolved name';
    default:
      return resolution.kind;
  }
}
