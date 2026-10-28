import type {
  ContractSourceDiagnostic,
  ContractSourceDiagnostics,
} from '@internal/config/config-types';
import type {
  Contract,
  ContractField,
  ContractReferenceRelation,
  ExecutionMutationDefaultPhases,
  ExecutionMutationDefaultValue,
  ValueSetRef,
} from '@internal/contract/types';
import { type EnumTypeHandle, resolveToOneRelationNullable } from '@internal/contract-authoring';
import type {
  AuthoringContributions,
  AuthoringEntityContext,
  AuthoringTypeConstructorDescriptor,
  DataTypeSupport,
  ParsedPslExtensionBlock,
  WrittenValue,
} from '@internal/framework-components/authoring';
import {
  instantiateAuthoringEntityType,
  isAuthoringEntityTypeDescriptor,
} from '@internal/framework-components/authoring';
import type { CodecLookupWithDescriptors } from '@internal/framework-components/codec';
import type {
  ExtensionPackRef,
  GeneratorFunctionRegistry,
  TargetPackRef,
} from '@internal/framework-components/components';
import type { ControlMutationDefaultRegistry } from '@internal/framework-components/control';
import {
  DOCUMENT_ID,
  type MongoIndexKeyDirection,
  type MongoIndexOptionsInput,
} from '@internal/mongo-contract';
import {
  type BuildRefusal,
  buildMongoContractFromDefinition,
  type ContractDefinition,
  type FieldNode,
  type IndexNode,
  type ModelNode,
  type RelationNode,
  type ValueObjectNode,
} from '@internal/mongo-contract-ts/contract-builder';
import type {
  AttributeSpecContext,
  Binder,
  BlockSymbol,
  CompositeTypeSymbol,
  FieldAttributeSpecContext,
  FieldSymbol,
  InferAttr,
  ModelSymbol,
  NamespaceSymbol,
  ParsedWrittenScalar,
  PslSpan,
  Resolution,
  SymbolTable,
} from '@internal/psl-parser';
import {
  contributedTypeOf,
  createPslDiagnosticCollector,
  type DiagnosticSource,
  diagnosticSource,
  interpretExtensionBlocks,
  mapPslDiagnostics,
  nodePslSpan,
  type PslDiagnosticCollector,
  refuseRepeatedTypeAliasAttributes,
  typeAttributeSpecContextOfField,
  typeReferenceNode,
} from '@internal/psl-parser';
import {
  claimedBlockKeywords,
  enumMemberAttributeDiagnostics,
  fkRelationPairKey,
  type InvalidFkPairing,
  isBareTypeConstructor,
  reportTypeConstructorNotCalled,
  unsupportedBlockDiagnostic,
} from '@internal/psl-parser/interpret';
import {
  ArrayLiteralAst,
  type DocumentAst,
  FunctionCallAst,
  type ModelAttributeAst,
  PathExprAst,
  type PslSources,
  type SyntaxNode,
} from '@internal/psl-parser/syntax';
import { assertDefined, invariant } from '@internal/utils/assertions';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import { notOk, ok, type Result } from '@internal/utils/result';
import {
  interpretFieldAttribute,
  interpretModelAttribute,
  mongoAttributeSpecs,
} from './mongo-attribute-specs';
import {
  type MongoBackRelationCandidate,
  type MongoForeignKeyRelation,
  pairMongoBackRelations,
} from './pair-back-relations';
import { defaultCollectionName, getAttribute } from './psl-helpers';
import {
  type EnumSite,
  type FieldSite,
  fieldSiteKey,
  type ModelSites,
  refusalDiagnostic,
  type SchemaSites,
  type Site,
} from './refusal-diagnostics';
import {
  lowerGeneratorAttribute,
  type ResolvedTypeAlias,
  type ResolvedTypeAliases,
  resolveMongoTypeAliases,
  scalarTypeOfConstructor,
} from './type-aliases';

export interface InterpretPslDocumentToMongoContractInput {
  readonly documents: readonly DocumentAst[];
  readonly symbolTable: SymbolTable;
  readonly sources: PslSources;
  readonly binder: Binder;
  /** The target and extension packs of the stack, which the contract records. */
  readonly target: TargetPackRef<'mongo', string>;
  readonly extensionPacks?: Readonly<Record<string, ExtensionPackRef<string, string>>>;
  readonly defaultFunctionRegistry: ControlMutationDefaultRegistry;
  /** The stack's generator functions, which `@onCreate(fn())` and `@onUpdate(fn())` resolve through. */
  readonly generatorFunctions: GeneratorFunctionRegistry;
  readonly dataTypes: DataTypeSupport;
  readonly codecLookup: CodecLookupWithDescriptors;
  readonly seedDiagnostics?: readonly ContractSourceDiagnostic[];
  readonly authoringContributions?: AuthoringContributions;
  /** The target's default codec ids for an `enum` block that omits `@@type`. */
  readonly enumInferenceCodecs?: { readonly text: string; readonly int: string };
  /** Receives a warning for each field typed with a deprecated scalar name. */
  readonly reportWarning?: (diagnostic: ContractSourceDiagnostic) => void;
}

/**
 * Reports `PSL_DEPRECATED_SCALAR_NAME` at the type of a field whose scalar name is a deprecated alias, naming the replacement. The alias resolves to the same codec, so the contract does not change.
 */
function deprecatedScalarWarner(input: {
  readonly sources: PslSources;
  readonly reportWarning: ((diagnostic: ContractSourceDiagnostic) => void) | undefined;
}): (field: FieldSymbol, descriptor: AuthoringTypeConstructorDescriptor) => void {
  const { reportWarning } = input;
  if (reportWarning === undefined) return () => {};
  return (field, descriptor) => {
    if (descriptor.deprecated === undefined) {
      return;
    }
    const typeNode = field.node.typeAnnotation()?.name()?.syntax ?? field.node.syntax;
    const [warning] = mapPslDiagnostics(
      [
        {
          code: 'PSL_DEPRECATED_SCALAR_NAME',
          message: `Scalar type "${field.typeName}" is deprecated and will be removed; use "${descriptor.deprecated.replacement}".`,
          ...diagnosticSource(input.sources, typeNode).at(),
        },
      ],
      input.sources,
    );
    if (warning !== undefined) reportWarning({ ...warning, severity: 'warning' });
  };
}

