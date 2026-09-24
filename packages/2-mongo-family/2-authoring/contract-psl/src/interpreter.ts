import type {
  ContractSourceDiagnostic,
  ContractSourceDiagnostics,
} from '@internal/config/config-types';
import { computeProfileHash, computeStorageHash } from '@internal/contract/hashing';
import {
  type Contract,
  type ContractEnum,
  type ContractField,
  type ContractReferenceRelation,
  type ContractValueObject,
  type CrossReference,
  crossRef,
  type JsonValue,
  type ValueSetRef,
} from '@internal/contract/types';
import { type EnumTypeHandle, resolveToOneRelationNullable } from '@internal/contract-authoring';
import { errorEnumCodecNotInPackStack } from '@internal/errors/control';
import type {
  AuthoringContributions,
  AuthoringEntityContext,
} from '@internal/framework-components/authoring';
import {
  instantiateAuthoringEntityType,
  isAuthoringEntityTypeDescriptor,
} from '@internal/framework-components/authoring';
import type { CodecLookup } from '@internal/framework-components/codec';
import type { ControlDefaultRegistries } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import {
  applyPolymorphicScopeToMongoIndex,
  buildMongoNamespace,
  type MongoCollectionInput,
  MongoIndex,
  type MongoIndexKeyDirection,
  MongoStorage,
  type MongoValueSetInput,
} from '@internal/mongo-contract';
import { mongoContractCanonicalizationHooks } from '@internal/mongo-contract/canonicalization-hooks';
import type { CollationOptions } from '@internal/mongo-value/mongodb-types';
import type {
  AttributeSpecContext,
  BlockSymbol,
  CompositeTypeSymbol,
  FieldSymbol,
  InferAttr,
  ModelSymbol,
  NamespaceSymbol,
  PslSpan,
  SymbolTable,
  TypedFuncCall,
} from '@internal/psl-parser';
import {
  createPslDiagnosticCollector,
  type DiagnosticSource,
  diagnosticSource,
  nodePslSpan,
  type PslDiagnostic,
  type PslDiagnosticCollector,
} from '@internal/psl-parser';
import {
  consumeInvalidFkPairing,
  fkRelationPairKey,
  type InvalidFkPairing,
  requiredOneToOneBackrelationDiagnostic,
} from '@internal/psl-parser/interpret';
import type { DocumentAst, PslSources } from '@internal/psl-parser/syntax';
import { assertDefined } from '@internal/utils/assertions';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { notOk, ok, type Result } from '@internal/utils/result';
import { deriveJsonSchema, derivePolymorphicJsonSchema } from './derive-json-schema';
import {
  findFieldAttributeNode,
  findModelAttributeNode,
  interpretFieldAttribute,
  interpretModelAttribute,
  mongoAttributeSpecs,
} from './mongo-attribute-specs';
import { defaultCollectionName, getAttribute } from './psl-helpers';

/**
 * Encode an authored enum value to its codec-encoded JSON form via the codec resolved by id from the
 * contract's codec lookup, so a non-identity `encodeJson` (permitted by the `mongoCodec` factory) is
 * respected. Matches the TS builder's `encodeEnumValue`: the lookup is always threaded in production,
 * and a codecId the lookup cannot resolve is a hard error — the enum uses a codec that is not part of
 * the contract's pack stack.
 */
function encodeEnumValue(value: unknown, codecId: string, codecLookup: CodecLookup): JsonValue {
  const codec = codecLookup.get(codecId);
  if (!codec) {
    throw errorEnumCodecNotInPackStack({ codecId });
  }
  return codec.encodeJson(value);
}

export interface InterpretPslDocumentToMongoContractInput {
  readonly documents: readonly DocumentAst[];
  readonly symbolTable: SymbolTable;
  readonly sources: PslSources;
  readonly scalarTypeCodecIds: ReadonlyMap<string, string>;
  readonly controlMutationDefaults: ControlDefaultRegistries;
  readonly codecLookup?: CodecLookup;
  readonly seedDiagnostics?: readonly ContractSourceDiagnostic[];
  readonly authoringContributions?: AuthoringContributions;
  /** The target's default codec ids for an `enum` block that omits `@@type`. */
  readonly enumInferenceCodecs?: { readonly text: string; readonly int: string };
}

/**
 * Mongo's PSL surface binds the database from the connection string, so every
 * explicit namespace block is invalid, including `namespace unbound { … }`.
 */
function validateNamespaceBlocksForMongoTarget(input: {
  readonly namespaces: readonly NamespaceSymbol[];
  readonly sources: PslSources;
  readonly diagnostics: PslDiagnosticCollector;
}): void {
  for (const namespace of input.namespaces) {
    for (const { node, span } of namespace.declarations) {
      input.diagnostics.push({
        code: 'PSL_UNSUPPORTED_NAMESPACE_BLOCK',
        message: `Mongo does not support \`namespace ${namespace.name} { … }\` blocks (the database is bound by the connection string; declare models at the document top level instead).`,
        ...diagnosticSource(input.sources, node.syntax).at(span),
      });
    }
  }
}

const UNLOWERED_FIELD_ATTRIBUTE_HINTS: ReadonlyMap<string, string> = new Map([
  [
    'updatedAt',
    'Mongo lowers no automatic timestamp updates; delete the attribute and set the timestamp in application code.',
  ],
]);

function unsupportedFieldAttributeMessage(
  ownerName: string,
  fieldName: string,
  attributeName: string,
): string {
  const base = `Field "${ownerName}.${fieldName}" uses unsupported attribute "@${attributeName}"`;
  const hint = UNLOWERED_FIELD_ATTRIBUTE_HINTS.get(attributeName);
  return hint === undefined ? base : `${base}. ${hint}`;
}

function reportUnknownAttributes(input: {
  readonly models: readonly ModelSymbol[];
  readonly compositeTypes: readonly CompositeTypeSymbol[];
  readonly sources: PslSources;
  readonly diagnostics: PslDiagnosticCollector;
}): void {
  const { sources, diagnostics } = input;
  for (const model of input.models) {
    for (const attribute of model.attributes) {
      if (Object.hasOwn(mongoAttributeSpecs.model, attribute.name)) continue;
      diagnostics.push({
        code: 'PSL_UNSUPPORTED_MODEL_ATTRIBUTE',
        message: `Model "${model.name}" uses unsupported attribute "@@${attribute.name}"`,
        ...diagnosticSource(sources, model.node.syntax).at(attribute.span),
      });
    }
  }
  for (const owner of [...input.models, ...input.compositeTypes]) {
    for (const field of Object.values(owner.fields)) {
      for (const attribute of field.attributes) {
        if (Object.hasOwn(mongoAttributeSpecs.field, attribute.name)) continue;
        diagnostics.push({
          code: 'PSL_UNSUPPORTED_FIELD_ATTRIBUTE',
          message: unsupportedFieldAttributeMessage(owner.name, field.name, attribute.name),
          ...diagnosticSource(sources, field.node.syntax).at(attribute.span),
        });
      }
    }
  }
}

