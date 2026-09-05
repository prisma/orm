import type { ContractSourceDiagnostic } from '@internal/config/config-types';
import type { ControlMutationDefaultRegistry } from '@internal/framework-components/control';
import type {
  ContributedPslDiagnosticCode,
  PslDiagnostic,
} from '@internal/framework-components/psl-ast';
import type {
  ArgType,
  AttributeSpec,
  AttributeSpecContext,
  AttributeSpecNamespace,
  FieldAttributeSpecContext,
  FieldSymbol,
  FuncCallSig,
  InferAttr,
  InterpretCtx,
  ModelSymbol,
  PslSpan,
  SymbolTable,
  TypedFuncCall,
} from '@internal/psl-parser';
import {
  bool,
  entityRef,
  fieldAttribute,
  fieldRef,
  funcCall,
  identifier,
  interpretAttribute,
  leafDiagnostic,
  list,
  modelAttribute,
  nodePslSpan,
  num,
  oneOf,
  optional,
  record,
  str,
} from '@internal/psl-parser';
import type { FieldAttributeAst, ModelAttributeAst, SourceFile } from '@internal/psl-parser/syntax';
import { blindCast } from '@internal/utils/casts';
import { notOk } from '@internal/utils/result';

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

const mapModelSpec = modelAttribute('map', { positional: [{ key: 'name', type: str() }] });
const mapFieldSpec = fieldAttribute('map', { positional: [{ key: 'name', type: str() }] });

type DefaultArgValue = string | number | boolean | (string | number | boolean)[] | TypedFuncCall;

function scalarDefaultArms(
  isList: boolean,
  registry: ControlMutationDefaultRegistry,
): readonly [ArgType<DefaultArgValue>, ...ArgType<DefaultArgValue>[]] {
  const literal = () => oneOf(str(), num(), bool());
  const funcArms = [...registry.entries()].map(([name, entry]) =>
    funcCall(
      name,
      blindCast<
        FuncCallSig,
        'The registry stores each signature opaquely as `unknown` because FuncCallSig lives in the authoring layer that core cannot name; the SQL family owns these entries and guarantees every one declares a FuncCallSig.'
      >(entry.signature),
    ),
  );
  return isList ? [list(literal()), ...funcArms] : [str(), num(), bool(), ...funcArms];
}

function noEnumMember(): ArgType<string> {
  return {
    kind: 'identifier',
    label: 'enum member',
    parse: (arg, ctx) => notOk([leafDiagnostic(ctx, arg, 'Enum declares no members')]),
  };
}

function enumMemberNames(ctx: FieldAttributeSpecContext): readonly string[] | undefined {
  const scope =
    ctx.field.typeNamespaceId === undefined
      ? ctx.symbols.topLevel
      : ctx.symbols.topLevel.namespaces[ctx.field.typeNamespaceId];
  const block = scope?.blocks[ctx.field.typeName];
  if (block === undefined || block.keyword !== 'enum') return undefined;
  return Object.keys(block.block.parameters);
}

function enumDefaultArms(
  members: readonly string[],
): readonly [ArgType<DefaultArgValue>, ...ArgType<DefaultArgValue>[]] {
  const [first, ...rest] = members;
  if (first === undefined) return [noEnumMember()];
  return [identifier(first), ...rest.map((name) => identifier(name))];
}

function defaultFieldSpec(ctx: FieldAttributeSpecContext) {
  const members = enumMemberNames(ctx);
  const valueArms =
    members === undefined
      ? scalarDefaultArms(ctx.field.list, ctx.controlMutationDefaults)
      : enumDefaultArms(members);
  return fieldAttribute('default', { positional: [{ key: 'value', type: oneOf(...valueArms) }] });
}

const idFieldSpec = fieldAttribute('id', { named: { map: optional(str()) } });
const uniqueFieldSpec = fieldAttribute('unique', { named: { map: optional(str()) } });

const noCheckKindArgument = () => oneOf(identifier('membership'), identifier('elementNotNull'));

/**
 * `@noCheck` waives generated CHECK constraints on one column: bare for every
 * kind the column's shape derives, or naming concrete kinds. Two optional
 * positional slots cover the whole kind vocabulary; a third argument is
 * necessarily a duplicate and fails as excess arity.
 */
const noCheckFieldSpec = fieldAttribute('noCheck', {
  positional: [
    { key: 'first', type: optional(noCheckKindArgument()) },
    { key: 'second', type: optional(noCheckKindArgument()) },
  ],
  refine: (value, ctx, attributeNode) => {
    if (value.first !== undefined && value.first === value.second) {
      return [leafDiagnostic(ctx, attributeNode, '`@noCheck` names the same kind twice')];
    }
    return [];
  },
});