interface ScalarNames {
  readonly warnDeprecated: (
    field: FieldSymbol,
    descriptor: AuthoringTypeConstructorDescriptor,
  ) => void;
}

/** What resolving a field's type reports to. */
interface FieldResolutionContext {
  readonly sources: PslSources;
  readonly diagnostics: PslDiagnosticCollector;
}

/**
 * Mongo's PSL surface binds the database from the connection string, so every
 * explicit namespace block is invalid, including `namespace unbound { … }`.
 */
function validateNamespaceBlocksForMongoTarget(input: {
  readonly namespaces: readonly NamespaceSymbol[];
  readonly sources: PslSources;
  readonly binder: Binder;
  readonly diagnostics: PslDiagnosticCollector;
}): void {
  for (const namespace of input.namespaces) {
    for (const { node, span } of namespace.declarations) {
      input.diagnostics.push({
        code: 'PSL_UNSUPPORTED_NAMESPACE_BLOCK',
        message: `Mongo does not support \`namespace ${node.name()?.name() ?? namespace.name} { … }\` blocks (the database is bound by the connection string; declare models at the document top level instead).`,
        ...diagnosticSource(input.sources, node.syntax).at(span),
      });
    }
  }
}

function resolvePhysicalNames(input: {
  readonly model: ModelSymbol;
  readonly physicalNames: Map<ModelSymbol | FieldSymbol, string>;
  readonly specContext: AttributeSpecContext;
  readonly sources: PslSources;
  readonly binder: Binder;
  readonly diagnostics: PslDiagnosticCollector;
}): void {
  const { model, physicalNames, specContext, sources, binder, diagnostics } = input;
  const modelMap = model.attributes.find((attr) => attr.name === 'map');
  const collectionName = modelMap
    ? interpretModelAttribute({
        symbols: specContext.symbols,
        node: modelMap.node,
        spec: mongoAttributeSpecs.model.map(specContext),
        model,
        sources,
        binder,
        diagnostics,
      })?.name
    : undefined;
  physicalNames.set(model, collectionName ?? defaultCollectionName(model.name));
  for (const field of Object.values(model.fields)) {
    const fieldMap = field.attributes.find((attr) => attr.name === 'map');
    const mapped = fieldMap
      ? interpretFieldAttribute({
          symbols: specContext.symbols,
          node: fieldMap.node,
          spec: mongoAttributeSpecs.field.map({
            ...specContext,
            field,
            typeResolution: fieldTypeResolution(field, binder),
            typeConstructor: contributedTypeOf(fieldTypeResolution(field, binder), binder),
          }),
          model,
          field,
          sources,
          binder,
          diagnostics,
        })?.name
      : undefined;
    physicalNames.set(field, mapped ?? field.name);
  }
}

function physicalName(
  physicalNames: ReadonlyMap<ModelSymbol | FieldSymbol, string>,
  symbol: ModelSymbol | FieldSymbol | undefined,
): string {
  assertDefined(symbol, 'Physical names require a bound declaration');
  const name = physicalNames.get(symbol);
  assertDefined(name, 'Physical names must be populated before lowering');
  return name;
}

/**
 * The `@@discriminator` and `@@base` attributes already reported: one that failed to parse, by its model, and the base a `@@base` that failed to parse names, as written. No orphan diagnostic is added for them.
 */
interface ReportedPolymorphism {
  readonly discriminators: Set<string>;
  readonly baseTargets: Set<string>;
}

interface PolymorphismDeclarations {
  readonly discriminators: ReadonlyMap<ModelSymbol, Site & { readonly fieldName: string }>;
  readonly bases: ReadonlyMap<
    ModelSymbol,
    Site & {
      readonly base: ModelSymbol;
      readonly written: WrittenValue;
      readonly valueSpan: PslSpan;
    }
  >;
  readonly reported: ReportedPolymorphism;
}

/** A `@@base` value as it is written; the grammar reads only a quoted string there. */
function writtenBaseValue(written: ParsedWrittenScalar): WrittenValue {
  if (written.written === undefined) {
    throw new InternalError('A @@base value is a quoted string, never a tagged literal.');
  }
  return written.written;
}

function collectPolymorphismDeclarations(input: {
  readonly models: readonly ModelSymbol[];
  readonly specContextFor: (model: ModelSymbol) => AttributeSpecContext;
  readonly sources: PslSources;
  readonly binder: Binder;
  readonly diagnostics: PslDiagnosticCollector;
}): PolymorphismDeclarations {
  const { sources, binder, diagnostics } = input;
  const discriminators = new Map<ModelSymbol, Site & { readonly fieldName: string }>();
  const bases = new Map<
    ModelSymbol,
    Site & {
      readonly base: ModelSymbol;
      readonly written: WrittenValue;
      readonly valueSpan: PslSpan;
    }
  >();
  const reported: ReportedPolymorphism = { discriminators: new Set(), baseTargets: new Set() };

  for (const model of input.models) {
    const specContext = input.specContextFor(model);
    const discNode = model.attributes.find((attr) => attr.name === 'discriminator')?.node;
    if (discNode) {
      const parsed = interpretModelAttribute({
        symbols: specContext.symbols,
        node: discNode,
        spec: mongoAttributeSpecs.model.discriminator(specContext),
        model,
        sources,
        binder,
        diagnostics,
      });
      if (parsed) {
        discriminators.set(model, {
          fieldName: parsed.field,
          source: diagnosticSource(sources, discNode.syntax),
          span: nodePslSpan(discNode.syntax, sources),
        });
      } else {
        reported.discriminators.add(model.name);
      }
    }
    const baseAttribute = model.attributes.find((attr) => attr.name === 'base');
    const baseNode = baseAttribute?.node;
    if (baseNode) {
      const parsed = interpretModelAttribute({
        symbols: specContext.symbols,
        node: baseNode,
        spec: mongoAttributeSpecs.model.base(),
        model,
        sources,
        binder,
        diagnostics,
      });
      if (parsed) {
        bases.set(model, {
          base: parsed.base.declaration,
          written: writtenBaseValue(parsed.value),
          valueSpan: parsed.value.span,
          source: diagnosticSource(sources, baseNode.syntax),
          span: nodePslSpan(baseNode.syntax, sources),
        });
      } else {
        const target = baseAttribute?.args[0]?.value;
        if (target !== undefined) reported.baseTargets.add(target);
      }
    }
  }
  return { discriminators, bases, reported };
}

