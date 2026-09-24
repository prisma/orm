import type { ControlDefaultRegistries } from '@internal/framework-components/control';
import type { ContributedPslDiagnosticCode } from '@internal/framework-components/psl-ast';
import type {
  ArgType,
  AttributeCtx,
  AttributeSpec,
  AttributeSpecContext,
  AttributeSpecNamespace,
  FieldAttributeCtx,
  FieldAttributeSpecContext,
  FieldSymbol,
  FuncCallSig,
  InferAttr,
  ModelAttributeCtx,
  ModelSymbol,
  NumLiteral,
  ParsedTaggedLiteral,
  PslDiagnostic,
  PslSpan,
  RejectingArgType,
  SymbolTable,
  TypedFuncCall,
} from '@internal/psl-parser';
import {
  bool,
  diagnosticSource,
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
  numLiteral,
  oneOf,
  optional,
  type PslDiagnosticCollector,
  record,
  referencedFieldRef,
  str,
  taggedLiteral,
} from '@internal/psl-parser';
import type {
  AstNode,
  FieldAttributeAst,
  ModelAttributeAst,
  PslSources,
} from '@internal/psl-parser/syntax';
import { FunctionCallAst } from '@internal/psl-parser/syntax';
import { blindCast } from '@internal/utils/casts';
import { notOk } from '@internal/utils/result';
import { removedDbgeneratedMessage } from './default-function-registry';

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

function buildModelAttributeCtx(input: {
  readonly symbols: SymbolTable;
  readonly selfModel: ModelSymbol;
  readonly sources: PslSources;
}): ModelAttributeCtx {
  return {
    sources: input.sources,
    selfModel: input.selfModel,
    symbols: input.symbols,
  };
}

function buildFieldAttributeCtx(input: {
  readonly symbols: SymbolTable;
  readonly selfModel: ModelSymbol;
  readonly field: FieldSymbol;
  readonly sources: PslSources;
  readonly resolveReferencedModel?: (() => ModelSymbol | undefined) | undefined;
}): FieldAttributeCtx {
  return {
    sources: input.sources,
    selfModel: input.selfModel,
    resolveReferencedModel: input.resolveReferencedModel ?? (() => undefined),
    field: input.field,
    symbols: input.symbols,
  };
}

// Interpret a model-level attribute node against its spec, draining any parse
// failures into `diagnostics`. Returns the typed value, or `undefined` on
// failure so the caller can apply its own default/absence handling.
export function interpretModelAttribute<Out>(input: {
  readonly symbols: SymbolTable;
  readonly node: ModelAttributeAst;
  readonly spec: AttributeSpec<Out, ModelAttributeCtx>;
  readonly model: ModelSymbol;
  readonly sources: PslSources;
  readonly diagnostics: PslDiagnosticCollector;
}): Out | undefined {
  const result = interpretAttribute(
    input.node,
    input.spec,
    buildModelAttributeCtx({
      symbols: input.symbols,
      selfModel: input.model,
      sources: input.sources,
    }),
  );
  if (!result.ok) {
    input.diagnostics.push(...result.failure);
    return undefined;
  }
  return result.value;
}

// Interpret a field-level attribute node against its spec, draining any parse
// failures into `diagnostics`. Returns the typed value, or `undefined` on
// failure so the caller can apply its own default/absence handling.
export function interpretFieldAttribute<Out>(input: {
  readonly symbols: SymbolTable;
  readonly node: FieldAttributeAst;
  readonly spec: AttributeSpec<Out, FieldAttributeCtx>;
  readonly model: ModelSymbol;
  readonly field: FieldSymbol;
  readonly sources: PslSources;
  readonly diagnostics: PslDiagnosticCollector;
  readonly resolveReferencedModel?: () => ModelSymbol | undefined;
}): Out | undefined {
  const result = interpretAttribute(
    input.node,
    input.spec,
    buildFieldAttributeCtx({
      symbols: input.symbols,
      selfModel: input.model,
      field: input.field,
      sources: input.sources,
      resolveReferencedModel: input.resolveReferencedModel,
    }),
  );
  if (!result.ok) {
    input.diagnostics.push(...result.failure);
    return undefined;
  }
  return result.value;
}

function validateMappedName(
  value: { readonly name: string },
  ctx: AttributeCtx,
  attributeNode: AstNode,
): readonly PslDiagnostic[] {
  return value.name === ''
    ? [leafDiagnostic(ctx, attributeNode, 'Mapped name must not be empty')]
    : [];
}

