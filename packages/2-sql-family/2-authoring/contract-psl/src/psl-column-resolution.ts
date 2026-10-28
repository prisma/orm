import type {
  ColumnDefaultLiteralInputValue,
  ExecutionMutationDefaultPhases,
  ExecutionMutationDefaultValue,
  ValueSetRef,
} from '@internal/contract/types';
import type {
  AuthoringArgumentDescriptor,
  AuthoringContributions,
  AuthoringEntityTypeDescriptor,
  AuthoringEntityTypeNamespace,
  AuthoringStorageTypeTemplate,
  AuthoringTypeConstructorDescriptor,
  ScalarTypeConstructorOutput,
} from '@internal/framework-components/authoring';
import {
  type DataTypeSupport,
  instantiateAuthoringTypeAlias,
  instantiateAuthoringTypeConstructor,
  isAuthoringEntityTypeDescriptor,
  readWrittenValue,
  validateAuthoringHelperArguments,
  validateAuthoringTypeParams,
  type WrittenScalar,
  type WrittenValue,
} from '@internal/framework-components/authoring';
import type {
  AnyCodecDescriptor,
  CodecLookupWithDescriptors,
} from '@internal/framework-components/codec';
import type { GeneratorFunctionRegistry } from '@internal/framework-components/components';
import {
  type ControlMutationDefaultRegistry,
  type DefaultFunctionLoweringContext,
  describeTaggedLiteralFailure,
} from '@internal/framework-components/control';
import type { ContributedPslDiagnosticCode } from '@internal/framework-components/psl-ast';
import type {
  Binder,
  BlockSymbol,
  FieldSymbol,
  ModelSymbol,
  NamedTypeSymbol,
  ParsedWrittenScalar,
  PslSpan,
  Resolution,
  ResolvedAttribute,
  ResolvedTypeConstructorCall,
  SymbolTable,
  TypeAttributeSpecContext,
} from '@internal/psl-parser';
import {
  type DiagnosticSource,
  diagnosticSource,
  nodePslSpan,
  type PslDiagnosticCollector,
  typeAttributeSpecContextOfField,
  typeAttributeSubjectLabel,
  typeGeneratorAttributeSpec,
} from '@internal/psl-parser';
import {
  isBareTypeConstructor,
  mapPslHelperArgs,
  reportTypeConstructorNotCalled,
} from '@internal/psl-parser/interpret';
import type { FieldAttributeAst, PslSources } from '@internal/psl-parser/syntax';
import { sqlCodecColumnLength } from '@internal/sql-contract/data-type';
import {
  SQL_EXPRESSION_DATA_TYPE_ID,
  SQL_EXPRESSION_TAG,
  sqlTextFromStored,
} from '@internal/sql-contract/sql-expression';
import { checkSqlDefaultText, reservedSqlDefaultText } from '@internal/sql-contract/validators';
import type {
  AuthoredColumnDefault,
  EnumTypeHandle,
} from '@internal/sql-contract-ts/contract-builder';
import { invariant } from '@internal/utils/assertions';
import { blindCast } from '@internal/utils/casts';
import { InternalError, isInternalError } from '@internal/utils/internal-error';
import { contractError } from './contract-errors';
import { type DefaultSpans, lowerDataTypeDefault } from './data-type-default';
import { lowerDefaultFunctionWithRegistry } from './default-function-registry';

import { getAttribute } from './psl-attribute-parsing';
import {
  fieldSpecContext,
  interpretTypeAttribute,
  type ParsedNullLiteral,
  typeDefaultSpec,
} from './sql-attribute-specs';
import {
  type ValueObjectTypes,
  valueObjectDefaultDocument,
  valueObjectDefaultMismatches,
} from './value-object-default';

export type ColumnDescriptor = {
  readonly codecId: string;
  readonly typeParams?: Record<string, unknown> | undefined;
  /**
   * Storage-plane value-set ref, set only by an entity-ref type constructor
   * (e.g. `pg.enum(Ref)`) resolving `Ref` against a document-local
   * value-set-deriving entity. Threaded straight onto the `StorageColumn` —
   * the emitter types such a column by its value set (`ColumnTypeOverrides`
   * in the emitted `contract.d.ts`); every other resolution path leaves it
   * unset.
   */
  readonly valueSet?: ValueSetRef;
};

function argumentSpan(
  call: ResolvedTypeConstructorCall,
  descriptors: readonly AuthoringArgumentDescriptor[] | undefined,
  index: number | undefined,
): PslSpan {
  if (index === undefined) return call.span;
  const name = descriptors?.[index]?.name;
  const named = call.args.find((arg) => arg.kind === 'named' && arg.name === name);
  const positional = call.args.filter((arg) => arg.kind === 'positional')[index];
  return (named ?? positional)?.span ?? call.span;
}

/**
 * Checks the type parameters a constructor produced against its codec's parameter schema,
 * reporting a failure at the argument the failing parameter came from. Returns whether they passed.
 */