type ParsedIndexField =
  | {
      readonly kind: 'field';
      readonly name: string;
      readonly direction?: 1 | -1;
    }
  | {
      readonly kind: 'wildcard';
      readonly scope?: string;
    };

function normalizeIndexField(element: NormalIndexArgs['fields'][number]): ParsedIndexField {
  if (typeof element === 'string') {
    return { kind: 'field', name: element };
  }
  if (element.fn === 'wildcard') {
    const scope = element.args['scope'];
    return typeof scope === 'string' ? { kind: 'wildcard', scope } : { kind: 'wildcard' };
  }
  const field = element.args['field'];
  invariant(typeof field === 'string', 'The sort function spec requires a field reference');
  return {
    kind: 'field',
    name: field,
    direction: element.args['direction'] === 'Desc' ? -1 : 1,
  };
}

interface SpecCollationArgs {
  readonly collationLocale?: string;
  readonly collationStrength?: number;
  readonly collationCaseLevel?: boolean;
  readonly collationCaseFirst?: string;
  readonly collationNumericOrdering?: boolean;
  readonly collationAlternate?: string;
  readonly collationMaxVariable?: string;
  readonly collationBackwards?: boolean;
  readonly collationNormalization?: boolean;
}

/** The collation the index arguments name, or undefined when they name none. A collation without `collationLocale` is passed on for the builder to refuse. */
function buildCollationFromSpec(args: SpecCollationArgs): Record<string, unknown> | undefined {
  const collation: Record<string, unknown> = {
    ...ifDefined('locale', args.collationLocale),
    ...ifDefined('strength', args.collationStrength),
    ...ifDefined('caseLevel', args.collationCaseLevel),
    ...ifDefined('caseFirst', args.collationCaseFirst),
    ...ifDefined('numericOrdering', args.collationNumericOrdering),
    ...ifDefined('alternate', args.collationAlternate),
    ...ifDefined('maxVariable', args.collationMaxVariable),
    ...ifDefined('backwards', args.collationBackwards),
    ...ifDefined('normalization', args.collationNormalization),
  };
  return Object.keys(collation).length === 0 ? undefined : collation;
}

type NormalIndexArgs = InferAttr<ReturnType<typeof mongoAttributeSpecs.model.index>>;
type TextIndexArgs = InferAttr<ReturnType<typeof mongoAttributeSpecs.model.textIndex>>;

interface IndexBuildContext {
  readonly source: DiagnosticSource;
  readonly span: PslSpan;
  readonly diagnostics: PslDiagnosticCollector;
}

interface ResolvedIndexKeys {
  readonly fields: Record<string, MongoIndexKeyDirection>;
  readonly hasWildcard: boolean;
}

/** The index keys by field name, as the builder takes them: a wildcard is `$**` or `<field>.$**`. */
function resolveIndexKeys(
  parsedFields: readonly ParsedIndexField[],
  defaultDirection: MongoIndexKeyDirection,
  ctx: IndexBuildContext,
): ResolvedIndexKeys | undefined {
  const wildcardCount = parsedFields.filter((field) => field.kind === 'wildcard').length;
  if (wildcardCount > 1) {
    ctx.diagnostics.push({
      code: 'PSL_INVALID_INDEX',
      message: 'An index can contain at most one wildcard() field',
      ...ctx.source.at(ctx.span),
    });
    return undefined;
  }
  const fields: Record<string, MongoIndexKeyDirection> = {};
  for (const field of parsedFields) {
    if (field.kind === 'wildcard') {
      fields[field.scope === undefined ? '$**' : `${field.scope}.$**`] = defaultDirection;
    } else {
      fields[field.name] = field.direction ?? defaultDirection;
    }
  }
  return { fields, hasWildcard: wildcardCount === 1 };
}

function buildProjection(
  include: readonly string[] | undefined,
  exclude: readonly string[] | undefined,
  hasWildcard: boolean,
  ctx: IndexBuildContext,
): Record<string, 0 | 1> | null | undefined {
  if (include !== undefined && exclude !== undefined) {
    ctx.diagnostics.push({
      code: 'PSL_INVALID_INDEX',
      message: 'Cannot specify both include and exclude on the same index',
      ...ctx.source.at(ctx.span),
    });
    return null;
  }
  const fields = include ?? exclude;
  if (fields === undefined || (fields.length === 0 && hasWildcard)) return undefined;
  const value = include === undefined ? 0 : 1;
  const projection: Record<string, 0 | 1> = {};
  for (const field of fields) projection[field] = value;
  return projection;
}

/** Index options as the attribute specs read them, which are the values MongoDB takes. */
function indexOptions(options: Record<string, unknown>): MongoIndexOptionsInput {
  return blindCast<
    MongoIndexOptionsInput,
    'the index attribute specs read each option as the value MongoDB takes for it'
  >(options);
}

function buildNormalIndex(
  parsed: NormalIndexArgs,
  unique: boolean,
  ctx: IndexBuildContext,
): IndexNode | undefined {
  const parsedFields = parsed.fields.map(normalizeIndexField);
  if (parsedFields.length === 0) return undefined;
  const resolved = resolveIndexKeys(parsedFields, parsed.type ?? 1, ctx);
  if (!resolved) return undefined;
  const wildcardProjection = buildProjection(
    parsed.include,
    parsed.exclude,
    resolved.hasWildcard,
    ctx,
  );
  if (wildcardProjection === null) return undefined;
  const collation = buildCollationFromSpec(parsed);
  return {
    fields: resolved.fields,
    options: indexOptions({
      ...(unique && { unique: true }),
      ...ifDefined('sparse', parsed.sparse),
      ...ifDefined('expireAfterSeconds', parsed.expireAfterSeconds),
      ...ifDefined('partialFilterExpression', parsed.filter),
      ...ifDefined('wildcardProjection', wildcardProjection),
      ...ifDefined('collation', collation),
      ...ifDefined('default_language', parsed.default_language),
      ...ifDefined('language_override', parsed.languageOverride),
    }),
  };
}