const mapModelSpec = modelAttribute('map', {
  documentation: 'Maps this model to a database table name.',
  positional: [{ key: 'name', type: str(), documentation: 'The nonempty database table name.' }],
  refine: validateMappedName,
});
const mapFieldSpec = fieldAttribute('map', {
  documentation: 'Maps this field to a database column name.',
  positional: [{ key: 'name', type: str(), documentation: 'The nonempty database column name.' }],
  refine: validateMappedName,
});

type DefaultLiteralElement = string | NumLiteral | boolean | ParsedTaggedLiteral;

type DefaultArgValue = DefaultLiteralElement | DefaultLiteralElement[] | TypedFuncCall;

function scalarDefaultArms(
  isList: boolean,
  registries: ControlDefaultRegistries,
): readonly [ArgType<DefaultArgValue, AttributeCtx>, ...ArgType<DefaultArgValue, AttributeCtx>[]] {
  // One arm per distinct documentation, so each tag's completion and signature help carries the
  // text of the tag it names rather than every registered tag's text run together.
  const tagsByDocumentation = new Map<string, string[]>();
  for (const entry of Object.values(registries.dataTypeEntries)) {
    if (entry.written.kind !== 'tag') continue;
    const tags = tagsByDocumentation.get(entry.documentation);
    if (tags === undefined) tagsByDocumentation.set(entry.documentation, [entry.written.tag]);
    else tags.push(entry.written.tag);
  }
  const tagArms = () =>
    [...tagsByDocumentation].map(([documentation, tags]) => taggedLiteral(tags, { documentation }));
  // A list element may itself be a tagged literal, so `Jsonb[] @default([json`{}`])` parses.
  const literal = () => oneOf(str(), numLiteral(), bool(), ...tagArms());
  const listArm = () => list(literal(), { label: `list of (${literal().label})` });
  const funcArms = [...registries.defaultFunctionRegistry.entries()].map(([name, entry]) =>
    funcCall(
      name,
      blindCast<
        FuncCallSig,
        'The registry stores each signature opaquely as `unknown` because FuncCallSig lives in the authoring layer that core cannot name; the SQL family owns these entries and guarantees every one declares a FuncCallSig.'
      >(entry.signature),
    ),
  );
  // A scalar column takes a list literal too: a codec such as `pg/vector@1` declares a list of
  // element types, and its value is written as a PSL list on a column that is not a list.
  return isList
    ? [listArm(), ...funcArms, ...tagArms()]
    : [str(), numLiteral(), bool(), ...funcArms, ...tagArms(), listArm()];
}

/**
 * The `@default` value arms, with a `dbgenerated(...)` call reported as removed before the arms
 * are tried, so the author is told what replaced it instead of being shown the list of arms.
 */
function defaultValueArm(
  arms: readonly [
    ArgType<DefaultArgValue, AttributeCtx>,
    ...ArgType<DefaultArgValue, AttributeCtx>[],
  ],
  registry: ControlDefaultRegistries['defaultFunctionRegistry'],
) {
  const value = oneOf(...arms);
  return {
    ...value,
    parse: (arg: Parameters<typeof value.parse>[0], ctx: AttributeCtx) =>
      FunctionCallAst.cast(arg.syntax)?.path().join('.') === 'dbgenerated'
        ? notOk<readonly PslDiagnostic[]>([
            leafDiagnostic(
              ctx,
              arg,
              removedDbgeneratedMessage(registry),
              'PSL_UNKNOWN_DEFAULT_FUNCTION',
            ),
          ])
        : value.parse(arg, ctx),
  };
}

