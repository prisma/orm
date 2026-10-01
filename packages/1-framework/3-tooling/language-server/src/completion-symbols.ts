import {
  type Binder,
  type FieldSymbol,
  type ModelSymbol,
  type NamedTypeSymbol,
  typeReferenceNode,
} from '@internal/psl-parser';
import type { AttributeArgumentCompletionContext } from './completion-context';

export function localFieldNames(
  context: AttributeArgumentCompletionContext,
  binder: Binder,
): readonly string[] {
  if (context.ownerKind === 'block') return [];
  const model = binder.declaredSymbol(context.model.syntax);
  return scalarFieldNames(model?.kind === 'model' ? model : undefined, binder);
}

export function referencedFieldNames(
  context: AttributeArgumentCompletionContext,
  binder: Binder,
): readonly string[] {
  if (context.ownerKind !== 'field') return [];
  const field = binder.declaredSymbol(context.field.syntax);
  if (field?.kind !== 'field') return [];
  const node = typeReferenceNode(field);
  const target = node === undefined ? undefined : binder.symbolForNode(node);
  return scalarFieldNames(target?.kind === 'model' ? target.symbol : undefined, binder);
}

function scalarFieldNames(model: ModelSymbol | undefined, binder: Binder): readonly string[] {
  if (model === undefined) return [];
  return Object.values(model.fields)
    .filter((field) => {
      const node = typeReferenceNode(field);
      const resolution = node === undefined ? undefined : binder.symbolForNode(node);
      return resolution?.kind === 'namedType'
        ? field.node.typeAnnotation()?.isConstructor() !== true &&
            isScalarReference(resolution.symbol, binder)
        : isScalarReference(field, binder);
    })
    .map((field) => field.name);
}

function isScalarReference(symbol: FieldSymbol | NamedTypeSymbol, binder: Binder): boolean {
  const annotation = symbol.node.typeAnnotation();
  const name = annotation?.name();
  return (
    name !== undefined &&
    binder.symbolForNode(name.syntax)?.kind === 'contributedType' &&
    (annotation?.isConstructor() === true || name.namespace() === undefined)
  );
}
