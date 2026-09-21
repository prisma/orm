import type { FieldAttributeCtx, ModelAttributeCtx } from './attribute-spec/types';
import { type Binder, typeReferenceNode } from './binder';
import type { PslSources } from './source-file';
import type { FieldSymbol, ModelSymbol } from './symbol-table';

export function referencedModel(binder: Binder, field: FieldSymbol): ModelSymbol | undefined {
  const node = typeReferenceNode(field);
  if (node === undefined) return undefined;
  const resolution = binder.symbolForNode(node);
  return resolution?.kind === 'model' ? resolution.symbol : undefined;
}

export interface AttributeContextInput {
  readonly binder: Binder;
  readonly sources: PslSources;
  readonly model: ModelSymbol;
}

export type ModelAttributeContextInput = AttributeContextInput;

export interface FieldAttributeContextInput extends AttributeContextInput {
  readonly field: FieldSymbol;
}

export function modelAttributeContext(input: ModelAttributeContextInput): ModelAttributeCtx {
  return { sources: input.sources, binder: input.binder, selfModel: input.model };
}

export function fieldAttributeContext(input: FieldAttributeContextInput): FieldAttributeCtx {
  return {
    sources: input.sources,
    binder: input.binder,
    selfModel: input.model,
    field: input.field,
  };
}
