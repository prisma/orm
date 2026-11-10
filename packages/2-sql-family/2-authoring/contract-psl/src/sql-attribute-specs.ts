import type {
  AuthoringModelAttributeDescriptor,
  DataTypeSupport,
} from '@internal/framework-components/authoring';
import type { GeneratorFunctionRegistry } from '@internal/framework-components/components';
import type {
  ControlMutationDefaultEntry,
  ControlMutationDefaultRegistry,
} from '@internal/framework-components/control';
import type { ContributedPslDiagnosticCode } from '@internal/framework-components/psl-ast';
import type {
  ArgType,
  AttributeCtx,
  AttributeSpec,
  AttributeSpecContext,
  AttributeSpecNamespace,
  Binder,
  FieldAttributeCtx,
  FieldAttributeSpecContext,
  FieldSymbol,
  FuncCallSig,
  InferAttr,
  ModelAttributeCtx,
  ModelAttributeSpecFactory,
  ModelSymbol,
  ParsedWrittenList,
  ParsedWrittenScalar,
  PslDiagnostic,
  PslSpan,
  RejectingArgType,
  SymbolTable,
  TypeAttributeSpecContext,
  TypedFuncCall,
} from '@internal/psl-parser';
import {
  bool,
  contributedTypeCodecId,
  contributedTypeOf,
  dataTypeValue,
  diagnosticSource,
  entityRef,
  fieldAttribute,
  fieldRef,
  funcCall,
  generatorAttributeSpec,
  identifier,
  interpretAttribute,
  leafDiagnostic,
  list,
  mapArg,
  modelAttribute,
  nodePslSpan,
  nodeSourceText,
  numLiteral,
  oneOf,
  optional,
  type PslDiagnosticCollector,
  record,
  referencedFieldRef,
  str,
  taggedLiteral,
  typeAttribute,
  typeAttributeSpecContextOfField,
  typeAttributeSubjectLabel,
  typeReferenceNode,
  writtenList,
  writtenScalar,
} from '@internal/psl-parser';
import type {
  AstNode,
  FieldAttributeAst,
  ModelAttributeAst,
  PslSources,
} from '@internal/psl-parser/syntax';
import { FunctionCallAst } from '@internal/psl-parser/syntax';
import {
  SQL_EXPRESSION_DATA_TYPE_ID,
  sqlTextFromStored,
} from '@internal/sql-contract/sql-expression';
import { blindCast } from '@internal/utils/casts';
import { notOk, ok } from '@internal/utils/result';
import { removedDbgeneratedMessage } from './default-function-registry';
import { getAttribute } from './psl-attribute-parsing';

function buildModelAttributeCtx(input: {
  readonly symbols: SymbolTable;
  readonly selfModel: ModelSymbol;
  readonly sources: PslSources;
  readonly binder: Binder;
}): ModelAttributeCtx {
  return {
    sources: input.sources,
    selfModel: input.selfModel,
    binder: input.binder,
    symbols: input.symbols,
  };
}

function buildFieldAttributeCtx(input: {
  readonly symbols: SymbolTable;
  readonly selfModel: ModelSymbol;
  readonly field: FieldSymbol;
  readonly sources: PslSources;
  readonly binder: Binder;
}): FieldAttributeCtx {
  return {
    sources: input.sources,
    selfModel: input.selfModel,
    field: input.field,
    binder: input.binder,
    symbols: input.symbols,
  };
}