export function checkPslTypeParams(input: {
  readonly call: ResolvedTypeConstructorCall;
  readonly subject: string;
  readonly args: readonly AuthoringArgumentDescriptor[] | undefined;
  readonly template: AuthoringStorageTypeTemplate;
  readonly typeParams: Record<string, unknown> | undefined;
  readonly codecLookup: CodecLookupWithDescriptors;
  readonly diagnostics: PslDiagnosticCollector;
  readonly source: DiagnosticSource;
}): boolean {
  const helperPath = input.call.path.join('.');
  try {
    validateAuthoringTypeParams(
      helperPath,
      input.template,
      input.typeParams,
      input.codecLookup.descriptorFor(input.template.codecId)?.paramsSchema,
    );
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    input.diagnostics.push({
      code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
      message: `${input.subject} ${message}`,
      ...input.source.at(argumentSpan(input.call, input.args, argumentIndexOf(error))),
    });
    return false;
  }
}

function argumentIndexOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('details' in error)) return undefined;
  const { details } = error;
  if (typeof details !== 'object' || details === null || !('argumentIndex' in details)) {
    return undefined;
  }
  return typeof details.argumentIndex === 'number' ? details.argumentIndex : undefined;
}

/**
 * Walks `authoringContributions.entityTypes` segment-by-segment and returns
 * the entity type descriptor at the resolved path, or `undefined` if no
 * descriptor is registered.
 *
 * Used by the PSL interpreter to dispatch declarative entity-shaped
 * declarations (`enum`, future `namespace { … }`, …) through the
 * pack entity-type mechanism — the descriptor's `factory` (or
 * `template`) materialises the IR-class instance without the
 * interpreter knowing target-specific construction.
 */
export function getAuthoringEntity(
  contributions: AuthoringContributions | undefined,
  path: readonly string[],
): AuthoringEntityTypeDescriptor | undefined {
  let current: AuthoringEntityTypeDescriptor | AuthoringEntityTypeNamespace | undefined =
    contributions?.entityTypes;

  for (const segment of path) {
    if (typeof current !== 'object' || current === null || 'kind' in current) {
      return undefined;
    }
    current = current[segment];
  }

  return current !== undefined && isAuthoringEntityTypeDescriptor(current) ? current : undefined;
}

export function instantiatePslTypeConstructor(input: {
  readonly call: ResolvedTypeConstructorCall;
  readonly descriptor: AuthoringTypeConstructorDescriptor;
  readonly codecLookup: CodecLookupWithDescriptors;
  readonly diagnostics: PslDiagnosticCollector;
  readonly source: DiagnosticSource;
  readonly entityLabel: string;
  readonly dataTypes: DataTypeSupport;
}): ScalarTypeConstructorOutput | undefined {
  const helperPath = input.call.path.join('.');
  const args = mapPslHelperArgs({
    args: input.call.args,
    descriptors: input.descriptor.args ?? [],
    helperLabel: `constructor "${helperPath}"`,
    span: input.call.span,
    diagnostics: input.diagnostics,
    source: input.source,
    entityLabel: input.entityLabel,
    dataTypes: input.dataTypes,
  });
  if (!args) {
    return undefined;
  }

  let output: ScalarTypeConstructorOutput;
  try {
    validateAuthoringHelperArguments(helperPath, input.descriptor.args, args);
    output = instantiateAuthoringTypeConstructor(input.descriptor, args);
  } catch (error) {
    if (isInternalError(error)) throw error;
    const message = error instanceof Error ? error.message : String(error);
    input.diagnostics.push({
      code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
      message: `${input.entityLabel} constructor "${helperPath}" ${message}`,
      ...input.source.at(input.call.span),
    });
    return undefined;
  }
  const passed = checkPslTypeParams({
    call: input.call,
    subject: `${input.entityLabel} constructor "${helperPath}"`,
    args: input.descriptor.args,
    template: input.descriptor.output,
    typeParams: output.typeParams,
    codecLookup: input.codecLookup,
    diagnostics: input.diagnostics,
    source: input.source,
  });
  return passed ? output : undefined;
}

/**
 * Result of a codec descriptor's `columnFromEntity` authoring hook — the
 * per-column params derived from the entity a type constructor's
 * `entityRefArg` resolved to.
 */
interface EntityRefColumnFromEntityResult {
  readonly typeParams?: Record<string, unknown>;
}

interface EntityRefResolvingCodecDescriptor extends AnyCodecDescriptor {
  readonly columnFromEntity: (entity: unknown) => EntityRefColumnFromEntityResult | undefined;
}

/**
 * Structural check for a codec descriptor exposing the authoring-time
 * `columnFromEntity` hook a type constructor's `entityRefArg` resolves
 * through (e.g. the `pg/enum@1` codec descriptor). No casts.
 */
function hasColumnFromEntityHook(
  descriptor: AnyCodecDescriptor,
): descriptor is EntityRefResolvingCodecDescriptor {
  return 'columnFromEntity' in descriptor && typeof descriptor.columnFromEntity === 'function';
}