interface FieldMappings {
  readonly pslNameToMapped: Map<string, string>;
}

interface MongoModelMetadata {
  readonly collectionName: string;
  readonly fieldMappings: FieldMappings;
}

interface FkRelation {
  readonly declaringModel: string;
  readonly fieldName: string;
  readonly targetModel: string;
  readonly relationName?: string;
  readonly localFields: readonly string[];
  readonly targetFields: readonly string[];
}

function relationNullabilityMismatchDiagnostic(
  modelName: string,
  field: FieldSymbol,
  sources: PslSources,
): PslDiagnostic {
  const source = diagnosticSource(sources, field.node.syntax);
  const fieldLabel = `Relation field "${modelName}.${field.name}"`;
  return {
    code: 'PSL_RELATION_NULLABILITY_MISMATCH',
    message: field.optional
      ? `${fieldLabel} is optional but every field in @relation(fields: [...]) is required. Make one of those fields optional with "?" or remove "?" from "${field.name}".`
      : `${fieldLabel} is required but a field in @relation(fields: [...]) is optional. Add "?" to "${field.name}" or make those fields required.`,
    ...source.at(field.span),
  };
}

function resolveFieldMappings(input: {
  readonly model: ModelSymbol;
  readonly specContext: AttributeSpecContext;
  readonly sources: PslSources;
  readonly diagnostics: PslDiagnosticCollector;
}): FieldMappings {
  const { model, specContext, sources, diagnostics } = input;
  const pslNameToMapped = new Map<string, string>();
  for (const field of Object.values(model.fields)) {
    const mapNode = findFieldAttributeNode(field, 'map');
    const mapped =
      (mapNode
        ? interpretFieldAttribute({
            symbols: specContext.symbols,
            node: mapNode,
            spec: mongoAttributeSpecs.field.map({ ...specContext, field }),
            model,
            field,
            sources,
            diagnostics,
          })?.name
        : undefined) ?? field.name;
    pslNameToMapped.set(field.name, mapped);
  }
  return { pslNameToMapped };
}

function resolveCollectionName(input: {
  readonly model: ModelSymbol;
  readonly specContext: AttributeSpecContext;
  readonly sources: PslSources;
  readonly diagnostics: PslDiagnosticCollector;
}): string {
  const { model, specContext, sources, diagnostics } = input;
  const mapNode = findModelAttributeNode(model, 'map');
  const name = mapNode
    ? interpretModelAttribute({
        symbols: specContext.symbols,
        node: mapNode,
        spec: mongoAttributeSpecs.model.map(specContext),
        model,
        sources,
        diagnostics,
      })?.name
    : undefined;
  return name ?? defaultCollectionName(model.name);
}

interface MongoModelEntry {
  readonly fields: Record<string, ContractField>;
  readonly relations: Record<string, ContractReferenceRelation>;
  readonly storage: { readonly collection: string };
  readonly discriminator?: { readonly field: string };
  readonly variants?: Record<string, { readonly value: string }>;
  readonly base?: CrossReference;
}

type DiscriminatorDeclaration = {
  readonly fieldName: string;
  readonly source: DiagnosticSource;
  readonly span: PslSpan;
};
type BaseDeclaration = {
  readonly base: ModelSymbol;
  readonly value: string;
  readonly collectionName: string;
  readonly source: DiagnosticSource;
  readonly span: PslSpan;
};

function mongoCrossRef(modelName: string): CrossReference {
  return crossRef(modelName, UNBOUND_NAMESPACE_ID);
}

function collectPolymorphismDeclarations(
  models: readonly ModelSymbol[],
  specContextFor: (model: ModelSymbol) => AttributeSpecContext,
  modelMetadataByName: ReadonlyMap<string, MongoModelMetadata>,
  sources: PslSources,
  diagnostics: PslDiagnosticCollector,
): {
  discriminatorDeclarations: Map<ModelSymbol, DiscriminatorDeclaration>;
  baseDeclarations: Map<ModelSymbol, BaseDeclaration>;
} {
  const discriminatorDeclarations = new Map<ModelSymbol, DiscriminatorDeclaration>();
  const baseDeclarations = new Map<ModelSymbol, BaseDeclaration>();

  for (const model of models) {
    const specContext = specContextFor(model);
    const discNode = findModelAttributeNode(model, 'discriminator');
    if (discNode) {
      const parsed = interpretModelAttribute({
        symbols: specContext.symbols,
        node: discNode,
        spec: mongoAttributeSpecs.model.discriminator(specContext),
        model,
        sources,
        diagnostics,
      });
      if (parsed) {
        const fieldName = parsed.field;
        const discField = model.fields[fieldName];
        // Semantic check — stays: the discriminator field must be a String.
        if (discField && discField.typeName !== 'String') {
          diagnostics.push({
            code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
            message: `Discriminator field "${fieldName}" on model "${model.name}" must be of type String, but is "${discField.typeName}"`,
            ...diagnosticSource(sources, discNode.syntax).at(nodePslSpan(discNode.syntax, sources)),
          });
        } else {
          discriminatorDeclarations.set(model, {
            fieldName,
            source: diagnosticSource(sources, discNode.syntax),
            span: nodePslSpan(discNode.syntax, sources),
          });
        }
      }
    }
    const baseNode = findModelAttributeNode(model, 'base');
    if (baseNode) {
      const parsed = interpretModelAttribute({
        symbols: specContext.symbols,
        node: baseNode,
        spec: mongoAttributeSpecs.model.base(),
        model,
        sources,
        diagnostics,
      });
      if (parsed) {
        const collectionName =
          modelMetadataByName.get(model.name)?.collectionName ?? defaultCollectionName(model.name);
        baseDeclarations.set(model, {
          base: parsed.base.declaration,
          value: parsed.value,
          collectionName,
          source: diagnosticSource(sources, baseNode.syntax),
          span: nodePslSpan(baseNode.syntax, sources),
        });
      }
    }
  }

  return { discriminatorDeclarations, baseDeclarations };
}

