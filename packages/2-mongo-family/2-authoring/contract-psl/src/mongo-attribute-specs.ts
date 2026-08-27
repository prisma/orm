import type { ContractSourceDiagnostic } from '@internal/config/config-types';
import type {
  ArgType,
  AttributeSpec,
  FieldSymbol,
  FuncCallSig,
  InferAttr,
  InterpretCtx,
  ModelSymbol,
  TypedFuncCall,
} from '@internal/psl-parser';
import {
  bool,
  entityRef,
  fieldAttribute,
  fieldRef,
  funcCall,
  identifier,
  int,
  interpretAttribute,
  json,
  list,
  modelAttribute,
  num,
  oneOf,
  optional,
  record,
  str,
} from '@internal/psl-parser';
import type { FieldAttributeAst, ModelAttributeAst, SourceFile } from '@internal/psl-parser/syntax';

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

export const relationFieldSpec = fieldAttribute('relation', {
  positional: [{ key: 'name', type: optional(str()) }],
  named: {
    name: optional(str()),
    fields: optional(list(fieldRef('self'), { nonEmpty: true, unique: true })),
    references: optional(list(fieldRef('referenced'), { nonEmpty: true, unique: true })),
  },
});
export type RelationFieldOutput = InferAttr<typeof relationFieldSpec>;

export const discriminatorModelSpec = modelAttribute('discriminator', {
  positional: [{ key: 'field', type: fieldRef('self') }],
});
export const baseModelSpec = modelAttribute('base', {
  positional: [
    { key: 'base', type: entityRef() },
    { key: 'value', type: str() },
  ],
});

const sortSig = {
  named: { sort: oneOf(identifier('Asc'), identifier('Desc')) },
} satisfies FuncCallSig;

function indexFieldElement(fieldNames: readonly string[]): ArgType<string | TypedFuncCall> {
  const arms: readonly [ArgType<string | TypedFuncCall>, ...ArgType<string | TypedFuncCall>[]] = [
    fieldRef('self'),
    funcCall('wildcard', { positional: [{ key: 'scope', type: optional(entityRef()) }] }),
    ...fieldNames.map((name) => funcCall(name, sortSig)),
  ];
  return oneOf(...arms);
}

const collationNamedArgs = {
  collationLocale: optional(str()),
  collationStrength: optional(oneOf(num(1), num(2), num(3), num(4), num(5))),
  collationCaseLevel: optional(bool()),
  collationCaseFirst: optional(oneOf(str('upper'), str('lower'), str('off'))),
  collationNumericOrdering: optional(bool()),
  collationAlternate: optional(oneOf(str('non-ignorable'), str('shifted'))),
  collationMaxVariable: optional(oneOf(str('punct'), str('space'))),
  collationBackwards: optional(bool()),
  collationNormalization: optional(bool()),
};

function buildIndexModelSpec(
  name: 'index' | 'unique',
  fieldElement: ArgType<string | TypedFuncCall>,
) {
  return modelAttribute(name, {
    positional: [{ key: 'fields', type: list(fieldElement, { nonEmpty: true }) }],
    named: {
      type: optional(
        oneOf(num(1), num(-1), str('text'), str('2dsphere'), str('2d'), str('hashed')),
      ),
      sparse: optional(bool()),
      expireAfterSeconds: optional(int()),
      filter: optional(json()),
      include: optional(list(str())),
      exclude: optional(list(str())),
      default_language: optional(str()),
      languageOverride: optional(str()),
      ...collationNamedArgs,
    },
  });
}

function buildTextIndexModelSpec(fieldElement: ArgType<string | TypedFuncCall>) {
  return modelAttribute('textIndex', {
    positional: [{ key: 'fields', type: list(fieldElement, { nonEmpty: true }) }],
    named: {
      filter: optional(json()),
      weights: optional(record(int({ min: 1, max: 99_999 }))),
      language: optional(str()),
      languageOverride: optional(str()),
      ...collationNamedArgs,
    },
  });
}

export function buildIndexModelSpecs(fieldNames: readonly string[]) {
  const fieldElement = indexFieldElement(fieldNames);
  return {
    index: buildIndexModelSpec('index', fieldElement),
    unique: buildIndexModelSpec('unique', fieldElement),
    textIndex: buildTextIndexModelSpec(fieldElement),
  };
}
