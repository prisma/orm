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
  nodePslSpan,
  num,
  oneOf,
  optional,
  str,
} from '@internal/psl-parser';
import type { FieldAttributeAst, ModelAttributeAst, SourceFile } from '@internal/psl-parser/syntax';
import { notOk, ok } from '@internal/utils/result';

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

export type MongoProjectionList = readonly string[];

function projectionList(): ArgType<MongoProjectionList> {
  const stringLiteral = str();
  return {
    kind: 'mongoProjectionList',
    label: 'Mongo projection list',
    parse: (arg, ctx) => {
      const parsed = stringLiteral.parse(arg, ctx);
      if (!parsed.ok) return parsed;

      const raw = parsed.value.trim();
      if (!raw.startsWith('[') || !raw.endsWith(']')) {
        return notOk([
          {
            code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
            message: 'Expected a projection list string such as "[field, nested.path]"',
            sourceId: ctx.sourceId,
            span: nodePslSpan(arg.syntax, ctx.sourceFile),
          },
        ]);
      }

      const inner = raw.slice(1, -1).trim();
      if (inner.length === 0) return ok([]);
      const fields = inner.split(',').map((field) => field.trim());
      if (fields.some((field) => field.length === 0)) {
        return notOk([
          {
            code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
            message: 'Expected a projection list string without empty fields',
            sourceId: ctx.sourceId,
            span: nodePslSpan(arg.syntax, ctx.sourceFile),
          },
        ]);
      }
      return ok(fields);
    },
  };
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
      include: optional(projectionList()),
      exclude: optional(projectionList()),
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
      include: optional(projectionList()),
      exclude: optional(projectionList()),
      weights: optional(json()),
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