function resolvePolymorphism(input: {
  models: Record<string, MongoModelEntry>;
  roots: Record<string, CrossReference>;
  collections: Record<string, Record<string, unknown>>;
  discriminatorDeclarations: Map<ModelSymbol, DiscriminatorDeclaration>;
  baseDeclarations: Map<ModelSymbol, BaseDeclaration>;
  indexSpans: Map<MongoIndex, PslSpan>;
  modelIndexesByName: Map<string, readonly MongoIndex[]>;
  modelMetadataByName: ReadonlyMap<string, MongoModelMetadata>;
  indexSources: ReadonlyMap<MongoIndex, DiagnosticSource>;
  sources: PslSources;
}): {
  models: Record<string, MongoModelEntry>;
  roots: Record<string, CrossReference>;
  collections: Record<string, Record<string, unknown>>;
  diagnostics: PslDiagnosticCollector;
} {
  const {
    discriminatorDeclarations,
    baseDeclarations,
    modelMetadataByName,
    indexSpans,
    modelIndexesByName,
    indexSources,
  } = input;
  let patched = input.models;
  let roots = input.roots;
  let collections = input.collections;
  const diagnostics = createPslDiagnosticCollector(input.sources);

  for (const [declaration, decl] of discriminatorDeclarations) {
    const modelName = declaration.name;
    if (baseDeclarations.has(declaration)) {
      diagnostics.push({
        code: 'PSL_DISCRIMINATOR_AND_BASE',
        message: `Model "${modelName}" cannot have both @@discriminator and @@base`,
        ...decl.source.at(decl.span),
      });
      continue;
    }

    const model = patched[modelName];
    if (!model) continue;

    const mappedDiscriminatorField =
      modelMetadataByName.get(modelName)?.fieldMappings.pslNameToMapped.get(decl.fieldName) ??
      decl.fieldName;

    if (!Object.hasOwn(model.fields, mappedDiscriminatorField)) {
      diagnostics.push({
        code: 'PSL_DISCRIMINATOR_FIELD_NOT_FOUND',
        message: `Discriminator field "${decl.fieldName}" is not a field on model "${modelName}"`,
        ...decl.source.at(decl.span),
      });
      continue;
    }

    const variants: Record<string, { readonly value: string }> = {};
    for (const [variant, baseDecl] of baseDeclarations) {
      if (baseDecl.base !== declaration) continue;
      variants[variant.name] = { value: baseDecl.value };
    }

    if (Object.keys(variants).length === 0) {
      diagnostics.push({
        code: 'PSL_ORPHANED_DISCRIMINATOR',
        message: `Model "${modelName}" has @@discriminator but no variant models declare @@base(${modelName}, ...)`,
        ...decl.source.at(decl.span),
      });
      continue;
    }

    patched = {
      ...patched,
      [modelName]: { ...model, discriminator: { field: mappedDiscriminatorField }, variants },
    };
  }

  for (const [variant, baseDecl] of baseDeclarations) {
    const variantName = variant.name;
    const baseName = baseDecl.base.name;
    if (!discriminatorDeclarations.has(baseDecl.base)) {
      diagnostics.push({
        code: 'PSL_ORPHANED_BASE',
        message: `Model "${variantName}" declares @@base(${baseName}, ...) but "${baseName}" has no @@discriminator`,
        ...baseDecl.source.at(baseDecl.span),
      });
      continue;
    }

    if (discriminatorDeclarations.has(variant)) {
      continue;
    }

    const baseModel = patched[baseName];
    const hasExplicitMap = getAttribute(variant.attributes, 'map') !== undefined;

    if (hasExplicitMap && baseModel && baseDecl.collectionName !== baseModel.storage.collection) {
      diagnostics.push({
        code: 'PSL_MONGO_VARIANT_SEPARATE_COLLECTION',
        message: `Mongo variant "${variantName}" cannot use a different collection than its base "${baseName}". Mongo only supports single-collection polymorphism.`,
        ...baseDecl.source.at(baseDecl.span),
      });
      continue;
    }

    const baseCollection = baseModel?.storage.collection ?? baseDecl.collectionName;
    const variantModel = patched[variantName];
    if (variantModel) {
      patched = {
        ...patched,
        [variantName]: {
          ...variantModel,
          base: mongoCrossRef(baseName),
          storage: { collection: baseCollection },
        },
      };
    }

    const variantCollectionName =
      modelMetadataByName.get(variantName)?.collectionName ?? defaultCollectionName(variantName);
    if (roots[variantCollectionName]?.model === variantName) {
      if (variantCollectionName === baseCollection && baseModel) {
        roots = { ...roots, [variantCollectionName]: mongoCrossRef(baseName) };
      } else {
        roots = Object.fromEntries(
          Object.entries(roots).filter(([key]) => key !== variantCollectionName),
        );
      }
    }

    const variantOwnIndexes = modelIndexesByName.get(variantName) ?? [];
    const baseColl = collections[baseCollection];

    const baseModelEntry = patched[baseName];
    const discriminatorField = baseModelEntry?.discriminator?.field;
    const scopedVariantIndexes: MongoIndex[] = [];
    if (discriminatorField) {
      for (const idx of variantOwnIndexes) {
        const result = applyPolymorphicScopeToMongoIndex(idx, {
          discriminatorField,
          discriminatorValue: baseDecl.value,
        });
        if (result.kind === 'conflict') {
          const span = indexSpans.get(idx) ?? baseDecl.span;
          diagnostics.push({
            code: 'PSL_INVALID_INDEX',
            message: `Variant "${variantName}" index conflicts with discriminator scope: ${result.reason}`,
            ...(indexSources.get(idx) ?? baseDecl.source).at(span),
          });
          continue;
        }
        if (result.index !== idx) {
          indexSpans.set(result.index, indexSpans.get(idx) ?? baseDecl.span);
        }
        scopedVariantIndexes.push(result.index);
      }
    } else {
      scopedVariantIndexes.push(...variantOwnIndexes);
    }

    if (variantCollectionName !== baseCollection) {
      const filtered = Object.fromEntries(
        Object.entries(collections).filter(([key]) => key !== variantCollectionName),
      );
      if (scopedVariantIndexes.length > 0 && baseColl) {
        const baseIndexes = collectionIndexes(baseColl);
        collections = {
          ...filtered,
          [baseCollection]: {
            ...baseColl,
            indexes: [...baseIndexes, ...scopedVariantIndexes],
          },
        };
      } else {
        collections = filtered;
      }
    } else if (baseColl) {
      const existingIndexes = collectionIndexes(baseColl);
      const variantIndexSet = new Set<MongoIndex>(variantOwnIndexes);
      const withoutUnscopedVariants = existingIndexes.filter((idx) => !variantIndexSet.has(idx));
      const mergedIndexes = [...withoutUnscopedVariants];
      for (const idx of scopedVariantIndexes) {
        const idxKey = canonicalJson(idx);
        const isDuplicate = withoutUnscopedVariants.some(
          (existing) => canonicalJson(existing) === idxKey,
        );
        if (!isDuplicate) {
          mergedIndexes.push(idx);
        }
      }
      if (
        mergedIndexes.length !== existingIndexes.length ||
        mergedIndexes.some((idx, i) => idx !== existingIndexes[i])
      ) {
        const next: Record<string, unknown> = { ...baseColl };
        if (mergedIndexes.length > 0) {
          next['indexes'] = mergedIndexes;
        } else {
          delete next['indexes'];
        }
        collections = { ...collections, [baseCollection]: next };
      }
    }
  }

  return { models: patched, roots, collections, diagnostics };
}