/**
 * Resolves a type-constructor call whose descriptor declares an
 * `entityRefArg` (e.g. `pg.enum(AalLevel)`): extracts the call's sole
 * positional-argument ref string, resolves it against the field's
 * namespace's already-lowered extension entities (keyed by the declared
 * `entityRefArg.entityKind`, then block name), and converts the resolved
 * entity to column params via the `columnFromEntity` authoring hook on the
 * codec descriptor registered for `descriptor.output.codecId`. The
 * `typeParams.typeName` `columnFromEntity` returns is bare — schema
 * qualification (e.g. `auth.aal_level`) is a target concern, applied later
 * when the target builds the field's namespace. A `valueSet` ref is
 * attached when the same namespace derived a value-set under the same block
 * name (the generic `deriveValueSet` mechanism), scoped to the field's own
 * namespace.
 */
function resolveEntityRefTypeConstructorCall(input: {
  readonly call: ResolvedTypeConstructorCall;
  readonly descriptor: AuthoringTypeConstructorDescriptor;
  readonly namespaceId: string | undefined;
  readonly namespaceExtensionEntities:
    | ReadonlyMap<string, Readonly<Record<string, Readonly<Record<string, unknown>>>>>
    | undefined;
  readonly binder: Binder | undefined;
  readonly codecLookup: CodecLookupWithDescriptors;
  readonly diagnostics: PslDiagnosticCollector;
  readonly source: DiagnosticSource;
  readonly entityLabel: string;
}): ResolveFieldTypeResult {
  const entityRefArg = input.descriptor.entityRefArg;
  if (entityRefArg === undefined) {
    throw new InternalError(
      'resolveEntityRefTypeConstructorCall called with a descriptor that does not declare an entityRefArg. This is an interpreter bug.',
    );
  }

  const helperPath = input.call.path.join('.');
  const positionalArgs = input.call.args.filter((arg) => arg.kind === 'positional');
  const argument = positionalArgs[entityRefArg.index];
  const ref = argument?.value;
  const node = argument?.expression?.syntax;
  const resolution = node === undefined ? undefined : input.binder?.symbolForNode(node);
  if (
    input.call.args.length !== 1 ||
    positionalArgs.length !== 1 ||
    ref === undefined ||
    (input.binder !== undefined && resolution === undefined)
  ) {
    input.diagnostics.push({
      code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
      message: `${input.entityLabel} type constructor "${helperPath}" expects exactly one positional argument naming the referenced entity`,
      ...input.source.at(input.call.span),
    });
    return NOT_RESOLVED;
  }

  let entityName = ref;
  let entityNamespaceId = input.namespaceId;
  const reportUnknownRef = (): ResolveFieldTypeResult => {
    input.diagnostics.push({
      code: 'PSL_UNKNOWN_ENTITY_REF',
      message: `${input.entityLabel} type constructor "${helperPath}(${ref})" does not resolve — no entity named "${ref}" was found in namespace "${entityNamespaceId ?? '(unspecified)'}"`,
      ...input.source.at(input.call.span),
    });
    return NOT_RESOLVED;
  };

  if (resolution !== undefined) {
    if (resolution.kind === 'unresolved') return NOT_RESOLVED;
    if (resolution.kind !== 'block') return reportUnknownRef();
    entityName = resolution.symbol.name;
    entityNamespaceId = resolution.namespace.id;
  }
  const entities =
    entityNamespaceId === undefined
      ? undefined
      : input.namespaceExtensionEntities?.get(entityNamespaceId);

  const entity = entities?.[entityRefArg.entityKind]?.[entityName];
  if (entity === undefined) {
    return reportUnknownRef();
  }

  const codecId = input.descriptor.output.codecId;
  const codecDescriptor = input.codecLookup.descriptorFor(codecId);
  if (codecDescriptor === undefined || !hasColumnFromEntityHook(codecDescriptor)) {
    throw contractError(
      'CONTRACT.PACK_CONTRIBUTION_INVALID',
      `Type constructor "${helperPath}" registers codecId "${codecId}" with an entity-ref argument, but its codec descriptor has no "columnFromEntity" authoring hook. This is a contributor bug in the pack registering "${helperPath}", not a user-schema error.`,
      { meta: { helperPath, codecId } },
    );
  }

  const resolved = codecDescriptor.columnFromEntity(entity);
  if (resolved === undefined) {
    return reportUnknownRef();
  }

  const derivedValueSet = entities?.['valueSet']?.[entityName];
  const valueSet: ValueSetRef | undefined =
    derivedValueSet !== undefined && entityNamespaceId !== undefined
      ? {
          plane: 'storage',
          entityKind: 'valueSet',
          namespaceId: entityNamespaceId,
          entityName,
        }
      : undefined;

  return {
    ok: true,
    descriptor: {
      codecId,
      ...(resolved.typeParams !== undefined ? { typeParams: resolved.typeParams } : {}),
      ...(valueSet !== undefined ? { valueSet } : {}),
    },
  };
}

export type ResolveFieldTypeResult =
  | { readonly ok: true; readonly descriptor: ColumnDescriptor }
  | { readonly ok: false };

const NOT_RESOLVED: ResolveFieldTypeResult = { ok: false };