function buildTextIndex(parsed: TextIndexArgs, ctx: IndexBuildContext): IndexNode | undefined {
  const parsedFields = parsed.fields.map(normalizeIndexField);
  if (parsedFields.length === 0) return undefined;
  const resolved = resolveIndexKeys(parsedFields, 'text', ctx);
  if (!resolved) return undefined;
  if (resolved.hasWildcard) {
    ctx.diagnostics.push({
      code: 'PSL_INVALID_INDEX',
      message: 'wildcard() fields cannot be combined with type: hashed/2dsphere/2d or @@textIndex',
      ...ctx.source.at(ctx.span),
    });
    return undefined;
  }
  const collation = buildCollationFromSpec(parsed);
  return {
    fields: resolved.fields,
    options: indexOptions({
      ...ifDefined('partialFilterExpression', parsed.filter),
      ...ifDefined('collation', collation),
      ...ifDefined('weights', parsed.weights),
      ...ifDefined('default_language', parsed.language),
      ...ifDefined('language_override', parsed.languageOverride),
    }),
  };
}

function nestedIndexPath(
  node: ModelAttributeAst,
): { readonly path: readonly string[]; readonly syntax: SyntaxNode } | undefined {
  for (const arg of node.argList()?.args() ?? []) {
    const name = arg.name()?.name();
    const list = arg.value();
    if ((name !== undefined && name !== 'fields') || !(list instanceof ArrayLiteralAst)) continue;
    for (const element of list.elements()) {
      const field =
        element instanceof FunctionCallAst && element.name()?.identifier()?.token()?.text === 'sort'
          ? [...element.args()][0]?.value()
          : element;
      const path = field instanceof PathExprAst ? field.path() : [];
      if (field instanceof PathExprAst && path.length > 1) return { path, syntax: field.syntax };
    }
  }
  return undefined;
}

function nestedIndexPathMessage(
  path: readonly string[],
  pslModel: ModelSymbol,
  binder: Binder,
): string {
  const [root = ''] = path;
  const label = `Index field "${path.join('.')}" on model "${pslModel.name}"`;
  const rootField = Object.hasOwn(pslModel.fields, root) ? pslModel.fields[root] : undefined;
  return rootField !== undefined && fieldTypeResolution(rootField, binder)?.kind === 'compositeType'
    ? `${label} is a path into a composite type; indexes on fields of a composite type are not supported yet. Index a top-level field of "${pslModel.name}" or remove the index.`
    : `${label} is a dotted path, but "${root}" is not a field of "${pslModel.name}" whose type is a composite type, so the path names no field. List fields of "${pslModel.name}" by name.`;
}

/**
 * A model's indexes as the schema writes them, with where each is written: a field's `@unique` first, then `@@index`, `@@unique` and `@@textIndex` in the order the model lists them.
 */
function collectIndexes(
  pslModel: ModelSymbol,
  specContext: AttributeSpecContext,
  sources: PslSources,
  binder: Binder,
  diagnostics: PslDiagnosticCollector,
): (Site & { readonly index: IndexNode })[] {
  const indexes: (Site & { readonly index: IndexNode })[] = [];
  for (const field of Object.values(pslModel.fields)) {
    if (fieldTypeResolution(field, binder)?.kind === 'model') continue;
    const uniqueNode = field.attributes.find((attr) => attr.name === 'unique')?.node;
    if (!uniqueNode) continue;
    const unique = interpretFieldAttribute({
      symbols: specContext.symbols,
      node: uniqueNode,
      spec: mongoAttributeSpecs.field.unique({
        ...specContext,
        field,
        typeResolution: fieldTypeResolution(field, binder),
        typeConstructor: contributedTypeOf(fieldTypeResolution(field, binder), binder),
      }),
      model: pslModel,
      field,
      sources,
      binder,
      diagnostics,
    });
    if (unique === undefined) continue;
    indexes.push({
      index: { fields: { [field.name]: 1 }, options: { unique: true } },
      source: diagnosticSource(sources, uniqueNode.syntax),
      span: nodePslSpan(uniqueNode.syntax, sources),
    });
  }

  for (const attr of pslModel.attributes) {
    if (attr.name !== 'index' && attr.name !== 'unique' && attr.name !== 'textIndex') continue;
    const node = attr.node;
    const source = diagnosticSource(sources, node.syntax);
    const ctx: IndexBuildContext = { source, span: attr.span, diagnostics };

    const nested = nestedIndexPath(node);
    if (nested !== undefined) {
      diagnostics.push({
        code: 'PSL_INVALID_INDEX',
        message: nestedIndexPathMessage(nested.path, pslModel, binder),
        ...source.at(nodePslSpan(nested.syntax, sources)),
      });
      continue;
    }

    let index: IndexNode | undefined;
    if (attr.name === 'textIndex') {
      const parsed = interpretModelAttribute({
        symbols: specContext.symbols,
        node,
        spec: mongoAttributeSpecs.model.textIndex(specContext),
        model: pslModel,
        sources,
        binder,
        diagnostics,
      });
      if (!parsed || parsed.fields.length === 0) continue;
      index = buildTextIndex(parsed, ctx);
    } else {
      const unique = attr.name === 'unique';
      const parsed = interpretModelAttribute({
        symbols: specContext.symbols,
        node,
        spec: unique
          ? mongoAttributeSpecs.model.unique(specContext)
          : mongoAttributeSpecs.model.index(specContext),
        model: pslModel,
        sources,
        binder,
        diagnostics,
      });
      if (!parsed) continue;
      index = buildNormalIndex(parsed, unique, ctx);
    }
    if (index !== undefined) indexes.push({ index, source, span: attr.span });
  }
  return indexes;
}

function fieldTypeResolution(field: FieldSymbol, binder: Binder): Resolution | undefined {
  const node = typeReferenceNode(field);
  return node === undefined ? undefined : binder.symbolForNode(node);
}

const GENERATOR_PHASES = ['onCreate', 'onUpdate'] as const;

interface LoweredGeneratorAttributes {
  /** The generators the attributes resolve to; undefined when the field has none or one is refused. */
  readonly values: ExecutionMutationDefaultPhases | undefined;
  readonly sites: FieldSite['generatorAttributes'];
}

/**
 * The generators a field's `@onCreate(fn())` and `@onUpdate(fn())` resolve to, and where each attribute is written. An attribute written twice, or one whose call is refused, is reported here.
 */