function collectionIndexes(collection: Record<string, unknown>): MongoIndex[] {
  return blindCast<
    MongoIndex[],
    'Mongo collection indexes are constructed as MongoIndex arrays by this interpreter'
  >(collection['indexes'] ?? []);
}

// Property-order-stable serialization for structural equality of plain
// JSON-compatible values. Used for comparing MongoIndex shapes in
// the variant-merge dedup path where a future change to the spread order
// would otherwise produce JSON-stringify mismatches even though the
// indexes are structurally identical.
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
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

function normalizeIndexField(element: string | TypedFuncCall): ParsedIndexField {
  if (typeof element === 'string') {
    return { kind: 'field', name: element };
  }
  if (element.fn === 'wildcard' && element.args['sort'] === undefined) {
    const scope = element.args['scope'];
    return typeof scope === 'string' ? { kind: 'wildcard', scope } : { kind: 'wildcard' };
  }
  const sort = element.args['sort'];
  return { kind: 'field', name: element.fn, direction: sort === 'Desc' ? -1 : 1 };
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

function buildCollationFromSpec(args: SpecCollationArgs): CollationOptions | null | undefined {
  const locale = args.collationLocale;
  if (locale === undefined) {
    const hasAnyCollationArg =
      args.collationStrength !== undefined ||
      args.collationCaseLevel !== undefined ||
      args.collationCaseFirst !== undefined ||
      args.collationNumericOrdering !== undefined ||
      args.collationAlternate !== undefined ||
      args.collationMaxVariable !== undefined ||
      args.collationBackwards !== undefined ||
      args.collationNormalization !== undefined;
    return hasAnyCollationArg ? null : undefined;
  }

  const collation: CollationOptions = { locale };
  if (args.collationStrength !== undefined) collation.strength = args.collationStrength;
  if (args.collationCaseLevel !== undefined) collation.caseLevel = args.collationCaseLevel;
  if (args.collationCaseFirst !== undefined) collation.caseFirst = args.collationCaseFirst;
  if (args.collationNumericOrdering !== undefined)
    collation.numericOrdering = args.collationNumericOrdering;
  if (args.collationAlternate !== undefined) collation.alternate = args.collationAlternate;
  if (args.collationMaxVariable !== undefined) collation.maxVariable = args.collationMaxVariable;
  if (args.collationBackwards !== undefined) collation.backwards = args.collationBackwards;
  if (args.collationNormalization !== undefined)
    collation.normalization = args.collationNormalization;
  return collation;
}

type NormalIndexArgs = InferAttr<ReturnType<typeof mongoAttributeSpecs.model.index>>;
type TextIndexArgs = InferAttr<ReturnType<typeof mongoAttributeSpecs.model.textIndex>>;

interface IndexBuildContext {
  readonly pslModel: ModelSymbol;
  readonly fieldMappings: FieldMappings;
  readonly indexableFieldNames: ReadonlySet<string>;
  readonly source: DiagnosticSource;
  readonly span: PslSpan;
  readonly diagnostics: PslDiagnosticCollector;
}

interface ResolvedIndexKeys {
  readonly keys: readonly { readonly field: string; readonly direction: MongoIndexKeyDirection }[];
  readonly hasWildcard: boolean;
}

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

  for (const field of parsedFields) {
    const fieldName = field.kind === 'wildcard' ? field.scope : field.name;
    if (fieldName !== undefined && !ctx.indexableFieldNames.has(fieldName)) {
      ctx.diagnostics.push({
        code: 'PSL_INDEX_FIELD_NOT_FOUND',
        message: `Index on model "${ctx.pslModel.name}" references unknown field "${fieldName}"`,
        ...ctx.source.at(ctx.span),
      });
      return undefined;
    }
  }

  const keys = parsedFields.map((field) => {
    if (field.kind === 'wildcard') {
      if (field.scope === undefined) return { field: '$**', direction: defaultDirection };
      const mappedScope = ctx.fieldMappings.pslNameToMapped.get(field.scope) ?? field.scope;
      return { field: `${mappedScope}.$**`, direction: defaultDirection };
    }
    const mappedName = ctx.fieldMappings.pslNameToMapped.get(field.name) ?? field.name;
    return { field: mappedName, direction: field.direction ?? defaultDirection };
  });
  return { keys, hasWildcard: wildcardCount === 1 };
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
  if (fields === undefined) return undefined;
  if (!hasWildcard) {
    ctx.diagnostics.push({
      code: 'PSL_INVALID_INDEX',
      message: 'include/exclude options are only valid when the index contains a wildcard() field',
      ...ctx.source.at(ctx.span),
    });
    return null;
  }
  if (fields.length === 0) return undefined;
  const value = include === undefined ? 0 : 1;
  const projection: Record<string, 0 | 1> = {};
  for (const field of fields) projection[field] = value;
  return projection;
}