interface FieldTypeConstructorContext {
  readonly diagnostics: PslDiagnosticCollector;
  readonly source: DiagnosticSource;
  readonly entityLabel: string;
  /** The stack's data types, which a type constructor's value arguments are read as. */
  readonly dataTypes: DataTypeSupport;
  /**
   * The field's namespace id — required to build a `valueSet` ref (`{
   * namespaceId, entityName, … }`) when an entity-ref type constructor
   * resolves the field's type. Storage value-sets are namespace-scoped, so
   * the ref must point at the value-set derived in the SAME namespace the
   * field's own column lives in.
   */
  readonly namespaceId?: string | undefined;
  /**
   * Extension entities already lowered (the exact shape
   * `lowerExtensionBlocksForNamespace` in the interpreter produces), keyed
   * by namespace id, then entries-slot discriminator, then block name.
   * Consulted only when a type constructor's descriptor declares an
   * `entityRefArg` (e.g. `pg.enum(Ref)`); every other resolution path
   * ignores it.
   */
  readonly namespaceExtensionEntities?:
    | ReadonlyMap<string, Readonly<Record<string, Readonly<Record<string, unknown>>>>>
    | undefined;
  readonly binder?: Binder | undefined;
  /**
   * Codec-id-keyed descriptor lookup — consulted only when a type
   * constructor's descriptor declares an `entityRefArg`, to reach the
   * registered codec's `columnFromEntity` authoring hook.
   */
  readonly codecLookup: CodecLookupWithDescriptors;
}

export function instantiateFieldTypeConstructor(
  input: FieldTypeConstructorContext & {
    readonly call: ResolvedTypeConstructorCall;
    readonly descriptor: AuthoringTypeConstructorDescriptor;
  },
): ResolveFieldTypeResult {
  if (input.descriptor.entityRefArg !== undefined) {
    return resolveEntityRefTypeConstructorCall({
      call: input.call,
      descriptor: input.descriptor,
      namespaceId: input.namespaceId,
      namespaceExtensionEntities: input.namespaceExtensionEntities,
      binder: input.binder,
      codecLookup: input.codecLookup,
      diagnostics: input.diagnostics,
      source: input.source,
      entityLabel: input.entityLabel,
    });
  }
  const instantiated = instantiatePslTypeConstructor({
    call: input.call,
    descriptor: input.descriptor,
    codecLookup: input.codecLookup,
    diagnostics: input.diagnostics,
    source: input.source,
    entityLabel: input.entityLabel,
    dataTypes: input.dataTypes,
  });
  return instantiated === undefined ? NOT_RESOLVED : { ok: true, descriptor: instantiated };
}

function resolvedKindLabel(resolution: Resolution): string {
  switch (resolution.kind) {
    case 'compositeType':
      return 'composite type';
    case 'namedType':
      return 'type alias';
    case 'block':
      return resolution.symbol.keyword;
    case 'crossSpace':
      return 'type of another contract space';
    default:
      return resolution.kind;
  }
}

export function resolveFieldTypeDescriptor(
  input: Omit<FieldTypeConstructorContext, 'source'> & {
    readonly field: FieldSymbol;
    readonly resolution: Resolution | undefined;
    readonly enumTypeDescriptors: ReadonlyMap<BlockSymbol, ColumnDescriptor>;
    readonly typeAliases: {
      get(symbol: NamedTypeSymbol): { readonly descriptor: ColumnDescriptor } | undefined;
    };
    readonly sources: PslSources;
  },
): ResolveFieldTypeResult {
  const { field, resolution, entityLabel, diagnostics } = input;
  if (field.malformedType || resolution === undefined) {
    return NOT_RESOLVED;
  }
  const source = diagnosticSource(input.sources, field.node.syntax);
  const unsupported = (message: string): ResolveFieldTypeResult => {
    diagnostics.push({ code: 'PSL_UNSUPPORTED_FIELD_TYPE', message, ...source.at(field.span) });
    return NOT_RESOLVED;
  };
  const call = field.typeConstructor;

  switch (resolution.kind) {
    case 'unresolved':
    case 'namespace':
    case 'contributedNamespace':
    case 'mixin':
      return NOT_RESOLVED;
    case 'contributedType': {
      const { descriptor, path } = resolution.symbol;
      const written = path.join('.');
      if (descriptor.kind === 'typeAlias') {
        if (call !== undefined) {
          diagnostics.push({
            code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
            message: `${written} is a type alias and takes no arguments.`,
            ...source.at(call.span),
          });
          return NOT_RESOLVED;
        }
        return { ok: true, descriptor: instantiateAuthoringTypeAlias(descriptor).type };
      }
      if (call !== undefined) {
        return instantiateFieldTypeConstructor({ ...input, call, descriptor, source });
      }
      if (!isBareTypeConstructor(descriptor)) {
        reportTypeConstructorNotCalled({
          entityLabel,
          path: written,
          descriptor,
          source,
          span: field.span,
          diagnostics,
        });
        return NOT_RESOLVED;
      }
      return { ok: true, descriptor: instantiateAuthoringTypeConstructor(descriptor, []) };
    }
    case 'field':
    case 'attribute':
    case 'parameter':
    case 'function':
    case 'constant':
      throw new InternalError(
        `The type of ${entityLabel} resolved to a ${resolution.kind}; a type reference never names one. This is a binder bug.`,
      );
  }

  if (call !== undefined) {
    return unsupported(
      `${entityLabel} calls "${call.path.join('.')}", which is a ${resolvedKindLabel(resolution)}, not a type constructor. Remove the arguments.`,
    );
  }

  switch (resolution.kind) {
    case 'namedType': {
      const alias = input.typeAliases.get(resolution.symbol);
      return alias === undefined ? NOT_RESOLVED : { ok: true, descriptor: alias.descriptor };
    }
    case 'block': {
      if (resolution.symbol.keyword !== 'enum') {
        return unsupported(
          `${entityLabel} is typed by the ${resolution.symbol.keyword} "${resolution.symbol.name}", which is not a column type.`,
        );
      }
      const descriptor = input.enumTypeDescriptors.get(resolution.symbol);
      return descriptor === undefined ? NOT_RESOLVED : { ok: true, descriptor };
    }
    case 'model':
    case 'compositeType':
      return unsupported(
        `${entityLabel} is typed by the ${resolvedKindLabel(resolution)} "${resolution.symbol.name}", which is not a column type.`,
      );
    case 'crossSpace':
      return unsupported(
        `${entityLabel} type "${field.typeName}" is a type of contract space "${field.typeContractSpaceId}"; only a relation field can name a type of another contract space.`,
      );
  }
}