function lowerGeneratorAttributes(input: {
  readonly field: FieldSymbol;
  readonly modelName: string;
  readonly resolved: ResolvedNonRelationField;
  readonly specContext: FieldAttributeSpecContext;
  readonly generatorFunctions: GeneratorFunctionRegistry;
  readonly sources: PslSources;
  readonly binder: Binder;
  readonly diagnostics: PslDiagnosticCollector;
}): LoweredGeneratorAttributes {
  const { field, modelName, diagnostics } = input;
  const phases: {
    onCreate?: ExecutionMutationDefaultValue;
    onUpdate?: ExecutionMutationDefaultValue;
  } = {};
  const sites: Partial<Record<'onCreate' | 'onUpdate', { span: PslSpan; argument: string }>> = {};
  let refused = false;
  for (const phase of GENERATOR_PHASES) {
    const [attribute, duplicate] = field.attributes.filter(({ name }) => name === phase);
    if (attribute === undefined) continue;
    sites[phase] = {
      span: attribute.span,
      argument: attribute.args.find((arg) => arg.kind === 'positional')?.value.trim() ?? '',
    };
    if (duplicate !== undefined) {
      diagnostics.push({
        code: 'PSL_DUPLICATE_ATTRIBUTE',
        message: `\`@${phase}\` declared more than once on field "${modelName}.${field.name}".`,
        ...diagnosticSource(input.sources, field.node.syntax).at(duplicate.span),
      });
      refused = true;
      continue;
    }
    const generator = lowerGeneratorAttribute({
      phase,
      attribute,
      specContext: typeAttributeSpecContextOfField(input.specContext),
      type: input.resolved.field.type,
      symbols: input.specContext.symbols,
      binder: input.binder,
      sources: input.sources,
      generatorFunctions: input.generatorFunctions,
      diagnostics,
    });
    if (generator === undefined) {
      refused = true;
      continue;
    }
    phases[phase] = generator;
  }
  const none = phases.onCreate === undefined && phases.onUpdate === undefined;
  return { values: refused || none ? undefined : phases, sites };
}

interface ResolvedNonRelationField {
  readonly field: ContractField;
  /** The type alias the field is typed by. */
  readonly typeAlias?: ResolvedTypeAlias;
}

function fieldOfTypeAlias(
  field: FieldSymbol,
  typeAlias: ResolvedTypeAlias,
): ResolvedNonRelationField {
  return {
    field: {
      type: typeAlias.type,
      nullable: field.optional,
      many: field.list ? { elementNullable: field.elementOptional } : false,
      ...ifDefined('valueSet', typeAlias.valueSet),
    },
    typeAlias,
  };
}

/**
 * Whether a field may take what its type alias carries: it repeats none of the alias's attributes. Reports each refusal at the field.
 */
function acceptsTypeAlias(input: {
  readonly field: FieldSymbol;
  readonly modelName: string;
  readonly typeAlias: ResolvedTypeAlias;
  readonly sources: PslSources;
  readonly diagnostics: PslDiagnosticCollector;
}): boolean {
  return !refuseRepeatedTypeAliasAttributes({
    field: input.field,
    fieldPath: `${input.modelName}.${input.field.name}`,
    alias: input.typeAlias.alias,
    sources: input.sources,
    diagnostics: input.diagnostics,
  });
}

function resolveNonRelationField(
  field: FieldSymbol,
  owner: { readonly name: string; readonly kind: 'model' | 'compositeType' },
  resolution: Resolution | undefined,
  codecIdByEnumName: ReadonlyMap<string, string>,
  context: FieldResolutionContext,
  scalarNames: ScalarNames,
  typeAliases: ResolvedTypeAliases,
): ResolvedNonRelationField | undefined {
  const ownerName = owner.name;
  if (resolution?.kind === 'compositeType') {
    return {
      field: {
        type: {
          kind: 'valueObject',
          plane: 'storage',
          namespaceId: resolution.namespace.id,
          entityKind: 'valueObject',
          entityName: resolution.symbol.name,
        },
        nullable: field.optional,
        many: field.list ? { elementNullable: field.elementOptional } : false,
      },
    };
  }

  if (resolution?.kind === 'block' && resolution.symbol.keyword === 'enum') {
    const enumCodecId = codecIdByEnumName.get(resolution.symbol.name);
    if (enumCodecId === undefined) return undefined;
    const valueSet: ValueSetRef = {
      plane: 'domain',
      entityKind: 'enum',
      namespaceId: resolution.namespace.id,
      entityName: resolution.symbol.name,
    };
    return {
      field: {
        type: { kind: 'scalar', codecId: enumCodecId },
        nullable: field.optional,
        many: field.list ? { elementNullable: field.elementOptional } : false,
        valueSet,
      },
    };
  }

  if (resolution?.kind === 'namedType') {
    if (field.typeConstructor !== undefined) {
      context.diagnostics.push({
        code: 'PSL_UNSUPPORTED_FIELD_TYPE',
        message: `Field "${ownerName}.${field.name}" calls "${field.typeConstructor.path.join('.')}", which is a type alias, not a type constructor. Remove the arguments.`,
        ...diagnosticSource(context.sources, field.node.syntax).at(field.span),
      });
      return undefined;
    }
    const typeAlias = typeAliases.ofResolution(resolution);
    return typeAlias === undefined ? undefined : fieldOfTypeAlias(field, typeAlias);
  }

  if (
    resolution?.kind === 'model' ||
    resolution?.kind === 'block' ||
    resolution?.kind === 'crossSpace'
  ) {
    context.diagnostics.push({
      code: 'PSL_UNSUPPORTED_FIELD_TYPE',
      message: `Field "${ownerName}.${field.name}" type "${field.typeName}" is not supported in Mongo PSL interpreter`,
      ...diagnosticSource(context.sources, field.node.syntax).at(field.span),
    });
    return undefined;
  }
  if (resolution?.kind !== 'contributedType') {
    return undefined;
  }
  const { descriptor, path } = resolution.symbol;
  const call = field.typeConstructor;
  const entityLabel = `Field "${ownerName}.${field.name}"`;
  const source = diagnosticSource(context.sources, field.node.syntax);
  if (descriptor.kind === 'typeAlias') {
    if (call !== undefined) {
      context.diagnostics.push({
        code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
        message: `${path.join('.')} is a type alias and takes no arguments.`,
        ...source.at(call.span),
      });
      return undefined;
    }
    const typeAlias = typeAliases.ofResolution(resolution);
    invariant(typeAlias !== undefined, 'A contributed type alias always resolves');
    return fieldOfTypeAlias(field, typeAlias);
  }
  if (call === undefined && !isBareTypeConstructor(descriptor)) {
    reportTypeConstructorNotCalled({
      entityLabel,
      path: path.join('.'),
      descriptor,
      source,
      span: field.span,
      diagnostics: context.diagnostics,
    });
    return undefined;
  }

  if (call === undefined) scalarNames.warnDeprecated(field, descriptor);
  return {
    field: {
      type: scalarTypeOfConstructor(descriptor, call),
      nullable: field.optional,
      many: field.list ? { elementNullable: field.elementOptional } : false,
    },
  };
}