const idModelSpec = modelAttribute('id', {
  positional: [{ key: 'fields', type: list(fieldRef('self'), { nonEmpty: true, unique: true }) }],
  named: { map: optional(str()) },
});
const uniqueModelSpec = modelAttribute('unique', {
  positional: [{ key: 'fields', type: list(fieldRef('self'), { nonEmpty: true, unique: true }) }],
  named: { map: optional(str()) },
});

// `@@index` cross-argument diagnostic codes — contributed by this package
// through the family-neutral `ContributedPslDiagnosticCode` seam; the
// framework union stays free of index vocabulary.
export const PSL_INDEX_FIELDS_XOR_EXPRESSION: ContributedPslDiagnosticCode =
  'PSL_INDEX_FIELDS_XOR_EXPRESSION';
export const PSL_INDEX_EXPRESSION_REQUIRES_NAME: ContributedPslDiagnosticCode =
  'PSL_INDEX_EXPRESSION_REQUIRES_NAME';
export const PSL_INDEX_NAME_XOR_MAP: ContributedPslDiagnosticCode = 'PSL_INDEX_NAME_XOR_MAP';

const indexModelSpec = modelAttribute('index', {
  positional: [
    { key: 'fields', type: optional(list(fieldRef('self'), { nonEmpty: true, unique: true })) },
  ],
  named: {
    expression: optional(str()),
    where: optional(str()),
    unique: optional(bool()),
    name: optional(str()),
    map: optional(str()),
    type: optional(str()),
    options: optional(record(str())),
  },
  refine: (value, ctx, attributeNode) => {
    const diagnostics: PslDiagnostic[] = [];
    if ((value.fields === undefined) === (value.expression === undefined)) {
      diagnostics.push(
        leafDiagnostic(
          ctx,
          attributeNode,
          '`@@index` requires exactly one of a fields list or an `expression` argument',
          PSL_INDEX_FIELDS_XOR_EXPRESSION,
        ),
      );
    }
    if (value.expression !== undefined && value.name === undefined && value.map === undefined) {
      diagnostics.push(
        leafDiagnostic(
          ctx,
          attributeNode,
          '`@@index` with an `expression` argument requires a `name` or `map` argument (a default name cannot be derived from an expression)',
          PSL_INDEX_EXPRESSION_REQUIRES_NAME,
        ),
      );
    }
    if (value.name !== undefined && value.map !== undefined) {
      diagnostics.push(
        leafDiagnostic(
          ctx,
          attributeNode,
          '`@@index` takes at most one of `name` and `map`',
          PSL_INDEX_NAME_XOR_MAP,
        ),
      );
    }
    if (value.options !== undefined && value.type === undefined) {
      diagnostics.push(
        leafDiagnostic(ctx, attributeNode, '`@@index` options argument requires a type argument'),
      );
    }
    return diagnostics;
  },
});

// `@@check` cross-argument diagnostic codes — contributed by this package
// through the family-neutral `ContributedPslDiagnosticCode` seam; the
// framework union stays free of check vocabulary.
export const PSL_CHECK_REQUIRES_NAME_OR_MAP: ContributedPslDiagnosticCode =
  'PSL_CHECK_REQUIRES_NAME_OR_MAP';
export const PSL_CHECK_NAME_XOR_MAP: ContributedPslDiagnosticCode = 'PSL_CHECK_NAME_XOR_MAP';
export const PSL_CHECK_EXPRESSION_EMPTY: ContributedPslDiagnosticCode =
  'PSL_CHECK_EXPRESSION_EMPTY';
/**
 * A single-table-inheritance variant (`@@base` with no own `@@map`) shares
 * its base model's storage table and has no table of its own to declare a
 * check on — raised from {@link interpretPslDocumentToSqlContract}, not from
 * this spec's own `refine`, because the rule needs the model's `@@base`
 * declaration, which a single attribute's `refine` cannot see.
 */
export const PSL_CHECK_ON_STI_VARIANT: ContributedPslDiagnosticCode = 'PSL_CHECK_ON_STI_VARIANT';