const PSL_INVALID_DEFAULT_SQL: ContributedPslDiagnosticCode = 'PSL_INVALID_DEFAULT_SQL';

const TAGGED_LITERAL_CANONICALIZATION_CODES = {
  nul: 'PSL_TAGGED_LITERAL_NUL',
  'too-large': 'PSL_TAGGED_LITERAL_TOO_LARGE',
} as const;

/**
 * Refuses a `null` element in the list default of a field whose list elements are not nullable,
 * at the first `null`. Returns whether it refused.
 */
export function rejectStrictListNullDefault(input: {
  readonly owner: TypeAttributeOwner;
  readonly elements: readonly { readonly kind: string }[];
  readonly source: DiagnosticSource;
  readonly diagnostics: PslDiagnosticCollector;
}): boolean {
  if (input.owner.elementOptional) return false;
  const nullElement = input.elements.find(isParsedNullLiteral);
  if (nullElement === undefined) return false;
  input.diagnostics.push({
    code: 'PSL_INVALID_DEFAULT_APPLICABILITY',
    message: `${typeAttributeSubjectLabel(input.owner.specContext.subject)} has strict list elements and cannot use null in a literal list default. Make the element type nullable or remove null from the default.`,
    ...input.source.at(nullElement.span),
  });
  return true;
}

function isParsedNullLiteral(element: { readonly kind: string }): element is ParsedNullLiteral {
  return element.kind === 'null';
}

/** Where `@default`, `@onCreate` and `@onUpdate` are written: a field, or a type alias whose fields take them. */
export interface TypeAttributeOwner {
  readonly attributes: readonly ResolvedAttribute<FieldAttributeAst>[];
  readonly optional: boolean;
  readonly list: boolean;
  readonly elementOptional: boolean;
  readonly specContext: TypeAttributeSpecContext;
  /** The names a default function is lowered for: the model and field, or `types` and the alias. */
  readonly loweringNames: { readonly modelName: string; readonly fieldName: string };
}

export function fieldAttributeOwner(input: {
  readonly field: FieldSymbol;
  readonly model: ModelSymbol;
  readonly symbolTable: SymbolTable;
  readonly binder: Binder;
  readonly defaultFunctionRegistry: ControlMutationDefaultRegistry;
  readonly generatorFunctions: GeneratorFunctionRegistry;
  readonly dataTypes: DataTypeSupport;
}): TypeAttributeOwner {
  const { field, model } = input;
  return {
    attributes: field.attributes,
    optional: field.optional,
    list: field.list,
    elementOptional: field.elementOptional,
    specContext: typeAttributeSpecContextOfField(
      fieldSpecContext({
        symbols: input.symbolTable,
        model,
        field,
        binder: input.binder,
        defaultFunctionRegistry: input.defaultFunctionRegistry,
        generatorFunctions: input.generatorFunctions,
        dataTypes: input.dataTypes,
      }),
    ),
    loweringNames: { modelName: model.name, fieldName: field.name },
  };
}