function noEnumMember(): RejectingArgType<never, AttributeCtx> {
  return {
    kind: 'rejecting',
    label: 'enum member',
    message: 'Enum declares no members',
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
  enumName: string,
): readonly [ArgType<DefaultArgValue, AttributeCtx>, ...ArgType<DefaultArgValue, AttributeCtx>[]] {
  const [first, ...rest] = members;
  if (first === undefined) return [noEnumMember()];
  const member = (name: string) =>
    identifier(name, { documentation: `The \`${name}\` member of enum \`${enumName}\`.` });
  return [member(first), ...rest.map(member)];
}

function defaultFieldSpec(ctx: FieldAttributeSpecContext) {
  const members = enumMemberNames(ctx);
  const valueArms =
    members === undefined
      ? scalarDefaultArms(ctx.field.list, ctx.controlMutationDefaults)
      : enumDefaultArms(members, ctx.field.typeName);
  return fieldAttribute('default', {
    documentation: 'Supplies a default value when this field is omitted from a mutation.',
    positional: [
      {
        key: 'value',
        type: defaultValueArm(valueArms, ctx.controlMutationDefaults.defaultFunctionRegistry),
        documentation:
          'A literal, enum member, or registered default function compatible with this field.',
      },
    ],
  });
}

const idFieldSpec = fieldAttribute('id', {
  documentation: 'Makes this field the primary key of the table.',
  named: {
    map: { type: optional(str()), documentation: 'The database primary-key constraint name.' },
  },
});
const uniqueFieldSpec = fieldAttribute('unique', {
  documentation: 'Requires values in this field to be unique.',
  named: { map: { type: optional(str()), documentation: 'The database unique-constraint name.' } },
});

const noCheckKindArgument = () =>
  oneOf(
    identifier('membership', {
      documentation: 'Waives the generated check that values belong to the declared domain enum.',
    }),
    identifier('elementNotNull', {
      documentation: 'Waives the generated check that scalar-list elements are non-null.',
    }),
  );

/**
 * `@noCheck` waives generated CHECK constraints on one column: bare for every
 * kind the column's shape derives, or naming concrete kinds. Two optional
 * positional slots cover the whole kind vocabulary; a third argument is
 * necessarily a duplicate and fails as excess arity.
 */
const noCheckFieldSpec = fieldAttribute('noCheck', {
  documentation:
    'Waives generated CHECK constraints for this column. With no arguments, waives every generated kind.',
  positional: [
    {
      key: 'first',
      type: optional(noCheckKindArgument()),
      documentation: 'The first generated check kind to waive: `membership` or `elementNotNull`.',
    },
    {
      key: 'second',
      type: optional(noCheckKindArgument()),
      documentation: 'A second, distinct generated check kind to waive.',
    },
  ],
  refine: (value, ctx, attributeNode) => {
    if (value.first !== undefined && value.first === value.second) {
      return [leafDiagnostic(ctx, attributeNode, '`@noCheck` names the same kind twice')];
    }
    return [];
  },
});

const idModelSpec = modelAttribute('id', {
  documentation: 'Declares a compound primary key for this table.',
  positional: [
    {
      key: 'fields',
      type: list(fieldRef(), { allowEmpty: false, unique: true }),
      documentation: 'The ordered, nonempty list of distinct primary-key fields.',
    },
  ],
  named: {
    map: { type: optional(str()), documentation: 'The database primary-key constraint name.' },
  },
});
const uniqueModelSpec = modelAttribute('unique', {
  documentation: 'Requires the combination of these fields to be unique.',
  positional: [
    {
      key: 'fields',
      type: list(fieldRef(), { allowEmpty: false, unique: true }),
      documentation: 'The ordered, nonempty list of distinct fields in the unique constraint.',
    },
  ],
  named: { map: { type: optional(str()), documentation: 'The database unique-constraint name.' } },
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
  documentation:
    'Declares a database index over fields or a SQL expression, optionally restricted by a predicate.',
  positional: [
    {
      key: 'fields',
      type: optional(list(fieldRef(), { allowEmpty: false, unique: true })),
      documentation:
        'The ordered list of distinct indexed fields. Mutually exclusive with `expression`.',
    },
  ],
  named: {
    expression: {
      type: optional(str()),
      documentation:
        'The SQL index expression. Requires `name` or `map` and cannot be combined with a fields list.',
    },
    where: {
      type: optional(str()),
      documentation: 'The SQL predicate restricting rows included in a partial index.',
    },
    unique: { type: optional(bool()), documentation: 'Whether the index enforces uniqueness.' },
    name: {
      type: optional(str()),
      documentation: 'The index name. Mutually exclusive with `map`.',
    },
    map: {
      type: optional(str()),
      documentation: 'The database index name. Mutually exclusive with `name`.',
    },
    type: { type: optional(str()), documentation: 'The target-specific index access method.' },
    options: {
      type: optional(record(str())),
      documentation: 'Target-specific index options. Requires an explicit `type`.',
    },
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
  documentation: 'Declares a named database CHECK constraint on this table.',
  named: {
    expression: { type: str(), documentation: 'The nonempty SQL predicate checked for each row.' },
    name: {
      type: optional(str()),
      documentation: 'The constraint name. Exactly one of `name` and `map` is required.',
    },
    map: {
      type: optional(str()),
      documentation: 'The database constraint name. Exactly one of `name` and `map` is required.',
    },
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
  documentation: 'Sets how schema management treats this model’s storage.',
  positional: [
    {
      key: 'policy',
      documentation:
        'The storage control policy: `managed`, `tolerated`, `external`, or `observed`.',
      type: oneOf(
        identifier('managed', {
          documentation:
            'Verifies the declared shape strictly and allows migrations to create, alter, or drop the storage object.',
        }),
        identifier('tolerated', {
          documentation:
            'Verifies declared columns while allowing extra columns. Migrations may create missing storage, but never alter or drop existing storage.',
        }),
        identifier('external', {
          documentation: 'Verifies declared storage without creating, altering, or dropping it.',
        }),
        identifier('observed', {
          documentation:
            'Reports storage differences as warnings rather than verification failures and never emits migration operations.',
        }),
      ),
    },
  ],
});

const discriminatorModelSpec = modelAttribute('discriminator', {
  documentation: 'Selects the field that identifies inheritance variants of this model.',
  positional: [
    { key: 'field', type: fieldRef(), documentation: 'The discriminator field on this model.' },
  ],
});
function baseModelSpec() {
  return modelAttribute('base', {
    documentation: 'Declares this model as a variant of a base model.',
    positional: [
      {
        key: 'base',
        type: entityRef({ kind: 'model' }),
        documentation: 'The base model to inherit from.',
      },
      {
        key: 'value',
        type: str(),
        documentation: 'The discriminator value identifying this variant.',
      },
    ],
  });
}

function relationAttributeSpan(ctx: FieldAttributeCtx): PslSpan {
  const node = findFieldAttributeNode(ctx.field, 'relation');
  if (node !== undefined) {
    return nodePslSpan(node.syntax, ctx.sources);
  }
  return ctx.field.span;
}

function relationInvariants(
  parsed: { readonly fields?: readonly string[]; readonly references?: readonly string[] },
  ctx: FieldAttributeCtx,
): readonly PslDiagnostic[] {
  const hasFields = parsed.fields !== undefined;
  const hasReferences = parsed.references !== undefined;
  if (hasFields !== hasReferences) {
    return [
      {
        code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
        message: `Relation field "${ctx.selfModel.name}.${ctx.field.name}" requires fields and references arguments`,
        ...diagnosticSource(ctx.sources, ctx.field.node.syntax).at(relationAttributeSpan(ctx)),
      },
    ];
  }
  return [];
}

const referentialActionArgument = () =>
  oneOf(
    identifier('NoAction', {
      documentation:
        'Rejects a change that would violate the foreign key when the constraint is checked; checking may be deferred when supported and configured.',
    }),
    identifier('Restrict', {
      documentation:
        'Rejects deleting or updating a referenced row while referencing rows remain, without deferring the check.',
    }),
    identifier('Cascade', {
      documentation:
        'Propagates deletion or key updates of a referenced row to its referencing rows.',
    }),
    identifier('SetNull', {
      documentation:
        'Sets referencing foreign-key fields to null when the referenced row is deleted or its key changes. The fields must allow null.',
    }),
    identifier('SetDefault', {
      documentation:
        'Sets referencing foreign-key fields to their defaults when the referenced row is deleted or its key changes. The resulting values must satisfy the foreign key.',
    }),
  );

const relationFieldSpec = fieldAttribute('relation', {
  documentation:
    'Defines the relation name, foreign-key fields, and referential actions for this relation.',
  positional: [
    {
      key: 'name',
      type: optional(str()),
      documentation: 'The relation name used to pair both sides. May also be supplied by name.',
    },
  ],
  named: {
    name: {
      type: optional(str()),
      documentation:
        'The relation name used to pair both sides. Cannot also be supplied positionally.',
    },
    fields: {
      type: optional(list(fieldRef(), { allowEmpty: false, unique: true })),
      documentation:
        'The ordered local foreign-key fields. Must be supplied together with `references`.',
    },
    references: {
      type: optional(list(referencedFieldRef(), { allowEmpty: false, unique: true })),
      documentation:
        'The corresponding fields on the referenced model. Must be supplied together with `fields`.',
    },
    map: { type: optional(str()), documentation: 'The database foreign-key constraint name.' },
    onDelete: {
      type: optional(referentialActionArgument()),
      documentation: 'The referential action when a referenced row is deleted.',
    },
    onUpdate: {
      type: optional(referentialActionArgument()),
      documentation: 'The referential action when a referenced key is updated.',
    },
    index: {
      type: optional(bool()),
      documentation: 'Whether to create an index for the relation’s foreign-key fields.',
    },
  },
  refine: relationInvariants,
});

export type SqlRelationOutput = InferAttr<typeof relationFieldSpec>;

export function modelSpecContext(input: {
  readonly symbols: SymbolTable;
  readonly model: ModelSymbol;
  readonly controlMutationDefaults: ControlDefaultRegistries;
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
  readonly controlMutationDefaults: ControlDefaultRegistries;
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
    base: baseModelSpec,
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