const checkModelSpec = modelAttribute('check', {
  named: {
    expression: str(),
    name: optional(str()),
    map: optional(str()),
  },
  refine: (value, ctx, attributeNode) => {
    const diagnostics: PslDiagnostic[] = [];
    if (value.expression.trim().length === 0) {
      diagnostics.push(
        leafDiagnostic(
          ctx,
          attributeNode,
          '`@@check` expression must not be empty — an empty predicate is not a constraint',
          PSL_CHECK_EXPRESSION_EMPTY,
        ),
      );
    }
    if (value.name === undefined && value.map === undefined) {
      diagnostics.push(
        leafDiagnostic(
          ctx,
          attributeNode,
          '`@@check` requires a `name` or `map` argument (a default name cannot be derived — a check has no column tuple to name itself after)',
          PSL_CHECK_REQUIRES_NAME_OR_MAP,
        ),
      );
    }
    if (value.name !== undefined && value.map !== undefined) {
      diagnostics.push(
        leafDiagnostic(
          ctx,
          attributeNode,
          '`@@check` takes at most one of `name` and `map`',
          PSL_CHECK_NAME_XOR_MAP,
        ),
      );
    }
    return diagnostics;
  },
});

const controlModelSpec = modelAttribute('control', {
  positional: [
    {
      key: 'policy',
      type: oneOf(
        identifier('managed'),
        identifier('tolerated'),
        identifier('external'),
        identifier('observed'),
      ),
    },
  ],
});

const discriminatorModelSpec = modelAttribute('discriminator', {
  positional: [{ key: 'field', type: fieldRef('self') }],
});
const baseModelSpec = modelAttribute('base', {
  positional: [
    { key: 'base', type: entityRef() },
    { key: 'value', type: str() },
  ],
});

function relationAttributeSpan(ctx: InterpretCtx): PslSpan {
  const field = ctx.field;
  if (field !== undefined) {
    const node = findFieldAttributeNode(field, 'relation');
    if (node !== undefined) {
      return nodePslSpan(node.syntax, ctx.sourceFile);
    }
    return field.span;
  }
  return ctx.selfModel.span;
}

function relationInvariants(
  parsed: { readonly fields?: readonly string[]; readonly references?: readonly string[] },
  ctx: InterpretCtx,
): readonly PslDiagnostic[] {
  const hasFields = parsed.fields !== undefined;
  const hasReferences = parsed.references !== undefined;
  if (hasFields !== hasReferences) {
    return [
      {
        code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
        message: `Relation field "${ctx.selfModel.name}.${ctx.field?.name ?? ''}" requires fields and references arguments`,
        sourceId: ctx.sourceId,
        span: relationAttributeSpan(ctx),
      },
    ];
  }
  return [];
}

const referentialActionArgument = () =>
  oneOf(
    identifier('NoAction'),
    identifier('Restrict'),
    identifier('Cascade'),
    identifier('SetNull'),
    identifier('SetDefault'),
  );

const relationFieldSpec = fieldAttribute('relation', {
  positional: [{ key: 'name', type: optional(str()) }],
  named: {
    name: optional(str()),
    fields: optional(list(fieldRef('self'), { nonEmpty: true, unique: true })),
    references: optional(list(fieldRef('referenced'), { nonEmpty: true, unique: true })),
    map: optional(str()),
    onDelete: optional(referentialActionArgument()),
    onUpdate: optional(referentialActionArgument()),
    index: optional(bool()),
  },
  refine: relationInvariants,
});

export type SqlRelationOutput = InferAttr<typeof relationFieldSpec>;

export function modelSpecContext(input: {
  readonly symbols: SymbolTable;
  readonly model: ModelSymbol;
  readonly controlMutationDefaults: ControlMutationDefaultRegistry;
}): AttributeSpecContext {
  return {
    symbols: input.symbols,
    model: input.model,
    controlMutationDefaults: input.controlMutationDefaults,
  };
}

export function fieldSpecContext(input: {
  readonly symbols: SymbolTable;
  readonly model: ModelSymbol;
  readonly field: FieldSymbol;
  readonly controlMutationDefaults: ControlMutationDefaultRegistry;
}): FieldAttributeSpecContext {
  return {
    symbols: input.symbols,
    model: input.model,
    field: input.field,
    controlMutationDefaults: input.controlMutationDefaults,
  };
}

export const sqlAttributeSpecs = {
  model: {
    map: () => mapModelSpec,
    id: () => idModelSpec,
    unique: () => uniqueModelSpec,
    index: () => indexModelSpec,
    check: () => checkModelSpec,
    control: () => controlModelSpec,
    discriminator: () => discriminatorModelSpec,
    base: () => baseModelSpec,
  },
  field: {
    map: () => mapFieldSpec,
    id: () => idFieldSpec,
    unique: () => uniqueFieldSpec,
    noCheck: () => noCheckFieldSpec,
    relation: () => relationFieldSpec,
    default: defaultFieldSpec,
  },
} as const satisfies AttributeSpecNamespace;