export function lowerDefaultForField(input: {
  readonly modelName: string;
  readonly fieldName: string;
  readonly field: FieldSymbol;
  readonly model: ModelSymbol;
  readonly symbolTable: SymbolTable;
  readonly sources: PslSources;
  readonly binder: Binder;
  readonly columnDescriptor: ColumnDescriptor;
  readonly columnTypeParams: Record<string, unknown> | undefined;
  /** Whether the field is stored in a list column. A list of value objects is not: its one column holds the whole list as one JSON array. */
  readonly isListColumn: boolean;
  /** For a field typed by a value object, the value objects a literal default is checked against. */
  readonly valueObjectDefault:
    | { readonly valueObjectName: string; readonly types: ValueObjectTypes }
    | undefined;
  readonly defaultFunctionRegistry: ControlMutationDefaultRegistry;
  readonly generatorFunctions: GeneratorFunctionRegistry;
  readonly dataTypes: DataTypeSupport;
  readonly codecLookup: CodecLookupWithDescriptors;
  readonly diagnostics: PslDiagnosticCollector;
}): { readonly defaultValue?: AuthoredColumnDefault } {
  return lowerTypeDefault({ ...input, owner: fieldAttributeOwner(input) });
}

/** The default a field's or type alias's `@default(...)` lowers to for its column. */
export function lowerTypeDefault(input: {
  readonly owner: TypeAttributeOwner;
  readonly symbolTable: SymbolTable;
  readonly sources: PslSources;
  readonly binder: Binder;
  readonly columnDescriptor: ColumnDescriptor;
  readonly columnTypeParams: Record<string, unknown> | undefined;
  /** Whether the column holds a list. A list of value objects is not: its one column holds the whole list as one JSON array. */
  readonly isListColumn: boolean;
  /** For a field typed by a value object, the value objects a literal default is checked against. */
  readonly valueObjectDefault:
    | { readonly valueObjectName: string; readonly types: ValueObjectTypes }
    | undefined;
  readonly defaultFunctionRegistry: ControlMutationDefaultRegistry;
  readonly dataTypes: DataTypeSupport;
  readonly codecLookup: CodecLookupWithDescriptors;
  readonly diagnostics: PslDiagnosticCollector;
}): { readonly defaultValue?: AuthoredColumnDefault } {
  const node = getAttribute(input.owner.attributes, 'default')?.node;
  if (node === undefined) return {};
  const source = diagnosticSource(input.sources, node.syntax);
  const subject = typeAttributeSubjectLabel(input.owner.specContext.subject);
  const interpreted = interpretTypeAttribute({
    symbols: input.symbolTable,
    node,
    spec: typeDefaultSpec(input.owner.specContext),
    sources: input.sources,
    binder: input.binder,
    diagnostics: input.diagnostics,
  });
  if (interpreted === undefined) return {};
  const value = interpreted.value;
  const attributeSpan = nodePslSpan(node.syntax, input.sources);
  if (value.kind === 'null') {
    if (!input.owner.optional) {
      input.diagnostics.push({
        code: 'PSL_INVALID_DEFAULT_APPLICABILITY',
        message: `${subject} is non-nullable and cannot use null as its literal default. Make the field nullable or use a non-null default.`,
        ...source.at(),
      });
      return {};
    }
    return { defaultValue: { kind: 'literal', value: null, inStoredForm: true } };
  }
  if (
    value.kind === 'list' &&
    rejectStrictListNullDefault({ ...input, elements: value.elements, source })
  )
    return {};
  // A list of value objects is stored in one column whose value is the whole list: a list literal
  // fills it element by element, as it fills a list column, and any other literal is read as the
  // whole value.
  const readsListElements = (written: WrittenValue) =>
    input.isListColumn || (input.owner.list && written.kind === 'list');
  const readAsLiteral = (
    written: WrittenValue,
    spans: DefaultSpans,
    sourceElementIndexes?: readonly number[],
  ) => {
    const lowered = lowerDataTypeDefault({
      written,
      spans,
      sourceElementIndexes,
      isList: readsListElements(written),
      column: { codecId: input.columnDescriptor.codecId, typeParams: input.columnTypeParams },
      codecLookup: input.codecLookup,
      dataTypes: input.dataTypes,
      subject,
    });
    if (!lowered.ok) {
      input.diagnostics.push({
        code: lowered.code,
        message: lowered.message,
        ...source.at(lowered.span),
      });
      return {};
    }
    let restoredValue = lowered.value;
    if (
      value.kind === 'list' &&
      value.elements.some(isParsedNullLiteral) &&
      Array.isArray(lowered.value)
    ) {
      let index = 0;
      const nonNullValues = lowered.value;
      restoredValue = value.elements.map((element) =>
        element.kind === 'null' ? null : (nonNullValues[index++] ?? null),
      );
    }
    if (input.valueObjectDefault !== undefined) {
      const { document, stored } = valueObjectDefaultDocument({
        stored: restoredValue,
        elementwise: readsListElements(written) && !input.isListColumn,
        codecId: input.columnDescriptor.codecId,
        codecLookup: input.codecLookup,
      });
      const mismatches = valueObjectDefaultMismatches({
        fieldPath: input.owner.specContext.subject.name,
        value: document,
        list: input.owner.list,
        nullable: input.owner.optional,
        elementNullable: input.owner.elementOptional,
        ...input.valueObjectDefault,
        lookups: { codecLookup: input.codecLookup, dataTypeLookup: input.dataTypes.lookup },
      });
      for (const { code, message } of mismatches) {
        input.diagnostics.push({ code, message, ...source.at() });
      }
      if (mismatches.length > 0) return {};
      return { defaultValue: { kind: 'literal' as const, value: stored, inStoredForm: true } };
    }
    return { defaultValue: { kind: 'literal' as const, value: restoredValue, inStoredForm: true } };
  };

  const canonicalized = (scalar: ParsedWrittenScalar): WrittenScalar | undefined => {
    if (scalar.written !== undefined) return scalar.written;
    input.diagnostics.push({
      code: TAGGED_LITERAL_CANONICALIZATION_CODES[scalar.reason],
      message: describeTaggedLiteralFailure(scalar.reason),
      ...source.at(scalar.span),
    });
    return undefined;
  };

  const sqlExpressionDefault = (text: string, span: PslSpan) => {
    const reserved = reservedSqlDefaultText(text);
    const refusal =
      reserved === undefined
        ? checkSqlDefaultText(text)
        : `Write @default(${reserved}()) instead of ${SQL_EXPRESSION_TAG}\`${reserved}()\`; ${reserved}() is a Prisma default function, not raw SQL.`;
    if (refusal !== undefined) {
      input.diagnostics.push({
        code: PSL_INVALID_DEFAULT_SQL,
        message: refusal,
        ...source.at(span),
      });
      return {};
    }
    return { defaultValue: { kind: 'function' as const, expression: text } };
  };

  // An enum member identifier or list of them is lowered against its enum's handle, which a field without one lacks.
  if (value.kind === 'member' || value.kind === 'member-list') return {};

  // A column bound to a value set (`pg.enum(Ref)`) takes member names, which are checked against the
  // value set rather than read as literals; its codec accepts no literal default at all.
  if (input.columnDescriptor.valueSet !== undefined) {
    const memberName = (element: ParsedWrittenScalar | ParsedNullLiteral) =>
      element.kind === 'scalar' && element.written?.kind === 'string'
        ? element.written.text
        : undefined;
    if (value.kind === 'scalar') {
      const member = memberName(value);
      if (member !== undefined) return { defaultValue: { kind: 'literal', value: member } };
    }
    if (value.kind === 'list') {
      const members = value.elements.map((element) =>
        element.kind === 'null' ? null : memberName(element),
      );
      if (members.every((member) => member !== undefined)) {
        return { defaultValue: { kind: 'literal', value: members } };
      }
    }
  }

  if (value.kind === 'list') {
    const elements: WrittenValue[] = [];
    const sourceElementIndexes: number[] = [];
    for (const [sourceIndex, element] of value.elements.entries()) {
      if (element.kind === 'null') continue;
      const written = canonicalized(element);
      if (written === undefined) return {};
      elements.push(written);
      sourceElementIndexes.push(sourceIndex);
    }
    return readAsLiteral(
      { kind: 'list', elements },
      {
        attribute: attributeSpan,
        value: value.span,
        elements: value.elements.map((element) => element.span),
      },
      sourceElementIndexes,
    );
  }

  if (value.kind === 'scalar') {
    const written = canonicalized(value);
    if (written === undefined) return {};
    const spans = { attribute: attributeSpan, value: value.span, elements: [] };
    if (written.kind !== 'tag') return readAsLiteral(written, spans);
    const read = readWrittenValue(input.dataTypes, written);
    if (read.ok && read.value.type === SQL_EXPRESSION_DATA_TYPE_ID) {
      return sqlExpressionDefault(sqlTextFromStored(read.value.value), value.span);
    }
    return readAsLiteral(written, spans);
  }

  const { call } = value;
  const context: DefaultFunctionLoweringContext = {
    sourceId: input.sources.sourceFileFor(node.syntax).filename,
    ...input.owner.loweringNames,
    columnCodecId: input.columnDescriptor.codecId,
  };
  const lowered = lowerDefaultFunctionWithRegistry({
    call,
    registry: input.defaultFunctionRegistry,
    context,
    source,
  });

  if (!lowered.ok) {
    if (lowered.kind === 'owned') input.diagnostics.push(lowered.diagnostic);
    else input.diagnostics.pushExternal(lowered.diagnostic);
    return {};
  }

  return { defaultValue: lowered.value.defaultValue };
}

