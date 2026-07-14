import type { ContractSourceDiagnostic } from '@prisma-next/config/config-types';
import type {
  AttributeSpec,
  FieldSymbol,
  InterpretCtx,
  ModelSymbol,
} from '@prisma-next/psl-parser';
import { fieldAttribute, interpretAttribute, modelAttribute, str } from '@prisma-next/psl-parser';
import type {
  FieldAttributeAst,
  ModelAttributeAst,
  SourceFile,
} from '@prisma-next/psl-parser/syntax';

export function findModelAttributeNode(
  model: ModelSymbol,
  name: string,
): ModelAttributeAst | undefined {
  for (const attribute of model.node.attributes()) {
    if (attribute.name()?.isSimpleName(name) === true) return attribute;
  }
  return undefined;
}

export function findFieldAttributeNode(
  field: FieldSymbol,
  name: string,
): FieldAttributeAst | undefined {
  for (const attribute of field.node.attributes()) {
    if (attribute.name()?.isSimpleName(name) === true) return attribute;
  }
  return undefined;
}

function buildModelInterpretCtx(input: {
  readonly selfModel: ModelSymbol;
  readonly sourceFile: SourceFile;
  readonly sourceId: string;
}): InterpretCtx {
  return {
    level: 'model',
    sourceId: input.sourceId,
    sourceFile: input.sourceFile,
    selfModel: input.selfModel,
    resolveReferencedModel: () => undefined,
  };
}

function buildFieldInterpretCtx(input: {
  readonly selfModel: ModelSymbol;
  readonly field: FieldSymbol;
  readonly sourceFile: SourceFile;
  readonly sourceId: string;
  readonly resolveReferencedModel?: (() => ModelSymbol | undefined) | undefined;
}): InterpretCtx {
  return {
    level: 'field',
    sourceId: input.sourceId,
    sourceFile: input.sourceFile,
    selfModel: input.selfModel,
    resolveReferencedModel: input.resolveReferencedModel ?? (() => undefined),
    field: input.field,
  };
}

// Interpret a model-level attribute node against its spec, draining any parse
// failures into `diagnostics`. Returns the typed value, or `undefined` on
// failure so the caller can apply its own default/absence handling.
export function interpretModelAttribute<Out>(input: {
  readonly node: ModelAttributeAst;
  readonly spec: AttributeSpec<Out>;
  readonly model: ModelSymbol;
  readonly sourceFile: SourceFile;
  readonly sourceId: string;
  readonly diagnostics: ContractSourceDiagnostic[];
}): Out | undefined {
  const result = interpretAttribute(
    input.node,
    input.spec,
    buildModelInterpretCtx({
      selfModel: input.model,
      sourceFile: input.sourceFile,
      sourceId: input.sourceId,
    }),
  );
  if (!result.ok) {
    for (const failure of result.failure) input.diagnostics.push(failure);
    return undefined;
  }
  return result.value;
}

// Interpret a field-level attribute node against its spec, draining any parse
// failures into `diagnostics`. Returns the typed value, or `undefined` on
// failure so the caller can apply its own default/absence handling.
export function interpretFieldAttribute<Out>(input: {
  readonly node: FieldAttributeAst;
  readonly spec: AttributeSpec<Out>;
  readonly model: ModelSymbol;
  readonly field: FieldSymbol;
  readonly sourceFile: SourceFile;
  readonly sourceId: string;
  readonly diagnostics: ContractSourceDiagnostic[];
  readonly resolveReferencedModel?: () => ModelSymbol | undefined;
}): Out | undefined {
  const result = interpretAttribute(
    input.node,
    input.spec,
    buildFieldInterpretCtx({
      selfModel: input.model,
      field: input.field,
      sourceFile: input.sourceFile,
      sourceId: input.sourceId,
      resolveReferencedModel: input.resolveReferencedModel,
    }),
  );
  if (!result.ok) {
    for (const failure of result.failure) input.diagnostics.push(failure);
    return undefined;
  }
  return result.value;
}

export const mapModelSpec = modelAttribute('map', { positional: [{ key: 'name', type: str() }] });
export const mapFieldSpec = fieldAttribute('map', { positional: [{ key: 'name', type: str() }] });