function processEnumDeclarations(input: {
  readonly enumSymbols: readonly BlockSymbol[];
  readonly parsedBlocks: ReadonlyMap<BlockSymbol, ParsedPslExtensionBlock>;
  readonly sources: PslSources;
  readonly authoringContributions: AuthoringContributions | undefined;
  readonly entityContext: AuthoringEntityContext;
  readonly diagnostics: PslDiagnosticCollector;
  /** Filled with where each enum is declared, for diagnostics about it. */
  readonly sites: Map<string, EnumSite>;
}): Record<string, EnumTypeHandle> {
  const handles: Record<string, EnumTypeHandle> = {};

  if (input.enumSymbols.length === 0) return handles;

  const enumDescriptor =
    input.authoringContributions?.entityTypes?.['enum'] !== undefined &&
    isAuthoringEntityTypeDescriptor(input.authoringContributions.entityTypes['enum'])
      ? input.authoringContributions.entityTypes['enum']
      : undefined;

  if (!enumDescriptor) {
    for (const enumSymbol of input.enumSymbols) {
      const source = diagnosticSource(input.sources, enumSymbol.node.syntax);
      input.diagnostics.push({
        code: 'PSL_ENUM_MISSING_FACTORY',
        message: `enum "${enumSymbol.name}" requires an "enum" entityType factory in the active authoring contributions`,
        ...source.at(enumSymbol.span),
      });
    }
    return handles;
  }

  for (const enumSymbol of input.enumSymbols) {
    const sourceFile = input.sources.sourceFileFor(enumSymbol.node.syntax);
    const envelope = input.parsedBlocks.get(enumSymbol);
    input.diagnostics.push(...enumMemberAttributeDiagnostics(enumSymbol, input.sources));
    if (envelope === undefined) continue;
    const handle = instantiateAuthoringEntityType<EnumTypeHandle | undefined>(
      'enum',
      enumDescriptor,
      [envelope],
      { ...input.entityContext, sourceId: sourceFile.filename },
    );

    if (handle === undefined || handle === null) continue;
    handles[envelope.name] = handle;
    const typeAttribute = envelope.attributes['type'];
    input.sites.set(envelope.name, {
      block: {
        enumName: envelope.name,
        codecId: handle.codecId,
        sourceId: sourceFile.filename,
        span: envelope.span,
        memberSpans: envelope.parameterSpans,
      },
      codecSpan: typeAttribute?.argSpans?.['codecId'] ?? typeAttribute?.span ?? envelope.span,
    });
  }

  return handles;
}

/** Whether PSL already reported the cause of a refusal, so the builder's refusal would repeat it. */
function alreadyReported(
  refusal: BuildRefusal,
  dropped: ReadonlySet<string>,
  reported: ReportedPolymorphism,
): boolean {
  switch (refusal.kind) {
    case 'indexFieldUnknown':
      return dropped.has(fieldSiteKey(refusal.key.model, refusal.fieldName));
    case 'relationLocalFieldUnknown':
      return dropped.has(fieldSiteKey(refusal.key.model, refusal.fieldName));
    case 'discriminatorFieldUnknown':
      return dropped.has(fieldSiteKey(refusal.key.model, refusal.fieldName));
    case 'discriminatorWithoutVariants':
      return reported.baseTargets.has(refusal.key.model);
    case 'baseWithoutDiscriminator':
      return reported.discriminators.has(refusal.baseModel);
    default:
      return false;
  }
}

function enumNameOf(field: ContractField): string | undefined {
  return field.valueSet?.entityKind === 'enum' ? field.valueSet.entityName : undefined;
}

function fieldNodeOf(
  fieldName: string,
  storedName: string,
  resolved: ResolvedNonRelationField,
  generatedValues: ExecutionMutationDefaultPhases | undefined,
): FieldNode {
  const { field } = resolved;
  const executionDefaults = resolved.typeAlias?.executionDefaults;
  return {
    fieldName,
    ...(storedName === fieldName ? {} : { storedName }),
    type: field.type,
    nullable: field.nullable,
    many: field.many ?? false,
    ...ifDefined('enumName', enumNameOf(field)),
    ...ifDefined('executionDefaults', executionDefaults),
    ...ifDefined('generatedValues', generatedValues),
  };
}

function relationNodeOf(fieldName: string, relation: ContractReferenceRelation): RelationNode {
  if (relation.cardinality === 'N:M') {
    throw new InternalError('A paired MongoDB back-relation is one-to-one or one-to-many.');
  }
  return {
    relationName: fieldName,
    toModel: relation.to.model,
    cardinality: relation.cardinality,
    on: relation.on,
    nullable: 'nullable' in relation ? relation.nullable : undefined,
  };
}