const GENERATOR_PHASES = ['onCreate', 'onUpdate'] as const;

/** The generators a field's `@onCreate(fn())` and `@onUpdate(fn())` resolve to for its column, or `undefined` for a field with neither. */
export function lowerGeneratorAttributesForField(input: {
  readonly modelName: string;
  readonly fieldName: string;
  readonly field: FieldSymbol;
  readonly model: ModelSymbol;
  readonly symbolTable: SymbolTable;
  readonly sources: PslSources;
  readonly binder: Binder;
  readonly columnDescriptor: ColumnDescriptor;
  readonly columnTypeParams: Record<string, unknown> | undefined;
  readonly defaultFunctionRegistry: ControlMutationDefaultRegistry;
  readonly generatorFunctions: GeneratorFunctionRegistry;
  readonly dataTypes: DataTypeSupport;
  readonly diagnostics: PslDiagnosticCollector;
}): ExecutionMutationDefaultPhases | undefined {
  return lowerTypeGenerators({ ...input, owner: fieldAttributeOwner(input) });
}

/** The generators the `@onCreate(fn())` and `@onUpdate(fn())` of a field or type alias resolve to for its column, or `undefined` when it has neither. */
export function lowerTypeGenerators(input: {
  readonly owner: TypeAttributeOwner;
  readonly symbolTable: SymbolTable;
  readonly sources: PslSources;
  readonly binder: Binder;
  readonly columnDescriptor: ColumnDescriptor;
  readonly columnTypeParams: Record<string, unknown> | undefined;
  readonly generatorFunctions: GeneratorFunctionRegistry;
  readonly dataTypes: DataTypeSupport;
  readonly diagnostics: PslDiagnosticCollector;
}): ExecutionMutationDefaultPhases | undefined {
  const { subject } = input.owner.specContext;
  const label = typeAttributeSubjectLabel(subject);
  const phases: {
    onCreate?: ExecutionMutationDefaultValue;
    onUpdate?: ExecutionMutationDefaultValue;
  } = {};
  for (const phase of GENERATOR_PHASES) {
    const [attribute, duplicate] = input.owner.attributes.filter(({ name }) => name === phase);
    if (attribute === undefined) continue;
    if (duplicate !== undefined) {
      input.diagnostics.push({
        code: 'PSL_DUPLICATE_ATTRIBUTE',
        message: `\`@${phase}\` declared more than once on ${subject.kind} "${subject.name}".`,
        ...diagnosticSource(input.sources, duplicate.node.syntax).at(duplicate.span),
      });
      continue;
    }
    const node = attribute.node;
    const interpreted = interpretTypeAttribute({
      symbols: input.symbolTable,
      node,
      spec: typeGeneratorAttributeSpec(phase, input.owner.specContext),
      sources: input.sources,
      binder: input.binder,
      diagnostics: input.diagnostics,
    });
    if (interpreted === undefined) continue;
    const call = interpreted.value;
    const resolution = input.generatorFunctions.resolve(
      { name: call.fn, args: call.args },
      {
        codecId: input.columnDescriptor.codecId,
        typeParams: input.columnTypeParams,
        length: sqlCodecColumnLength(
          input.dataTypes,
          input.columnDescriptor.codecId,
          input.columnTypeParams,
        ),
      },
    );
    if (resolution.ok) {
      phases[phase] = resolution.generator;
      continue;
    }
    input.diagnostics.push({
      code: 'PSL_GENERATOR_NOT_APPLICABLE',
      message:
        resolution.reason === 'refused'
          ? `${label}: ${resolution.message}`
          : `${label}: ${call.fn}() does not apply to codec "${input.columnDescriptor.codecId}".`,
      ...diagnosticSource(input.sources, node.syntax).at(call.span),
    });
  }
  return phases.onCreate === undefined && phases.onUpdate === undefined ? undefined : phases;
}

