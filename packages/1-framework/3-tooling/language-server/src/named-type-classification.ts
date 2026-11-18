import { type Binder, type NamedTypeSymbol, typeReferenceNode } from '@internal/psl-parser';

export function refinesScalarType(symbol: NamedTypeSymbol, binder: Binder): boolean {
  const node = typeReferenceNode(symbol);
  return (
    !symbol.isConstructor &&
    symbol.node.typeAnnotation()?.name()?.namespace() === undefined &&
    node !== undefined &&
    binder.symbolForNode(node)?.kind === 'contributedType'
  );
}