export function interpretPslDocumentToMongoContract(
  input: InterpretPslDocumentToMongoContractInput,
): Result<Contract, ContractSourceDiagnostics> {
  const { symbolTable, sources, codecLookup } = input;
  const diagnostics = createPslDiagnosticCollector(sources);
  const fieldResolution: FieldResolutionContext = { sources, diagnostics };
  const scalarNames: ScalarNames = {
    warnDeprecated: deprecatedScalarWarner({ sources, reportWarning: input.reportWarning }),
  };
  const { binder } = input;
  const { parsedBlocks, diagnostics: blockDiagnostics } = interpretExtensionBlocks({
    symbolTable,
    sources,
    pslBlockDescriptors: input.authoringContributions?.pslBlockDescriptors ?? {},
    binder,
    dataTypes: input.dataTypes,
  });
  diagnostics.push(...blockDiagnostics);
  const { defaultNamespace } = symbolTable;
  validateNamespaceBlocksForMongoTarget({
    namespaces: Object.values(symbolTable.namespaces),
    sources,
    binder,
    diagnostics,
  });
  const allModels: ModelSymbol[] = Object.values(defaultNamespace.models);
  const allCompositeTypes: CompositeTypeSymbol[] = Object.values(defaultNamespace.compositeTypes);
  const { generatorFunctions } = input;
  const specContextFor = (model: ModelSymbol): AttributeSpecContext => ({
    symbols: symbolTable,
    model,
    defaultFunctionRegistry: input.defaultFunctionRegistry,
    generatorFunctions,
    dataTypes: input.dataTypes,
  });
  const physicalNames = new Map<ModelSymbol | FieldSymbol, string>();
  for (const model of allModels) {
    resolvePhysicalNames({
      model,
      physicalNames,
      specContext: specContextFor(model),
      sources,
      binder,
      diagnostics,
    });
  }

  const blockKeywords = new Set([
    'enum',
    ...claimedBlockKeywords(input.authoringContributions?.pslBlockDescriptors),
  ]);
  for (const block of Object.values(defaultNamespace.blocks)) {
    if (!blockKeywords.has(block.keyword)) {
      diagnostics.push(unsupportedBlockDiagnostic(block, sources));
    }
  }
  const topLevelEnumSymbols = Object.values(defaultNamespace.blocks).filter(
    (b) => b.keyword === 'enum',
  );

  const enumSites = new Map<string, EnumSite>();
  const enumHandles = processEnumDeclarations({
    sites: enumSites,
    enumSymbols: topLevelEnumSymbols,
    parsedBlocks,
    sources,
    authoringContributions: input.authoringContributions,
    entityContext: {
      family: 'mongo',
      target: 'mongo',
      ...ifDefined('enumInferenceCodecs', input.enumInferenceCodecs),
      codecLookup,
      dataTypes: input.dataTypes,
      diagnostics: {
        push: (d) => {
          diagnostics.pushExternal(
            blindCast<ContractSourceDiagnostic, 'sink diagnostics are span-compatible'>(d),
          );
        },
      },
    },
    diagnostics,
  });

  const codecIdByEnumName: Map<string, string> = new Map(
    Object.entries(enumHandles).map(([name, handle]) => [name, handle.codecId]),
  );
  const typeAliases = resolveMongoTypeAliases({
    declarations: Object.values(symbolTable.namedTypes),
    symbols: symbolTable,
    binder,
    sources,
    diagnostics,
    codecIdByEnumName,
    defaultFunctionRegistry: input.defaultFunctionRegistry,
    generatorFunctions,
    dataTypes: input.dataTypes,
    authoringTypes: input.authoringContributions?.type,
  });

  const polymorphism = collectPolymorphismDeclarations({
    models: allModels,
    specContextFor,
    sources,
    binder,
    diagnostics,
  });

  const allFkRelations: MongoForeignKeyRelation[] = [];
  const backrelationCandidates: MongoBackRelationCandidate[] = [];
  const invalidFkPairings: InvalidFkPairing[] = [];
  const fieldSites = new Map<string, FieldSite>();
  const modelSites = new Map<string, ModelSites>();
  const droppedFields = new Set<string>();
  const relationsByModel = new Map<string, RelationNode[]>();
  const modelDrafts: {
    readonly symbol: ModelSymbol;
    readonly node: Omit<ModelNode, 'relations'>;
  }[] = [];

  for (const pslModel of allModels) {
    const specContext = specContextFor(pslModel);
    const fields: FieldNode[] = [];
    const relations: RelationNode[] = [];
    relationsByModel.set(pslModel.name, relations);

    for (const field of Object.values(pslModel.fields)) {
      const source = diagnosticSource(sources, field.node.syntax);
      const siteKey = fieldSiteKey(pslModel.name, field.name);
      const resolution = fieldTypeResolution(field, binder);
      if (resolution?.kind === 'model') {
        fieldSites.set(siteKey, {
          symbol: field,
          source,
          generatorAttributes: {},
          storedName: field.name,
        });
        const target = resolution.symbol;
        const relationNode = field.attributes.find((attr) => attr.name === 'relation')?.node;
        const relation = relationNode
          ? interpretFieldAttribute({
              symbols: specContext.symbols,
              node: relationNode,
              spec: mongoAttributeSpecs.field.relation({
                ...specContext,
                field,
                typeResolution: fieldTypeResolution(field, binder),
                typeConstructor: contributedTypeOf(fieldTypeResolution(field, binder), binder),
              }),
              model: pslModel,
              field,
              sources,
              binder,
              diagnostics,
            })
          : undefined;

        if (field.list || !(relation?.fields && relation?.references)) {
          backrelationCandidates.push({
            modelName: pslModel.name,
            targetModelName: target.name,
            ...ifDefined('relationName', relation?.name),
            cardinality: field.list ? '1:N' : '1:1',
            field,
            sources,
          });
          continue;
        }

        if (!physicalNames.has(target)) continue;
        relations.push({
          relationName: field.name,
          toModel: target.name,
          cardinality: 'N:1',
          on: { localFields: relation.fields, targetFields: relation.references },
          nullable: field.optional,
        });
        const nullability = resolveToOneRelationNullable({
          declaredNullable: field.optional,
          localFieldNullability: relation.fields.map(
            (localFieldName) => pslModel.fields[localFieldName]?.optional === true,
          ),
          ownsReference: true,
        });
        if (nullability.contradiction !== undefined) {
          invalidFkPairings.push({
            pairKey: fkRelationPairKey(pslModel.name, target.name),
            ...ifDefined('relationName', relation.name),
          });
          continue;
        }
        allFkRelations.push({
          declaringModel: pslModel.name,
          targetModel: target.name,
          ...ifDefined('relationName', relation.name),
          localFields: relation.fields,
          targetFields: relation.references,
        });
        continue;
      }

      const resolved = resolveNonRelationField(
        field,
        { name: pslModel.name, kind: 'model' },
        resolution,
        codecIdByEnumName,
        fieldResolution,
        scalarNames,
        typeAliases,
      );
      if (
        resolved === undefined ||
        (resolved.typeAlias !== undefined &&
          !acceptsTypeAlias({
            field,
            modelName: pslModel.name,
            typeAlias: resolved.typeAlias,
            sources,
            diagnostics,
          }))
      ) {
        droppedFields.add(siteKey);
        continue;
      }
      const storedName = physicalName(physicalNames, field);
      const generated = lowerGeneratorAttributes({
        field,
        modelName: pslModel.name,
        resolved,
        specContext: {
          ...specContext,
          field,
          typeResolution: resolution,
          typeConstructor: contributedTypeOf(resolution, binder),
        },
        generatorFunctions,
        sources,
        binder,
        diagnostics,
      });
      fields.push(fieldNodeOf(field.name, storedName, resolved, generated.values));
      fieldSites.set(siteKey, {
        symbol: field,
        source,
        ...ifDefined('typeAlias', resolved.typeAlias),
        generatorAttributes: generated.sites,
        storedName,
      });
    }

    const idFields: FieldSymbol[] = [];
    for (const field of Object.values(pslModel.fields)) {
      const idNode = field.attributes.find((attr) => attr.name === 'id')?.node;
      if (!idNode) continue;
      const interpreted = interpretFieldAttribute({
        symbols: specContext.symbols,
        node: idNode,
        spec: mongoAttributeSpecs.field.id({
          ...specContext,
          field,
          typeResolution: fieldTypeResolution(field, binder),
          typeConstructor: contributedTypeOf(fieldTypeResolution(field, binder), binder),
        }),
        model: pslModel,
        field,
        sources,
        binder,
        diagnostics,
      });
      if (interpreted === undefined) continue;
      idFields.push(field);
      const storedName = physicalName(physicalNames, field);
      if (storedName !== DOCUMENT_ID) {
        diagnostics.push({
          code: 'PSL_MONGO_ID_ATTRIBUTE_INVALID',
          message: `Field "${pslModel.name}.${field.name}" has @id but is stored as "${storedName}". In MongoDB, @id marks the field stored as _id, the document id: add @map("_id") to it, or remove @id.`,
          ...diagnosticSource(sources, field.node.syntax).at(field.span),
        });
      }
    }
    const [, secondIdField] = idFields;
    if (secondIdField !== undefined) {
      diagnostics.push({
        code: 'PSL_MONGO_ID_ATTRIBUTE_INVALID',
        message: `Model "${pslModel.name}" has @id on ${idFields.length} fields, ${idFields.map((field) => `"${field.name}"`).join(' and ')}. A document has one id: keep @id only on the field stored as _id.`,
        ...diagnosticSource(sources, secondIdField.node.syntax).at(secondIdField.span),
      });
    }

    const indexes = collectIndexes(pslModel, specContext, sources, binder, diagnostics);
    const discriminator = polymorphism.discriminators.get(pslModel);
    const base = polymorphism.bases.get(pslModel);
    modelSites.set(pslModel.name, {
      indexes,
      ...ifDefined('discriminator', discriminator),
      ...ifDefined('base', base),
    });
    const inheritsCollection =
      base !== undefined && getAttribute(pslModel.attributes, 'map') === undefined;
    modelDrafts.push({
      symbol: pslModel,
      node: {
        modelName: pslModel.name,
        ...(inheritsCollection ? {} : { collection: physicalName(physicalNames, pslModel) }),
        fields,
        indexes: indexes.map(({ index }) => index),
        ...(discriminator === undefined
          ? {}
          : { discriminator: { field: discriminator.fieldName } }),
        ...(base === undefined ? {} : { base: { model: base.base.name, value: base.written } }),
      },
    });
  }

  const valueObjects: ValueObjectNode[] = [];
  for (const compositeType of allCompositeTypes) {
    const fields: FieldNode[] = [];
    for (const field of Object.values(compositeType.fields)) {
      const siteKey = fieldSiteKey(compositeType.name, field.name);
      const fieldMap = field.attributes.find((attr) => attr.name === 'map');
      const resolved = resolveNonRelationField(
        field,
        { name: compositeType.name, kind: 'compositeType' },
        fieldTypeResolution(field, binder),
        codecIdByEnumName,
        fieldResolution,
        scalarNames,
        typeAliases,
      );
      if (resolved === undefined) {
        droppedFields.add(siteKey);
        continue;
      }
      const storedName = fieldMap?.args[0]?.value.replace(/^"|"$/g, '') ?? field.name;
      fields.push({
        ...fieldNodeOf(field.name, field.name, resolved, undefined),
        ...(fieldMap === undefined ? {} : { storedName }),
      });
      fieldSites.set(siteKey, {
        symbol: field,
        source: diagnosticSource(sources, field.node.syntax),
        ...ifDefined('typeAlias', resolved.typeAlias),
        generatorAttributes: {},
        ...(fieldMap === undefined
          ? {}
          : {
              map: {
                source: diagnosticSource(sources, fieldMap.node.syntax),
                span: nodePslSpan(fieldMap.node.syntax, sources),
              },
            }),
        storedName,
      });
    }
    valueObjects.push({ name: compositeType.name, fields });
  }

  const paired = pairMongoBackRelations({
    foreignKeys: allFkRelations,
    candidates: backrelationCandidates,
    invalidFkPairings,
    namespaceId: defaultNamespace.id,
  });
  diagnostics.push(...paired.diagnostics);
  for (const { modelName, fieldName, relation } of paired.relations) {
    relationsByModel.get(modelName)?.push(relationNodeOf(fieldName, relation));
  }

  const modelNodes = modelDrafts.map(({ node }) => ({
    ...node,
    relations: relationsByModel.get(node.modelName) ?? [],
  }));
  const definition: ContractDefinition = {
    target: input.target,
    ...ifDefined('extensions', input.extensionPacks),
    // Variants come last, so each collection lists a variant's indexes after its base's, as earlier releases did.
    models: [
      ...modelNodes.filter((model) => model.base === undefined),
      ...modelNodes.filter((model) => model.base !== undefined),
    ],
    valueObjects,
    enums: enumHandles,
    writesCollectionValidators: true,
    warnings: undefined,
  };
  const sites: SchemaSites = {
    models: modelSites,
    fields: fieldSites,
    enums: enumSites,
  };
  const built = buildMongoContractFromDefinition(definition, codecLookup, input.dataTypes);
  for (const refusal of built.ok ? [] : built.failure.refusals) {
    if (alreadyReported(refusal, droppedFields, polymorphism.reported)) continue;
    const diagnostic = refusalDiagnostic(refusal, sites);
    if ('range' in diagnostic) diagnostics.push(diagnostic);
    else diagnostics.pushExternal(diagnostic);
  }

  if (!built.ok || diagnostics.length > 0 || (input.seedDiagnostics?.length ?? 0) > 0) {
    return notOk({
      summary: 'PSL to Mongo contract interpretation failed',
      diagnostics: [...(input.seedDiagnostics ?? []), ...diagnostics.toExternal()],
    });
  }
  return ok(built.value.contract);
}