function buildNormalIndex(
  parsed: NormalIndexArgs,
  unique: boolean,
  ctx: IndexBuildContext,
): MongoIndex | undefined {
  const parsedFields = parsed.fields.map(normalizeIndexField);
  if (parsedFields.length === 0) return undefined;
  const defaultDirection = parsed.type ?? 1;
  const resolved = resolveIndexKeys(parsedFields, defaultDirection, ctx);
  if (!resolved) return undefined;

  if (unique && resolved.hasWildcard) {
    ctx.diagnostics.push({
      code: 'PSL_INVALID_INDEX',
      message: 'Unique indexes cannot use wildcard() fields',
      ...ctx.source.at(ctx.span),
    });
    return undefined;
  }
  if (
    resolved.hasWildcard &&
    typeof defaultDirection === 'string' &&
    ['hashed', '2dsphere', '2d'].includes(defaultDirection)
  ) {
    ctx.diagnostics.push({
      code: 'PSL_INVALID_INDEX',
      message: `wildcard() fields cannot be combined with type: ${defaultDirection}`,
      ...ctx.source.at(ctx.span),
    });
    return undefined;
  }
  if (defaultDirection === 'hashed' && parsedFields.length > 1) {
    ctx.diagnostics.push({
      code: 'PSL_INVALID_INDEX',
      message: 'Hashed indexes must have exactly one field',
      ...ctx.source.at(ctx.span),
    });
    return undefined;
  }
  if (resolved.hasWildcard && parsed.expireAfterSeconds !== undefined) {
    ctx.diagnostics.push({
      code: 'PSL_INVALID_INDEX',
      message: 'expireAfterSeconds cannot be combined with wildcard() fields',
      ...ctx.source.at(ctx.span),
    });
    return undefined;
  }

  const wildcardProjection = buildProjection(
    parsed.include,
    parsed.exclude,
    resolved.hasWildcard,
    ctx,
  );
  if (wildcardProjection === null) return undefined;
  const collation = buildCollationFromSpec(parsed);
  if (collation === null) {
    ctx.diagnostics.push({
      code: 'PSL_INVALID_INDEX',
      message: 'collationLocale is required when using collation options',
      ...ctx.source.at(ctx.span),
    });
    return undefined;
  }

  return new MongoIndex({
    keys: resolved.keys,
    ...(unique && { unique: true }),
    ...(parsed.sparse !== undefined && { sparse: parsed.sparse }),
    ...(parsed.expireAfterSeconds !== undefined && {
      expireAfterSeconds: parsed.expireAfterSeconds,
    }),
    ...(parsed.filter !== undefined && { partialFilterExpression: parsed.filter }),
    ...(wildcardProjection !== undefined && { wildcardProjection }),
    ...(collation !== undefined && { collation }),
    ...(parsed.default_language !== undefined && { default_language: parsed.default_language }),
    ...(parsed.languageOverride !== undefined && { language_override: parsed.languageOverride }),
  });
}

function buildTextIndex(parsed: TextIndexArgs, ctx: IndexBuildContext): MongoIndex | undefined {
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
  if (collation === null) {
    ctx.diagnostics.push({
      code: 'PSL_INVALID_INDEX',
      message: 'collationLocale is required when using collation options',
      ...ctx.source.at(ctx.span),
    });
    return undefined;
  }

  return new MongoIndex({
    keys: resolved.keys,
    ...(parsed.filter !== undefined && { partialFilterExpression: parsed.filter }),
    ...(collation !== undefined && { collation }),
    ...ifDefined('weights', parsed.weights),
    ...(parsed.language !== undefined && { default_language: parsed.language }),
    ...(parsed.languageOverride !== undefined && { language_override: parsed.languageOverride }),
  });
}

function collectIndexes(
  pslModel: ModelSymbol,
  specContext: AttributeSpecContext,
  fieldMappings: FieldMappings,
  modelNames: ReadonlySet<string>,
  sources: PslSources,
  diagnostics: PslDiagnosticCollector,
  indexSpans: Map<MongoIndex, PslSpan>,
  indexSources: Map<MongoIndex, DiagnosticSource>,
): MongoIndex[] {
  const indexes: MongoIndex[] = [];
  let textIndexCount = 0;
  const indexableFieldNames = new Set<string>();
  for (const field of Object.values(pslModel.fields)) {
    if (!modelNames.has(field.typeName)) indexableFieldNames.add(field.name);
  }

  for (const field of Object.values(pslModel.fields)) {
    if (modelNames.has(field.typeName)) continue;
    const uniqueNode = findFieldAttributeNode(field, 'unique');
    if (!uniqueNode) continue;
    const unique = interpretFieldAttribute({
      symbols: specContext.symbols,
      node: uniqueNode,
      spec: mongoAttributeSpecs.field.unique({ ...specContext, field }),
      model: pslModel,
      field,
      sources,
      diagnostics,
    });
    if (unique === undefined) continue;
    const mappedName = fieldMappings.pslNameToMapped.get(field.name) ?? field.name;
    const fieldUniqueIndex = new MongoIndex({
      keys: [{ field: mappedName, direction: 1 }],
      unique: true,
    });
    indexes.push(fieldUniqueIndex);
    indexSpans.set(fieldUniqueIndex, nodePslSpan(uniqueNode.syntax, sources));
    indexSources.set(fieldUniqueIndex, diagnosticSource(sources, uniqueNode.syntax));
  }

  const attributeNodes = Array.from(pslModel.node.attributes());
  for (const [attrIndex, attr] of pslModel.attributes.entries()) {
    if (attr.name !== 'index' && attr.name !== 'unique' && attr.name !== 'textIndex') continue;
    const node = attributeNodes[attrIndex];
    if (!node) continue;
    const source = diagnosticSource(sources, node.syntax);
    const ctx: IndexBuildContext = {
      pslModel,
      fieldMappings,
      indexableFieldNames,
      source,
      span: attr.span,
      diagnostics,
    };

    let index: MongoIndex | undefined;
    if (attr.name === 'textIndex') {
      const parsed = interpretModelAttribute({
        symbols: specContext.symbols,
        node,
        spec: mongoAttributeSpecs.model.textIndex(specContext),
        model: pslModel,
        sources,
        diagnostics,
      });
      if (!parsed || parsed.fields.length === 0) continue;
      textIndexCount++;
      if (textIndexCount > 1) {
        diagnostics.push({
          code: 'PSL_INVALID_INDEX',
          message: `Only one @@textIndex is allowed per collection (model "${pslModel.name}")`,
          ...source.at(attr.span),
        });
        continue;
      }
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
        diagnostics,
      });
      if (!parsed) continue;
      index = buildNormalIndex(parsed, unique, ctx);
    }

    if (!index) continue;
    indexes.push(index);
    indexSpans.set(index, attr.span);
    indexSources.set(index, source);
  }
  return indexes;
}

function isRelationField(field: FieldSymbol, modelNames: ReadonlySet<string>): boolean {
  return modelNames.has(field.typeName);
}

// PSL scalar type name whose codec is mandated for a Mongo model's `_id`.
const MONGO_OBJECT_ID_PSL_TYPE = 'ObjectId';

function resolveFieldCodecId(
  field: FieldSymbol,
  scalarTypeCodecIds: ReadonlyMap<string, string>,
): string | undefined {
  return scalarTypeCodecIds.get(field.typeName);
}