type LoweredEnumDefault = { readonly defaultValue?: AuthoredColumnDefault };

/** The default a field's or type alias's `@default(...)` names among the members of its enum. */
export function lowerEnumDefault(input: {
  readonly owner: TypeAttributeOwner;
  readonly symbolTable: SymbolTable;
  readonly sources: PslSources;
  readonly binder: Binder;
  readonly enumHandle: EnumTypeHandle;
  readonly diagnostics: PslDiagnosticCollector;
}): LoweredEnumDefault {
  const { owner, enumHandle, diagnostics } = input;
  const node = getAttribute(owner.attributes, 'default')?.node;
  if (node === undefined) return {};
  if (enumHandle.enumMembers.length === 0) return {};
  const interpreted = interpretTypeAttribute({
    node,
    spec: typeDefaultSpec(owner.specContext),
    symbols: input.symbolTable,
    sources: input.sources,
    binder: input.binder,
    diagnostics,
  });
  if (interpreted === undefined) return {};
  const member = interpreted.value;
  if (member.kind === 'member-list') {
    if (
      rejectStrictListNullDefault({
        owner,
        elements: member.elements,
        source: diagnosticSource(input.sources, node.syntax),
        diagnostics,
      })
    )
      return {};
    const values = member.elements.map((entry) =>
      entry.kind === 'null'
        ? null
        : enumHandle.enumMembers.find((candidate) => candidate.name === entry.name)?.value,
    );
    return {
      defaultValue: {
        kind: 'literal',
        value: blindCast<
          ColumnDefaultLiteralInputValue,
          'enum member values are codec-validated JsonValue-compatible scalars'
        >(values),
      },
    };
  }
  invariant(member.kind === 'member', 'the enum @default grammar admits only member identifiers');
  const match = enumHandle.enumMembers.find((m) => m.name === member.name);
  if (!match) return {};

  return {
    defaultValue: {
      kind: 'literal',
      value: blindCast<
        ColumnDefaultLiteralInputValue,
        'enum member values are codec-validated JsonValue-compatible scalars'
      >(match.value),
    },
  };
}
