import type { ContractSourceDiagnostic } from '@prisma-next/config/config-types';
import type {
  ArgType,
  AttributeSpec,
  FieldSymbol,
  FuncCallSig,
  InferAttr,
  InterpretCtx,
  ModelSymbol,
  TypedFuncCall,
} from '@prisma-next/psl-parser';
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
  str,
} from '@prisma-next/psl-parser';
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

// One element of an `@@index`/`@@unique` field list, composed per model from its
// field names (like `buildDefaultSpec`): a bare field reference (`name`), a
// `wildcard(scope?)` call, or a `field(sort: Asc|Desc)` call. Output is a field
// name string or a `TypedFuncCall`; the wildcard and bare-field arms are fixed,
// the sorted arms are one `funcCall(name, sortSig)` per field.
function indexFieldElement(fieldNames: readonly string[]): ArgType<string | TypedFuncCall> {
  const arms: readonly [ArgType<string | TypedFuncCall>, ...ArgType<string | TypedFuncCall>[]] = [
    fieldRef('self'),
    funcCall('wildcard', { positional: [{ key: 'scope', type: optional(fieldRef('self')) }] }),
    ...fieldNames.map((name) => funcCall(name, sortSig)),
  ];
  return oneOf(...arms);
}

const collationNamedArgs = {
  collationLocale: optional(str()),
  collationStrength: optional(int()),
  collationCaseLevel: optional(bool()),
  collationCaseFirst: optional(str()),
  collationNumericOrdering: optional(bool()),
  collationAlternate: optional(str()),
  collationMaxVariable: optional(str()),
  collationBackwards: optional(bool()),
  collationNormalization: optional(bool()),
};

// Argument spec shared by model-level `@@index` and `@@unique` — same argument
// surface, only the attribute name differs. `fieldNames` seeds the per-field
// sorted arms of each element.
export function buildIndexModelSpec(name: 'index' | 'unique', fieldNames: readonly string[]) {
  return modelAttribute(name, {
    positional: [{ key: 'fields', type: list(indexFieldElement(fieldNames), { nonEmpty: true }) }],
    named: {
      type: optional(
        oneOf(num(1), num(-1), str('text'), str('2dsphere'), str('2d'), str('hashed')),
      ),
      sparse: optional(bool()),
      expireAfterSeconds: optional(int()),
      filter: optional(json()),
      include: optional(str()),
      exclude: optional(str()),
      default_language: optional(str()),
      languageOverride: optional(str()),
      ...collationNamedArgs,
    },
  });
}

// Argument spec for model-level `@@textIndex`. Shares the field-list element and
// collation args with `@@index`/`@@unique`, but its text-search options differ:
// `weights` (json), `language` (note: `language`, not `default_language`), and
// `languageOverride`. It does not accept `type`/`sparse`/`expireAfterSeconds`.
export function buildTextIndexModelSpec(fieldNames: readonly string[]) {
  return modelAttribute('textIndex', {
    positional: [{ key: 'fields', type: list(indexFieldElement(fieldNames), { nonEmpty: true }) }],
    named: {
      filter: optional(json()),
      include: optional(str()),
      exclude: optional(str()),
      weights: optional(json()),
      language: optional(str()),
      languageOverride: optional(str()),
      ...collationNamedArgs,
    },
  });
}