function resolveNonRelationField(
  field: FieldSymbol,
  ownerName: string,
  compositeTypeNames: ReadonlySet<string>,
  scalarTypeCodecIds: ReadonlyMap<string, string>,
  codecIdByEnumName: ReadonlyMap<string, string>,
  sources: PslSources,
  diagnostics: PslDiagnosticCollector,
): ContractField | undefined {
  if (compositeTypeNames.has(field.typeName)) {
    const result: ContractField = {
      type: { kind: 'valueObject', name: field.typeName },
      nullable: field.optional,
    };
    return field.list ? { ...result, many: true } : result;
  }

  // If this field's declared type is a known enum name, treat the field as a scalar
  // with that enum's codec and stamp the domain valueSet ref.
  const enumCodecId = codecIdByEnumName.get(field.typeName);
  if (enumCodecId !== undefined) {
    const valueSet: ValueSetRef = {
      plane: 'domain',
      entityKind: 'enum',
      namespaceId: UNBOUND_NAMESPACE_ID,
      entityName: field.typeName,
    };
    const result: ContractField = {
      type: { kind: 'scalar', codecId: enumCodecId },
      nullable: field.optional,
      valueSet,
    };
    return field.list ? { ...result, many: true } : result;
  }

  // Avoid cascading unsupported-type diagnostics after invalid qualification.
  if (field.malformedType) {
    return undefined;
  }

  const codecId = resolveFieldCodecId(field, scalarTypeCodecIds);
  if (!codecId) {
    diagnostics.push({
      code: 'PSL_UNSUPPORTED_FIELD_TYPE',
      message: `Field "${ownerName}.${field.name}" type "${field.typeName}" is not supported in Mongo PSL interpreter`,
      ...diagnosticSource(sources, field.node.syntax).at(field.span),
    });
    return undefined;
  }

  const result: ContractField = {
    type: { kind: 'scalar', codecId },
    nullable: field.optional,
  };
  return field.list ? { ...result, many: true } : result;
}

function processEnumDeclarations(input: {
  readonly enumSymbols: readonly BlockSymbol[];
  readonly sources: PslSources;
  readonly authoringContributions: AuthoringContributions | undefined;
  readonly entityContext: AuthoringEntityContext;
  readonly diagnostics: PslDiagnosticCollector;
}): Record<string, ContractEnum> {
  const builtEnums: Record<string, ContractEnum> = {};

  if (input.enumSymbols.length === 0) return builtEnums;

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
        message: `enum "${enumSymbol.block.name}" requires an "enum" entityType factory in the active authoring contributions`,
        ...source.at(enumSymbol.span),
      });
    }
    return builtEnums;
  }

  for (const enumSymbol of input.enumSymbols) {
    const sourceFile = input.sources.sourceFileFor(enumSymbol.node.syntax);
    const decl = enumSymbol.block;
    const handle = instantiateAuthoringEntityType<EnumTypeHandle | undefined>(
      'enum',
      enumDescriptor,
      [decl],
      { ...input.entityContext, sourceId: sourceFile.filename },
    );

    if (handle === undefined || handle === null) continue;

    builtEnums[decl.name] = {
      codecId: handle.codecId,
      members: handle.enumMembers.map((m) => ({
        name: m.name,
        value: blindCast<JsonValue, 'factory-validated enum members are JsonValue-compatible'>(
          m.value,
        ),
      })),
    };
  }

  return builtEnums;
}