export function modelAttributeSpecsFrom(
  modelAttributesByName: ReadonlyMap<string, AuthoringModelAttributeDescriptor>,
): Readonly<Record<string, ModelAttributeSpecFactory>> {
  const result: Record<string, ModelAttributeSpecFactory> = Object.create(null);
  for (const [name, descriptor] of modelAttributesByName) {
    result[name] = blindCast<
      ModelAttributeSpecFactory,
      'contributed model-attribute descriptors carry an ADR-231 attribute-spec factory by construction'
    >(descriptor.spec);
  }
  return result;
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
  readonly binder: Binder;
  readonly diagnostics: PslDiagnosticCollector;
}): Out | undefined {
  const result = interpretAttribute(
    input.node,
    input.spec,
    buildModelAttributeCtx({
      symbols: input.symbols,
      selfModel: input.model,
      sources: input.sources,
      binder: input.binder,
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
  readonly binder: Binder;
  readonly diagnostics: PslDiagnosticCollector;
}): Out | undefined {
  const result = interpretAttribute(
    input.node,
    input.spec,
    buildFieldAttributeCtx({
      symbols: input.symbols,
      selfModel: input.model,
      field: input.field,
      sources: input.sources,
      binder: input.binder,
    }),
  );
  if (!result.ok) {
    input.diagnostics.push(...result.failure);
    return undefined;
  }
  return result.value;
}

/** Interprets an attribute that reads only its type, such as `@default` on a field or a type alias, draining parse failures into `diagnostics`. */
export function interpretTypeAttribute<Out>(input: {
  readonly symbols: SymbolTable;
  readonly node: FieldAttributeAst;
  readonly spec: AttributeSpec<Out, AttributeCtx>;
  readonly sources: PslSources;
  readonly binder: Binder;
  readonly diagnostics: PslDiagnosticCollector;
}): Out | undefined {
  const result = interpretAttribute(input.node, input.spec, {
    sources: input.sources,
    symbols: input.symbols,
    binder: input.binder,
  });
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

export interface EnumMemberDefault {
  readonly kind: 'member';
  readonly name: string;
}

/** A written `null`, as a nullable field's default or a list element, with its span. */
export interface ParsedNullLiteral {
  readonly kind: 'null';
  readonly span: PslSpan;
}

/** An enum list default: its members and nulls. */
export interface EnumMemberListDefault {
  readonly kind: 'member-list';
  readonly elements: readonly (EnumMemberDefault | ParsedNullLiteral)[];
}

function nullLiteral(): ArgType<ParsedNullLiteral, AttributeCtx> {
  const nullIdentifier = identifier('null', {
    documentation: 'A null list element or nullable scalar default.',
  });
  const nullArm: ArgType<null, AttributeCtx> = {
    kind: 'null',
    label: 'null',
    parse: (arg, ctx) => {
      const result = nullIdentifier.parse(arg, ctx);
      return result.ok ? ok(null) : result;
    },
  };
  return mapArg(nullArm, (_null, arg, ctx) => ({
    kind: 'null',
    span: nodePslSpan(arg.syntax, ctx.sources),
  }));
}

/** A call to a registered default function, such as `uuid()`. Not the contract's `{ kind: 'function' }` storage default. */
export interface DefaultFunctionCall {
  readonly kind: 'default-function';
  readonly call: TypedFuncCall;
}

type DefaultArgValue =
  | ParsedWrittenScalar
  | ParsedNullLiteral
  | ParsedWrittenList<ParsedWrittenScalar | ParsedNullLiteral>
  | DefaultFunctionCall
  | EnumMemberDefault
  | EnumMemberListDefault;

/** A default function's signature, or a function that builds it from the stack's data types when its arguments are values of a data type. */
export type DefaultFunctionSignature = FuncCallSig | ((dataTypes: DataTypeSupport) => FuncCallSig);

/**
 * A call to the registered default function `name`, with its signature built from the stack's data types when it needs them. Its binding diagnostics name it as a default function.
 */
export function defaultFunctionCall(
  name: string,
  entry: ControlMutationDefaultEntry,
  dataTypes: DataTypeSupport,
): ArgType<TypedFuncCall, AttributeCtx> {
  const signature = blindCast<
    DefaultFunctionSignature,
    'The registry stores each signature opaquely as `unknown` because FuncCallSig lives in the authoring layer that core cannot name; the SQL family owns these entries and guarantees every one declares a DefaultFunctionSignature.'
  >(entry.signature);
  return funcCall(name, typeof signature === 'function' ? signature(dataTypes) : signature, {
    label: `Default function "${name}"`,
  });
}

/** The data type of the column a field declares, when its type, or the named type it is declared with, is a constructor the stack knows. */
function receivingDataType(ctx: TypeAttributeSpecContext): string | undefined {
  const codecId =
    ctx.contributedType === undefined
      ? undefined
      : contributedTypeCodecId(ctx.contributedType, ctx.dataTypes);
  return codecId === undefined ? undefined : ctx.dataTypes.dataTypeOfCodec(codecId);
}

/** Whether a value of `type` can be written for a column of `receiving`: it is that type, or the column's type casts from it. An unknown column takes every type. */
function receives(
  dataTypes: DataTypeSupport,
  receiving: string | undefined,
  type: string,
): boolean {
  if (receiving === undefined || type === receiving) return true;
  const receivingType = dataTypes.lookup.get(receiving);
  if (receivingType === undefined) return true;
  return (
    Object.hasOwn(receivingType.casts, type) ||
    (receivingType.listCast?.of.some((of) => of === type) ?? false)
  );
}

function scalarDefaultArms(
  isList: boolean,
  receiving: string | undefined,
  dataTypes: DataTypeSupport,
  defaultFunctionRegistry: ControlMutationDefaultRegistry,
): readonly [ArgType<DefaultArgValue, AttributeCtx>, ...ArgType<DefaultArgValue, AttributeCtx>[]] {
  // One arm per distinct documentation, so each tag's completion and signature help carries the
  // text of the tag it names rather than every registered tag's text run together.
  const tagArms = (admits: (dataType: string) => boolean) => {
    const tagsByDocumentation = new Map<string, string[]>();
    for (const [key, entry] of Object.entries(dataTypes.entries)) {
      if (entry.written.kind !== 'tag' || !admits(key)) continue;
      const tags = tagsByDocumentation.get(entry.documentation);
      if (tags === undefined) tagsByDocumentation.set(entry.documentation, [entry.written.tag]);
      else tags.push(entry.written.tag);
    }
    return [...tagsByDocumentation].map(([documentation, tags]) =>
      writtenScalar(taggedLiteral(tags, { documentation })),
    );
  };
  // A list column's single written value is an expression; a value of its element type goes in a list.
  const columnTags = () =>
    tagArms(
      (dataType) =>
        dataType === SQL_EXPRESSION_DATA_TYPE_ID ||
        (!isList && receives(dataTypes, receiving, dataType)),
    );
  // A list element may itself be a tagged literal, so `Jsonb[] @default([json`{}`])` parses. A
  // SQL expression is never a list element, so the list does not offer its tag.
  const literal = () =>
    oneOf(
      writtenScalar(str()),
      writtenScalar(numLiteral()),
      writtenScalar(bool()),
      nullLiteral(),
      ...tagArms(
        (dataType) =>
          dataType !== SQL_EXPRESSION_DATA_TYPE_ID && receives(dataTypes, receiving, dataType),
      ),
    );
  const listArm = () => writtenList(literal());
  const funcArms = [...defaultFunctionRegistry.entries()].map(([name, entry]) =>
    mapArg(
      defaultFunctionCall(name, entry, dataTypes),
      (call): DefaultFunctionCall => ({ kind: 'default-function', call }),
    ),
  );
  return isList
    ? [listArm(), ...funcArms, ...columnTags()]
    : [
        writtenScalar(str()),
        writtenScalar(numLiteral()),
        writtenScalar(bool()),
        nullLiteral(),
        ...funcArms,
        ...columnTags(),
        listArm(),
      ];
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
  registry: ControlMutationDefaultRegistry,
  generatorFunctions: GeneratorFunctionRegistry,
  subject: string,
) {
  const value = arms.length === 1 && arms[0].kind === 'list' ? arms[0] : oneOf(...arms);
  return {
    ...value,
    parse: (arg: Parameters<typeof value.parse>[0], ctx: AttributeCtx) => {
      const callee = FunctionCallAst.cast(arg.syntax)?.path().join('.');
      if (callee === 'dbgenerated') {
        return notOk<readonly PslDiagnostic[]>([
          leafDiagnostic(
            ctx,
            arg,
            removedDbgeneratedMessage(registry),
            'PSL_UNKNOWN_DEFAULT_FUNCTION',
          ),
        ]);
      }
      if (callee !== undefined && !registry.has(callee) && generatorFunctions.has(callee)) {
        const call = nodeSourceText(arg, ctx);
        return notOk<readonly PslDiagnostic[]>([
          leafDiagnostic(
            ctx,
            arg,
            `${subject}: ${call} is a value the client generates, and @default sets a database default only. Write @onCreate(${call}) instead.`,
            'PSL_GENERATOR_IN_DEFAULT',
          ),
        ]);
      }
      return value.parse(arg, ctx);
    },
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

function enumMemberNames(ctx: TypeAttributeSpecContext): readonly string[] | undefined {
  const resolution = ctx.typeResolution;
  if (resolution?.kind !== 'block' || resolution.symbol.keyword !== 'enum') return undefined;
  const block = resolution.symbol;
  const names: string[] = [];
  const seen = new Set<string>();
  for (const entry of block.entries) {
    const key = entry.key()?.name();
    if (key === undefined || seen.has(key)) continue;
    seen.add(key);
    names.push(key);
  }
  return names;
}

function enumDefaultArms(
  members: readonly string[],
  enumName: string,
  isList: boolean,
): readonly [ArgType<DefaultArgValue, AttributeCtx>, ...ArgType<DefaultArgValue, AttributeCtx>[]] {
  const [first, ...rest] = members;
  if (first === undefined) return [noEnumMember()];
  const member = (name: string): ArgType<EnumMemberDefault, AttributeCtx> =>
    mapArg(
      identifier(name, { documentation: `The \`${name}\` member of enum \`${enumName}\`.` }),
      (parsed) => ({ kind: 'member', name: parsed }),
    );
  if (isList) {
    return [
      mapArg(
        list(oneOf(member(first), ...rest.map(member), nullLiteral())),
        (elements): EnumMemberListDefault => ({ kind: 'member-list', elements }),
      ),
    ];
  }
  return [member(first), ...rest.map(member)];
}

/** The spec of `@default` on a field or a type alias, offering the values its type takes. */
export function typeDefaultSpec(ctx: TypeAttributeSpecContext) {
  const members = enumMemberNames(ctx);
  const valueArms =
    members === undefined
      ? scalarDefaultArms(
          ctx.list,
          receivingDataType(ctx),
          ctx.dataTypes,
          ctx.defaultFunctionRegistry,
        )
      : enumDefaultArms(members, ctx.typeName, ctx.list);
  return typeAttribute('default', {
    documentation: 'Supplies a default value when this field is omitted from a mutation.',
    positional: [
      {
        key: 'value',
        type: defaultValueArm(
          valueArms,
          ctx.defaultFunctionRegistry,
          ctx.generatorFunctions,
          typeAttributeSubjectLabel(ctx.subject),
        ),
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

function indexModelSpec(ctx: AttributeSpecContext) {
  return modelAttribute('index', {
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
        type: optional(dataTypeValue(SQL_EXPRESSION_DATA_TYPE_ID, ctx.dataTypes)),
        documentation:
          'The SQL index expression. Requires `name` or `map` and cannot be combined with a fields list.',
      },
      where: {
        type: optional(dataTypeValue(SQL_EXPRESSION_DATA_TYPE_ID, ctx.dataTypes)),
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
}

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

function checkModelSpec(ctx: AttributeSpecContext) {
  return modelAttribute('check', {
    documentation: 'Declares a named database CHECK constraint on this table.',
    named: {
      expression: {
        type: dataTypeValue(SQL_EXPRESSION_DATA_TYPE_ID, ctx.dataTypes),
        documentation: 'The nonempty SQL predicate checked for each row.',
      },
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
      if (sqlTextFromStored(value.expression.value.value).trim().length === 0) {
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
}

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
        type: writtenScalar(str()),
        documentation:
          "The discriminator value identifying this variant, a value of the discriminator column's type.",
      },
    ],
  });
}

function relationAttributeSpan(ctx: FieldAttributeCtx): PslSpan {
  const node = getAttribute(ctx.field.attributes, 'relation')?.node;
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
      type: optional(oneOf(bool(), str())),
      documentation:
        'Whether to create an index for the relation’s foreign-key fields (`false` for none), or the name of an index, unique constraint or primary key on this model to use instead. The name is the `name` or `map` it was given, or an index’s stored name, and its first columns must be the foreign-key fields in order.',
    },
  },
  refine: relationInvariants,
});

export type SqlRelationOutput = InferAttr<typeof relationFieldSpec>;

export function modelSpecContext(input: {
  readonly symbols: SymbolTable;
  readonly model: ModelSymbol;
  readonly defaultFunctionRegistry: ControlMutationDefaultRegistry;
  readonly generatorFunctions: GeneratorFunctionRegistry;
  readonly dataTypes: DataTypeSupport;
}): AttributeSpecContext {
  return {
    symbols: input.symbols,
    model: input.model,
    defaultFunctionRegistry: input.defaultFunctionRegistry,
    generatorFunctions: input.generatorFunctions,
    dataTypes: input.dataTypes,
  };
}

export function fieldSpecContext(input: {
  readonly symbols: SymbolTable;
  readonly model: AttributeSpecContext['model'];
  readonly field: FieldSymbol;
  readonly binder: Binder;
  readonly defaultFunctionRegistry: ControlMutationDefaultRegistry;
  readonly generatorFunctions: GeneratorFunctionRegistry;
  readonly dataTypes: DataTypeSupport;
}): FieldAttributeSpecContext {
  const node = typeReferenceNode(input.field);
  const typeResolution = node === undefined ? undefined : input.binder.symbolForNode(node);
  return {
    symbols: input.symbols,
    model: input.model,
    field: input.field,
    typeResolution,
    contributedType: contributedTypeOf(typeResolution, input.binder, input.field.typeConstructor),
    defaultFunctionRegistry: input.defaultFunctionRegistry,
    generatorFunctions: input.generatorFunctions,
    dataTypes: input.dataTypes,
  };
}

/** Every entry is a factory over the spec context, whether or not its spec reads it. ADR 249. */
export const sqlAttributeSpecs = {
  model: {
    map: (_ctx: AttributeSpecContext) => mapModelSpec,
    id: (_ctx: AttributeSpecContext) => idModelSpec,
    unique: (_ctx: AttributeSpecContext) => uniqueModelSpec,
    index: indexModelSpec,
    check: checkModelSpec,
    control: (_ctx: AttributeSpecContext) => controlModelSpec,
    discriminator: (_ctx: AttributeSpecContext) => discriminatorModelSpec,
    base: (_ctx: AttributeSpecContext) => baseModelSpec(),
  },
  field: {
    map: (_ctx: FieldAttributeSpecContext) => mapFieldSpec,
    id: (_ctx: FieldAttributeSpecContext) => idFieldSpec,
    unique: (_ctx: FieldAttributeSpecContext) => uniqueFieldSpec,
    relation: (_ctx: FieldAttributeSpecContext) => relationFieldSpec,
    default: (ctx: FieldAttributeSpecContext) =>
      typeDefaultSpec(typeAttributeSpecContextOfField(ctx)),
    onCreate: generatorAttributeSpec('onCreate'),
    onUpdate: generatorAttributeSpec('onUpdate'),
  },
} as const satisfies AttributeSpecNamespace;
