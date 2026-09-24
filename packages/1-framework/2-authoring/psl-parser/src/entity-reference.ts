import { InternalError } from '@internal/utils/internal-error';
import type { Binder, Resolution } from './binder';
import { lookupIn, unqualifiedChain } from './scope-chain';
import type {
  BlockSymbol,
  CompositeTypeSymbol,
  ModelSymbol,
  NamedTypeSymbol,
  NamespaceSymbol,
  SymbolTable,
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

export type EntityLookup =
  | { readonly kind: 'entity'; readonly reference: ResolvedEntityReference }
  | { readonly kind: 'unresolved'; readonly voiced: boolean }
  | { readonly kind: 'notAnEntity'; readonly described: string };

const references = new WeakMap<EntityDeclaration, ResolvedEntityReference>();

export function lookupEntityReference(expression: ExpressionAst, binder: Binder): EntityLookup {
  const resolution = binder.symbolForNode(expression.syntax);
  if (resolution === undefined) {
    throw new InternalError(
      'The binder on this attribute context bound nothing for this entity reference. A reference argument is always examined, so the binder must be built over the same snapshot - the same symbol table and sources - as the interpretation consuming it.',
    );
  }
  return classify(resolution, true);
}

export function lookupEntityReferenceInTable(
  expression: ExpressionAst,
  name: string,
  symbols: SymbolTable,
): EntityLookup {
  const namespaceName = expression.syntax
    .findAncestor(NamespaceDeclarationAst.cast)
    ?.name()
    ?.name();
  const namespace =
    namespaceName === undefined ? undefined : symbols.topLevel.namespaces[namespaceName];
  const found = lookupIn(unqualifiedChain(namespace, symbols.topLevel), name);
  if (found === undefined) return { kind: 'unresolved', voiced: false };
  return classify(found, false);
}

function classify(resolution: Resolution, voiced: boolean): EntityLookup {
  switch (resolution.kind) {
    case 'model':
    case 'compositeType':
    case 'namedType':
    case 'block':
      return { kind: 'entity', reference: referenceFor(resolution) };
    case 'unresolved':
      return { kind: 'unresolved', voiced };
    default:
      return { kind: 'notAnEntity', described: describeNonEntity(resolution) };
  }
}

function describeNonEntity(resolution: Resolution): string {
  switch (resolution.kind) {
    case 'namespace':
      return 'namespace';
    case 'contributedType':
      return 'scalar type';
    case 'field':
      return 'field';
    case 'attribute':
      return 'attribute';
    default:
      return 'cross-space reference';
  }
}

function referenceFor(
  resolution: Extract<Resolution, { kind: 'model' | 'compositeType' | 'namedType' | 'block' }>,
): ResolvedEntityReference {
  const declaration = resolution.symbol;
  let reference = references.get(declaration);
  if (reference === undefined) {
    reference = { declaration, namespace: resolution.namespace };
    references.set(declaration, reference);
  }
  return reference;
}