export function interpretPslDocumentToMongoContract(
  input: InterpretPslDocumentToMongoContractInput,
): Result<Contract, ContractSourceDiagnostics> {
  const { symbolTable, sources, scalarTypeCodecIds, codecLookup } = input;
  const diagnostics = createPslDiagnosticCollector(sources);
  const topLevel = symbolTable.topLevel;
  validateNamespaceBlocksForMongoTarget({
    namespaces: Object.values(topLevel.namespaces),
    sources,
    diagnostics,
  });
  const allModels: ModelSymbol[] = Object.values(topLevel.models);
  const allCompositeTypes: CompositeTypeSymbol[] = Object.values(topLevel.compositeTypes);
  const modelNames = new Set(allModels.map((m) => m.name));
  const compositeTypeNames = new Set(allCompositeTypes.map((ct) => ct.name));
  reportUnknownAttributes({
    models: allModels,
    compositeTypes: allCompositeTypes,
    sources,
    diagnostics,
  });
  const specContextFor = (model: ModelSymbol): AttributeSpecContext => ({
    symbols: symbolTable,
    model,
    controlMutationDefaults: input.controlMutationDefaults,
  });
  const modelMetadataByName = new Map<string, MongoModelMetadata>();
  for (const model of allModels) {
    const specContext = specContextFor(model);
    modelMetadataByName.set(model.name, {
      collectionName: resolveCollectionName({
        model,
        specContext,
        sources,
        diagnostics,
      }),
      fieldMappings: resolveFieldMappings({
        model,
        specContext,
        sources,
        diagnostics,
      }),
    });
  }

  const topLevelEnumSymbols = Object.values(topLevel.blocks).filter((b) => b.keyword === 'enum');

  const builtEnums = processEnumDeclarations({
    enumSymbols: topLevelEnumSymbols,
    sources,
    authoringContributions: input.authoringContributions,
    entityContext: {
      family: 'mongo',
      target: 'mongo',
      ...ifDefined('enumInferenceCodecs', input.enumInferenceCodecs),
      ...ifDefined('codecLookup', codecLookup),
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
    Object.entries(builtEnums).map(([name, e]) => [name, e.codecId]),
  );

  const models: Record<string, MongoModelEntry> = {};
  const collections: Record<string, Record<string, unknown>> = {};
  const roots: Record<string, CrossReference> = {};
  const allFkRelations: FkRelation[] = [];
  const indexSpans = new Map<MongoIndex, PslSpan>();
  const indexSources = new Map<MongoIndex, DiagnosticSource>();
  const modelIndexesByName = new Map<string, readonly MongoIndex[]>();

  interface BackrelationCandidate {
    readonly modelName: string;
    readonly fieldName: string;
    readonly targetModelName: string;
    readonly relationName?: string;
    readonly cardinality: '1:1' | '1:N';
    readonly field: FieldSymbol;
  }
  const backrelationCandidates: BackrelationCandidate[] = [];
  const invalidFkPairings: InvalidFkPairing[] = [];

  for (const pslModel of allModels) {
    const modelSource = diagnosticSource(sources, pslModel.node.syntax);
    const metadata = modelMetadataByName.get(pslModel.name);
    if (!metadata) continue;
    const { collectionName, fieldMappings } = metadata;
    const specContext = specContextFor(pslModel);

    const fields: Record<string, ContractField> = {};
    const relations: Record<string, ContractReferenceRelation> = {};

    for (const field of Object.values(pslModel.fields)) {
      if (isRelationField(field, modelNames)) {
        const relationNode = findFieldAttributeNode(field, 'relation');
        const relation = relationNode
          ? interpretFieldAttribute({
              symbols: specContext.symbols,
              node: relationNode,
              spec: mongoAttributeSpecs.field.relation({ ...specContext, field }),
              model: pslModel,
              field,
              sources,
              diagnostics,
              resolveReferencedModel: () => allModels.find((m) => m.name === field.typeName),
            })
          : undefined;

        if (field.list || !(relation?.fields && relation?.references)) {
          backrelationCandidates.push({
            modelName: pslModel.name,
            fieldName: field.name,
            targetModelName: field.typeName,
            ...ifDefined('relationName', relation?.name),
            cardinality: field.list ? '1:N' : '1:1',
            field,
          });
          continue;
        }

        if (relation?.fields && relation?.references) {
          const nullability = resolveToOneRelationNullable({
            declaredNullable: field.optional,
            localFieldNullability: relation.fields.map(
              (localFieldName) => pslModel.fields[localFieldName]?.optional === true,
            ),
            ownsReference: true,
          });
          if (nullability.contradiction !== undefined) {
            diagnostics.push(relationNullabilityMismatchDiagnostic(pslModel.name, field, sources));
            invalidFkPairings.push({
              pairKey: fkRelationPairKey(pslModel.name, field.typeName),
              ...ifDefined('relationName', relation.name),
            });
            continue;
          }
          const localMapped = relation.fields.map((f) => fieldMappings.pslNameToMapped.get(f) ?? f);

          const targetFieldMappings = modelMetadataByName.get(field.typeName)?.fieldMappings;
          const targetMapped = relation.references.map(
            (f) => targetFieldMappings?.pslNameToMapped.get(f) ?? f,
          );

          relations[field.name] = {
            to: mongoCrossRef(field.typeName),
            cardinality: 'N:1' as const,
            nullable: field.optional,
            on: {
              localFields: localMapped,
              targetFields: targetMapped,
            },
          };

          allFkRelations.push({
            declaringModel: pslModel.name,
            fieldName: field.name,
            targetModel: field.typeName,
            ...ifDefined('relationName', relation.name),
            localFields: localMapped,
            targetFields: targetMapped,
          });
        }
        continue;
      }

      const resolved = resolveNonRelationField(
        field,
        pslModel.name,
        compositeTypeNames,
        scalarTypeCodecIds,
        codecIdByEnumName,
        sources,
        diagnostics,
      );
      if (!resolved) continue;

      const mappedName = fieldMappings.pslNameToMapped.get(field.name) ?? field.name;
      fields[mappedName] = resolved;
    }

    const isVariantModel = pslModel.attributes.some((attr) => attr.name === 'base');
    const hasIdField =
      Object.values(pslModel.fields).filter((field) => {
        const idNode = findFieldAttributeNode(field, 'id');
        if (!idNode) return false;
        return (
          interpretFieldAttribute({
            symbols: specContext.symbols,
            node: idNode,
            spec: mongoAttributeSpecs.field.id({ ...specContext, field }),
            model: pslModel,
            field,
            sources,
            diagnostics,
          }) !== undefined
        );
      }).length > 0;
    // Variant models inherit the base's identity and are validated through their base.
    if (!isVariantModel) {
      if (!hasIdField) {
        diagnostics.pushUnlocated({
          code: 'PSL_MISSING_ID_FIELD',
          message: `Model "${pslModel.name}" has no field with @id attribute. Every model must have exactly one @id field.`,
          ...modelSource.at(),
        });
      } else {
        // The resulting document must carry an `_id` of BSON type objectId. We
        // assert on the emitted shape (the mapped-name-keyed field record), not
        // on how the user spelled it — `id ObjectId @id @map("_id")` and a field
        // literally named `_id` both satisfy it; a non-objectId or unmapped id
        // does not.
        const objectIdCodecId = scalarTypeCodecIds.get(MONGO_OBJECT_ID_PSL_TYPE);
        const idField = fields['_id'];
        const idIsObjectId =
          idField !== undefined &&
          idField.type.kind === 'scalar' &&
          objectIdCodecId !== undefined &&
          idField.type.codecId === objectIdCodecId;
        if (!idIsObjectId) {
          diagnostics.pushUnlocated({
            code: 'PSL_MONGO_ID_REQUIRED',
            message: `Model "${pslModel.name}" must declare an _id field of type ObjectId (e.g. \`id ObjectId @id @map("_id")\`).`,
            ...modelSource.at(),
          });
        }
      }
    }

    models[pslModel.name] = { fields, relations, storage: { collection: collectionName } };
    const modelIndexes = collectIndexes(
      pslModel,
      specContext,
      fieldMappings,
      modelNames,
      sources,
      diagnostics,
      indexSpans,
      indexSources,
    );
    modelIndexesByName.set(pslModel.name, modelIndexes);
    const existingColl = collections[collectionName];
    if (existingColl && modelIndexes.length > 0) {
      const existingIndexes = collectionIndexes(existingColl);
      collections[collectionName] = { indexes: [...existingIndexes, ...modelIndexes] };
    } else if (!existingColl) {
      collections[collectionName] = modelIndexes.length > 0 ? { indexes: modelIndexes } : {};
    }
    roots[collectionName] = mongoCrossRef(pslModel.name);
  }

  const valueObjects: Record<string, ContractValueObject> = {};
  for (const compositeType of allCompositeTypes) {
    const fields: Record<string, ContractField> = {};
    for (const field of Object.values(compositeType.fields)) {
      const resolved = resolveNonRelationField(
        field,
        compositeType.name,
        compositeTypeNames,
        scalarTypeCodecIds,
        codecIdByEnumName,
        sources,
        diagnostics,
      );
      if (!resolved) continue;
      fields[field.name] = resolved;
    }
    valueObjects[compositeType.name] = { fields };
  }

  const fkRelationsByPair = new Map<string, FkRelation[]>();
  for (const fk of allFkRelations) {
    const key = fkRelationPairKey(fk.declaringModel, fk.targetModel);
    const existing = fkRelationsByPair.get(key);
    if (existing) {
      existing.push(fk);
    } else {
      fkRelationsByPair.set(key, [fk]);
    }
  }

  for (const candidate of backrelationCandidates) {
    const candidateSource = diagnosticSource(sources, candidate.field.node.syntax);
    const pairKey = fkRelationPairKey(candidate.targetModelName, candidate.modelName);
    const pairMatches = fkRelationsByPair.get(pairKey) ?? [];
    const matches = candidate.relationName
      ? pairMatches.filter((r) => r.relationName === candidate.relationName)
      : [...pairMatches];

    if (matches.length === 0) {
      if (consumeInvalidFkPairing(candidate, pairKey, invalidFkPairings)) {
        continue;
      }
      diagnostics.push({
        code: 'PSL_ORPHANED_BACKRELATION',
        message: `Backrelation list field "${candidate.modelName}.${candidate.fieldName}" has no matching FK-side relation on model "${candidate.targetModelName}". Add @relation(fields: [...], references: [...]) on the FK-side relation or use an explicit join model for many-to-many.`,
        ...candidateSource.at(candidate.field.span),
      });
      continue;
    }
    if (matches.length > 1) {
      diagnostics.push({
        code: 'PSL_AMBIGUOUS_BACKRELATION',
        message: `Backrelation list field "${candidate.modelName}.${candidate.fieldName}" matches multiple FK-side relations on model "${candidate.targetModelName}". Add @relation("...") to both sides to disambiguate.`,
        ...candidateSource.at(candidate.field.span),
      });
      continue;
    }

    const fk = matches[0];
    if (!fk) continue;
    const modelEntry = models[candidate.modelName];
    if (!modelEntry) continue;
    if (candidate.cardinality === '1:1' && !candidate.field.optional) {
      diagnostics.push(
        requiredOneToOneBackrelationDiagnostic({
          modelName: candidate.modelName,
          field: candidate.field,
          targetModelName: candidate.targetModelName,
          sources,
          recordNoun: 'document',
        }),
      );
    }
    modelEntry.relations[candidate.fieldName] = {
      to: mongoCrossRef(candidate.targetModelName),
      ...(candidate.cardinality === '1:N'
        ? { cardinality: '1:N' as const }
        : { cardinality: '1:1' as const, nullable: true }),
      on: {
        localFields: fk.targetFields,
        targetFields: fk.localFields,
      },
    };
  }

  const { discriminatorDeclarations, baseDeclarations } = collectPolymorphismDeclarations(
    allModels,
    specContextFor,
    modelMetadataByName,
    sources,
    diagnostics,
  );
  const polyResult = resolvePolymorphism({
    sources,
    models,
    roots,
    collections,
    discriminatorDeclarations,
    baseDeclarations,
    indexSpans,
    modelIndexesByName,
    modelMetadataByName,
    indexSources,
  });

  if (
    diagnostics.length > 0 ||
    polyResult.diagnostics.length > 0 ||
    (input.seedDiagnostics?.length ?? 0) > 0
  ) {
    return notOk({
      summary: 'PSL to Mongo contract interpretation failed',
      diagnostics: [
        ...(input.seedDiagnostics ?? []),
        ...diagnostics.toExternal(),
        ...polyResult.diagnostics.toExternal(),
      ],
    });
  }

  const resolvedModels = polyResult.models;
  const resolvedCollections = polyResult.collections;

  // The storage value set is the source of truth for both the emit typing and the validator's
  // `enum` keyword. Built once, ahead of validator derivation, from each enum's codec-encoded member
  // values (mirroring SQL's build-contract). Encoding needs the codec lookup; production always
  // threads it (the CLI control stack supplies it), so its absence when enums exist is a wiring bug,
  // not a runtime input to tolerate.
  const storageValueSets: Record<string, MongoValueSetInput> = {};
  const enumEntries = Object.entries(builtEnums);
  if (enumEntries.length > 0) {
    assertDefined(
      codecLookup,
      'Mongo PSL interpretation requires a codec lookup to encode enum values',
    );
    for (const [enumName, builtEnum] of enumEntries) {
      storageValueSets[enumName] = {
        kind: 'valueSet',
        values: builtEnum.members.map((m) =>
          encodeEnumValue(m.value, builtEnum.codecId, codecLookup),
        ),
      };
    }
  }

  for (const [, modelEntry] of Object.entries(resolvedModels)) {
    if (modelEntry.base) continue;

    const collectionName = modelEntry.storage.collection;
    const coll = resolvedCollections[collectionName];
    if (!coll) continue;

    if (modelEntry.discriminator && modelEntry.variants) {
      const variantEntries = Object.entries(modelEntry.variants).map(
        ([variantName, { value }]) => ({
          discriminatorValue: value,
          fields: resolvedModels[variantName]?.fields ?? {},
        }),
      );
      coll['validator'] = derivePolymorphicJsonSchema(
        modelEntry.fields,
        modelEntry.discriminator.field,
        variantEntries,
        valueObjects,
        codecLookup,
        storageValueSets,
      );
    } else {
      coll['validator'] = deriveJsonSchema(
        modelEntry.fields,
        valueObjects,
        codecLookup,
        storageValueSets,
      );
    }
  }

  const target = 'mongo';
  const targetFamily = 'mongo';
  const collectionInputs: Record<string, MongoCollectionInput> = {};
  for (const [name, coll] of Object.entries(resolvedCollections)) {
    const raw: Record<string, unknown> = {};
    if (coll['indexes'] != null) raw['indexes'] = coll['indexes'];
    if (coll['validator'] != null) raw['validator'] = coll['validator'];
    if (coll['options'] != null) raw['options'] = coll['options'];
    collectionInputs[name] = blindCast<
      MongoCollectionInput,
      'arktype-validated JSON shapes satisfy MongoCollectionInput by construction'
    >(raw);
  }
  const hasValueSets = Object.keys(storageValueSets).length > 0;

  const unboundNamespace = buildMongoNamespace({
    id: UNBOUND_NAMESPACE_ID,
    entries: {
      collection: collectionInputs,
      ...(hasValueSets ? { valueSet: storageValueSets } : {}),
    },
  });
  // Hash the constructed (normalized) entries, not the raw input literals —
  // persisted storageHash values were computed over the constructed form.
  const storageWithoutHash = {
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: {
        id: UNBOUND_NAMESPACE_ID,
        entries: {
          collection: unboundNamespace.entries.collection,
          ...(unboundNamespace.entries.valueSet !== undefined
            ? { valueSet: unboundNamespace.entries.valueSet }
            : {}),
        },
      },
    },
  };
  const storageHash = computeStorageHash({
    target,
    targetFamily,
    storage: storageWithoutHash,
    ...mongoContractCanonicalizationHooks,
  });
  const storage = blindCast<
    Contract['storage'],
    'MongoStorage is the Mongo family concrete storage class constructed here; it structurally satisfies the Contract storage slot.'
  >(
    new MongoStorage({
      storageHash,
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: unboundNamespace,
      },
    }),
  );
  const capabilities: Record<string, Record<string, boolean>> = {};

  const hasEnums = Object.keys(builtEnums).length > 0;

  return ok({
    targetFamily,
    target,
    roots: polyResult.roots,
    domain: {
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: {
          models: polyResult.models,
          ...(Object.keys(valueObjects).length > 0 ? { valueObjects } : {}),
          ...(hasEnums ? { enum: builtEnums } : {}),
        },
      },
    },
    storage,
    extensions: {},
    capabilities,
    profileHash: computeProfileHash({ target, targetFamily, capabilities }),
    meta: {},
  });
}
