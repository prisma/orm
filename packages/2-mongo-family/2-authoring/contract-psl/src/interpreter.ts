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
import type { EnumTypeHandle } from '@internal/contract-authoring';
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
  CompositeTypeSymbol,
  FieldSymbol,
  InferAttr,
  ModelSymbol,
  NamespaceSymbol,
  PslExtensionBlock,
  PslSpan,
  SymbolTable,
  TypedFuncCall,
} from '@internal/psl-parser';
import { nodePslSpan } from '@internal/psl-parser';
import type { SourceFile } from '@internal/psl-parser/syntax';
import { assertDefined } from '@internal/utils/assertions';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { notOk, ok, type Result } from '@internal/utils/result';
import { deriveJsonSchema, derivePolymorphicJsonSchema } from './derive-json-schema';
import {
  baseModelSpec,
  buildIndexModelSpecs,
  discriminatorModelSpec,
  findFieldAttributeNode,
  findModelAttributeNode,
  interpretFieldAttribute,
  interpretModelAttribute,
  type MongoProjectionList,
  mapFieldSpec,
  mapModelSpec,
  relationFieldSpec,
} from './mongo-attribute-specs';
import { getAttribute, lowerFirst, type ParsedIndexField } from './psl-helpers';

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
  readonly symbolTable: SymbolTable;
  readonly sourceFile: SourceFile;
  readonly sourceId: string;
  readonly scalarTypeCodecIds: ReadonlyMap<string, string>;
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
  readonly sourceId: string;
  readonly sourceFile: SourceFile;
  readonly diagnostics: ContractSourceDiagnostic[];
}): void {
  for (const namespace of input.namespaces) {
    input.diagnostics.push({
      code: 'PSL_UNSUPPORTED_NAMESPACE_BLOCK',
      message: `Mongo does not support \`namespace ${namespace.name} { … }\` blocks (the database is bound by the connection string; declare models at the document top level instead).`,
      sourceId: input.sourceId,
      span: nodePslSpan(namespace.node.syntax, input.sourceFile),
    });
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

function fkRelationPairKey(declaringModel: string, targetModel: string): string {
  return `${declaringModel}::${targetModel}`;
}

function resolveFieldMappings(input: {
  readonly model: ModelSymbol;
  readonly sourceFile: SourceFile;
  readonly sourceId: string;
  readonly diagnostics: ContractSourceDiagnostic[];
}): FieldMappings {
  const { model, sourceFile, sourceId, diagnostics } = input;
  const pslNameToMapped = new Map<string, string>();
  for (const field of Object.values(model.fields)) {
    const mapNode = findFieldAttributeNode(field, 'map');
    const mapped =
      (mapNode
        ? interpretFieldAttribute({
            node: mapNode,
            spec: mapFieldSpec,
            model,
            field,
            sourceFile,
            sourceId,
            diagnostics,
          })?.name
        : undefined) ?? field.name;
    pslNameToMapped.set(field.name, mapped);
  }
  return { pslNameToMapped };
}

function resolveCollectionName(input: {
  readonly model: ModelSymbol;
  readonly sourceFile: SourceFile;
  readonly sourceId: string;
  readonly diagnostics: ContractSourceDiagnostic[];
}): string {
  const { model, sourceFile, sourceId, diagnostics } = input;
  const mapNode = findModelAttributeNode(model, 'map');
  const name = mapNode
    ? interpretModelAttribute({
        node: mapNode,
        spec: mapModelSpec,
        model,
        sourceFile,
        sourceId,
        diagnostics,
      })?.name
    : undefined;
  return name ?? lowerFirst(model.name);
}

interface MongoModelEntry {
  readonly fields: Record<string, ContractField>;
  readonly relations: Record<string, ContractReferenceRelation>;
  readonly storage: { readonly collection: string };
  readonly discriminator?: { readonly field: string };
  readonly variants?: Record<string, { readonly value: string }>;
  readonly base?: CrossReference;
}

type DiscriminatorDeclaration = { readonly fieldName: string; readonly span: PslSpan };
type BaseDeclaration = {
  readonly baseName: string;
  readonly value: string;
  readonly collectionName: string;
  readonly span: PslSpan;
};

function mongoCrossRef(modelName: string): CrossReference {
  return crossRef(modelName, UNBOUND_NAMESPACE_ID);
}

function collectPolymorphismDeclarations(
  models: readonly ModelSymbol[],
  modelMetadataByName: ReadonlyMap<string, MongoModelMetadata>,
  sourceFile: SourceFile,
  sourceId: string,
  diagnostics: ContractSourceDiagnostic[],
): {
  discriminatorDeclarations: Map<string, DiscriminatorDeclaration>;
  baseDeclarations: Map<string, BaseDeclaration>;
} {
  const discriminatorDeclarations = new Map<string, DiscriminatorDeclaration>();
  const baseDeclarations = new Map<string, BaseDeclaration>();

  for (const model of models) {
    const discNode = findModelAttributeNode(model, 'discriminator');
    if (discNode) {
      const parsed = interpretModelAttribute({
        node: discNode,
        spec: discriminatorModelSpec,
        model,
        sourceFile,
        sourceId,
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
            sourceId,
            span: nodePslSpan(discNode.syntax, sourceFile),
          });
        } else {
          discriminatorDeclarations.set(model.name, {
            fieldName,
            span: nodePslSpan(discNode.syntax, sourceFile),
          });
        }
      }
    }
    const baseNode = findModelAttributeNode(model, 'base');
    if (baseNode) {
      const parsed = interpretModelAttribute({
        node: baseNode,
        spec: baseModelSpec,
        model,
        sourceFile,
        sourceId,
        diagnostics,
      });
      if (parsed) {
        const collectionName =
          modelMetadataByName.get(model.name)?.collectionName ?? lowerFirst(model.name);
        baseDeclarations.set(model.name, {
          baseName: parsed.base,
          value: parsed.value,
          collectionName,
          span: nodePslSpan(baseNode.syntax, sourceFile),
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
  allModels: readonly ModelSymbol[];
  discriminatorDeclarations: Map<string, DiscriminatorDeclaration>;
  baseDeclarations: Map<string, BaseDeclaration>;
  modelNames: ReadonlySet<string>;
  indexSpans: Map<MongoIndex, PslSpan>;
  modelIndexesByName: Map<string, readonly MongoIndex[]>;
  modelMetadataByName: ReadonlyMap<string, MongoModelMetadata>;
  sourceId: string;
}): {
  models: Record<string, MongoModelEntry>;
  roots: Record<string, CrossReference>;
  collections: Record<string, Record<string, unknown>>;
  diagnostics: ContractSourceDiagnostic[];
} {
  const {
    discriminatorDeclarations,
    baseDeclarations,
    modelNames,
    modelMetadataByName,
    sourceId,
    allModels: allModelViews,
    indexSpans,
    modelIndexesByName,
  } = input;
  let patched = input.models;
  let roots = input.roots;
  let collections = input.collections;
  const diagnostics: ContractSourceDiagnostic[] = [];

  for (const [modelName, decl] of discriminatorDeclarations) {
    if (baseDeclarations.has(modelName)) {
      diagnostics.push({
        code: 'PSL_DISCRIMINATOR_AND_BASE',
        message: `Model "${modelName}" cannot have both @@discriminator and @@base`,
        sourceId,
        span: decl.span,
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
        sourceId,
        span: decl.span,
      });
      continue;
    }

    const variants: Record<string, { readonly value: string }> = {};
    for (const [variantName, baseDecl] of baseDeclarations) {
      if (baseDecl.baseName !== modelName) continue;
      variants[variantName] = { value: baseDecl.value };
    }

    if (Object.keys(variants).length === 0) {
      diagnostics.push({
        code: 'PSL_ORPHANED_DISCRIMINATOR',
        message: `Model "${modelName}" has @@discriminator but no variant models declare @@base(${modelName}, ...)`,
        sourceId,
        span: decl.span,
      });
      continue;
    }

    patched = {
      ...patched,
      [modelName]: { ...model, discriminator: { field: mappedDiscriminatorField }, variants },
    };
  }

  for (const [variantName, baseDecl] of baseDeclarations) {
    if (!modelNames.has(baseDecl.baseName)) {
      diagnostics.push({
        code: 'PSL_BASE_TARGET_NOT_FOUND',
        message: `Model "${variantName}" @@base references non-existent model "${baseDecl.baseName}"`,
        sourceId,
        span: baseDecl.span,
      });
      continue;
    }

    if (!discriminatorDeclarations.has(baseDecl.baseName)) {
      diagnostics.push({
        code: 'PSL_ORPHANED_BASE',
        message: `Model "${variantName}" declares @@base(${baseDecl.baseName}, ...) but "${baseDecl.baseName}" has no @@discriminator`,
        sourceId,
        span: baseDecl.span,
      });
      continue;
    }

    if (discriminatorDeclarations.has(variantName)) {
      continue;
    }

    const baseModel = patched[baseDecl.baseName];
    const variantModelView = allModelViews.find((m) => m.name === variantName);
    if (!variantModelView) continue;
    const hasExplicitMap = getAttribute(variantModelView.attributes, 'map') !== undefined;

    if (hasExplicitMap && baseModel && baseDecl.collectionName !== baseModel.storage.collection) {
      diagnostics.push({
        code: 'PSL_MONGO_VARIANT_SEPARATE_COLLECTION',
        message: `Mongo variant "${variantName}" cannot use a different collection than its base "${baseDecl.baseName}". Mongo only supports single-collection polymorphism.`,
        sourceId,
        span: baseDecl.span,
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
          base: mongoCrossRef(baseDecl.baseName),
          storage: { collection: baseCollection },
        },
      };
    }

    const variantCollectionName =
      modelMetadataByName.get(variantName)?.collectionName ?? lowerFirst(variantName);
    if (roots[variantCollectionName]?.model === variantName) {
      if (variantCollectionName === baseCollection && baseModel) {
        roots = { ...roots, [variantCollectionName]: mongoCrossRef(baseDecl.baseName) };
      } else {
        roots = Object.fromEntries(
          Object.entries(roots).filter(([key]) => key !== variantCollectionName),
        );
      }
    }

    const variantOwnIndexes = modelIndexesByName.get(variantName) ?? [];
    const baseColl = collections[baseCollection];

    const baseModelEntry = patched[baseDecl.baseName];
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
            sourceId,
            span,
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

// The spec's pinned `type` combinators already constrain the value to the exact
// index-direction alphabet at runtime; normalize it to the Mongo key-direction
// type, defaulting to ascending (1) when absent.
function normalizeIndexType(value: number | string | undefined): MongoIndexKeyDirection {
  switch (value) {
    case -1:
      return -1;
    case 'text':
      return 'text';
    case '2dsphere':
      return '2dsphere';
    case '2d':
      return '2d';
    case 'hashed':
      return 'hashed';
    default:
      return 1;
  }
}

// Map one interpreted `@@index`/`@@unique` field element to the same
// `ParsedIndexField` shape the loop consumes. Discriminates the element union
// structurally (a bare string field, a `wildcard(scope?)` call, or a
// `field(sort:)` call) so no cast is needed; `args` values are `unknown` and
// narrowed by comparison.
function normalizeIndexField(element: string | TypedFuncCall): ParsedIndexField {
  if (typeof element === 'string') {
    return { name: element, isWildcard: false };
  }
  if (element.fn === 'wildcard' && element.args['sort'] === undefined) {
    const scope = element.args['scope'];
    return {
      name: typeof scope === 'string' ? `${scope}.$**` : '$**',
      isWildcard: true,
    };
  }
  const sort = element.args['sort'];
  return { name: element.fn, isWildcard: false, direction: sort === 'Desc' ? -1 : 1 };
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

type IndexModelSpecs = ReturnType<typeof buildIndexModelSpecs>;
type NormalIndexArgs = InferAttr<IndexModelSpecs['index']>;
type TextIndexArgs = InferAttr<IndexModelSpecs['textIndex']>;

interface IndexBuildContext {
  readonly pslModel: ModelSymbol;
  readonly fieldMappings: FieldMappings;
  readonly indexableFieldNames: ReadonlySet<string>;
  readonly sourceId: string;
  readonly span: PslSpan;
  readonly diagnostics: ContractSourceDiagnostic[];
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
  const wildcardCount = parsedFields.filter((field) => field.isWildcard).length;
  if (wildcardCount > 1) {
    ctx.diagnostics.push({
      code: 'PSL_INVALID_INDEX',
      message: 'An index can contain at most one wildcard() field',
      sourceId: ctx.sourceId,
      span: ctx.span,
    });
    return undefined;
  }

  for (const field of parsedFields) {
    const wildcardMatch = field.isWildcard ? field.name.match(/^(.+)\.\$\*\*$/) : undefined;
    const fieldName = field.isWildcard ? wildcardMatch?.[1] : field.name;
    if (fieldName !== undefined && !ctx.indexableFieldNames.has(fieldName)) {
      ctx.diagnostics.push({
        code: 'PSL_INDEX_FIELD_NOT_FOUND',
        message: `Index on model "${ctx.pslModel.name}" references unknown field "${fieldName}"`,
        sourceId: ctx.sourceId,
        span: ctx.span,
      });
      return undefined;
    }
  }

  const keys = parsedFields.map((field) => {
    const mappedName = field.isWildcard
      ? field.name.replace(/^(.+)\.\$\*\*$/, (_, prefix: string) => {
          const mapped = ctx.fieldMappings.pslNameToMapped.get(prefix);
          return mapped ? `${mapped}.$**` : `${prefix}.$**`;
        })
      : (ctx.fieldMappings.pslNameToMapped.get(field.name) ?? field.name);
    return { field: mappedName, direction: field.direction ?? defaultDirection };
  });
  return { keys, hasWildcard: wildcardCount === 1 };
}

function buildProjection(
  include: MongoProjectionList | undefined,
  exclude: MongoProjectionList | undefined,
  hasWildcard: boolean,
  ctx: IndexBuildContext,
): Record<string, 0 | 1> | null | undefined {
  if (include !== undefined && exclude !== undefined) {
    ctx.diagnostics.push({
      code: 'PSL_INVALID_INDEX',
      message: 'Cannot specify both include and exclude on the same index',
      sourceId: ctx.sourceId,
      span: ctx.span,
    });
    return null;
  }
  const fields = include ?? exclude;
  if (fields === undefined) return undefined;
  if (!hasWildcard) {
    ctx.diagnostics.push({
      code: 'PSL_INVALID_INDEX',
      message: 'include/exclude options are only valid when the index contains a wildcard() field',
      sourceId: ctx.sourceId,
      span: ctx.span,
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
  const defaultDirection = normalizeIndexType(parsed.type);
  const resolved = resolveIndexKeys(parsedFields, defaultDirection, ctx);
  if (!resolved) return undefined;

  if (unique && resolved.hasWildcard) {
    ctx.diagnostics.push({
      code: 'PSL_INVALID_INDEX',
      message: 'Unique indexes cannot use wildcard() fields',
      sourceId: ctx.sourceId,
      span: ctx.span,
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
      sourceId: ctx.sourceId,
      span: ctx.span,
    });
    return undefined;
  }
  if (defaultDirection === 'hashed' && parsedFields.length > 1) {
    ctx.diagnostics.push({
      code: 'PSL_INVALID_INDEX',
      message: 'Hashed indexes must have exactly one field',
      sourceId: ctx.sourceId,
      span: ctx.span,
    });
    return undefined;
  }
  if (resolved.hasWildcard && parsed.expireAfterSeconds !== undefined) {
    ctx.diagnostics.push({
      code: 'PSL_INVALID_INDEX',
      message: 'expireAfterSeconds cannot be combined with wildcard() fields',
      sourceId: ctx.sourceId,
      span: ctx.span,
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
      sourceId: ctx.sourceId,
      span: ctx.span,
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
      sourceId: ctx.sourceId,
      span: ctx.span,
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
      sourceId: ctx.sourceId,
      span: ctx.span,
    });
    return undefined;
  }

  return new MongoIndex({
    keys: resolved.keys,
    ...(parsed.filter !== undefined && { partialFilterExpression: parsed.filter }),
    ...(wildcardProjection !== undefined && { wildcardProjection }),
    ...(collation !== undefined && { collation }),
    ...ifDefined('weights', parsed.weights),
    ...(parsed.language !== undefined && { default_language: parsed.language }),
    ...(parsed.languageOverride !== undefined && { language_override: parsed.languageOverride }),
  });
}

function collectIndexes(
  pslModel: ModelSymbol,
  fieldMappings: FieldMappings,
  modelNames: ReadonlySet<string>,
  sourceId: string,
  sourceFile: SourceFile,
  diagnostics: ContractSourceDiagnostic[],
  indexSpans: Map<MongoIndex, PslSpan>,
): MongoIndex[] {
  const indexes: MongoIndex[] = [];
  let textIndexCount = 0;
  const indexableFieldNames = new Set<string>();
  for (const field of Object.values(pslModel.fields)) {
    if (!modelNames.has(field.typeName)) indexableFieldNames.add(field.name);
  }

  for (const field of Object.values(pslModel.fields)) {
    if (modelNames.has(field.typeName)) continue;
    const uniqueAttr = getAttribute(field.attributes, 'unique');
    if (!uniqueAttr) continue;
    const mappedName = fieldMappings.pslNameToMapped.get(field.name) ?? field.name;
    const fieldUniqueIndex = new MongoIndex({
      keys: [{ field: mappedName, direction: 1 }],
      unique: true,
    });
    indexes.push(fieldUniqueIndex);
    indexSpans.set(fieldUniqueIndex, uniqueAttr.span);
  }

  const specs = buildIndexModelSpecs(Object.keys(pslModel.fields));
  const attributeNodes = Array.from(pslModel.node.attributes());
  for (const [attrIndex, attr] of pslModel.attributes.entries()) {
    if (attr.name !== 'index' && attr.name !== 'unique' && attr.name !== 'textIndex') continue;
    const node = attributeNodes[attrIndex];
    if (!node) continue;
    const ctx: IndexBuildContext = {
      pslModel,
      fieldMappings,
      indexableFieldNames,
      sourceId,
      span: attr.span,
      diagnostics,
    };

    let index: MongoIndex | undefined;
    if (attr.name === 'textIndex') {
      const parsed = interpretModelAttribute({
        node,
        spec: specs.textIndex,
        model: pslModel,
        sourceFile,
        sourceId,
        diagnostics,
      });
      if (!parsed || parsed.fields.length === 0) continue;
      textIndexCount++;
      if (textIndexCount > 1) {
        diagnostics.push({
          code: 'PSL_INVALID_INDEX',
          message: `Only one @@textIndex is allowed per collection (model "${pslModel.name}")`,
          sourceId,
          span: attr.span,
        });
        continue;
      }
      index = buildTextIndex(parsed, ctx);
    } else {
      const unique = attr.name === 'unique';
      const parsed = interpretModelAttribute({
        node,
        spec: unique ? specs.unique : specs.index,
        model: pslModel,
        sourceFile,
        sourceId,
        diagnostics,
      });
      if (!parsed) continue;
      index = buildNormalIndex(parsed, unique, ctx);
    }

    if (!index) continue;
    indexes.push(index);
    indexSpans.set(index, attr.span);
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
  sourceId: string,
  diagnostics: ContractSourceDiagnostic[],
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
      sourceId,
      span: field.span,
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
  readonly enumBlocks: readonly PslExtensionBlock[];
  readonly sourceId: string;
  readonly authoringContributions: AuthoringContributions | undefined;
  readonly entityContext: AuthoringEntityContext;
  readonly diagnostics: ContractSourceDiagnostic[];
}): Record<string, ContractEnum> {
  const builtEnums: Record<string, ContractEnum> = {};

  if (input.enumBlocks.length === 0) return builtEnums;

  const enumDescriptor =
    input.authoringContributions?.entityTypes?.['enum'] !== undefined &&
    isAuthoringEntityTypeDescriptor(input.authoringContributions.entityTypes['enum'])
      ? input.authoringContributions.entityTypes['enum']
      : undefined;

  if (!enumDescriptor) {
    for (const decl of input.enumBlocks) {
      input.diagnostics.push({
        code: 'PSL_ENUM_MISSING_FACTORY',
        message: `enum "${decl.name}" requires an "enum" entityType factory in the active authoring contributions`,
        sourceId: input.sourceId,
        span: decl.span,
      });
    }
    return builtEnums;
  }

  for (const decl of input.enumBlocks) {
    const handle = instantiateAuthoringEntityType<EnumTypeHandle | undefined>(
      'enum',
      enumDescriptor,
      [decl],
      input.entityContext,
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
  const { symbolTable, sourceFile, scalarTypeCodecIds, codecLookup } = input;
  const sourceId = input.sourceId;
  const diagnostics: ContractSourceDiagnostic[] = [...(input.seedDiagnostics ?? [])];
  const topLevel = symbolTable.topLevel;
  validateNamespaceBlocksForMongoTarget({
    namespaces: Object.values(topLevel.namespaces),
    sourceId,
    sourceFile,
    diagnostics,
  });
  const allModels: ModelSymbol[] = Object.values(topLevel.models);
  const allCompositeTypes: CompositeTypeSymbol[] = Object.values(topLevel.compositeTypes);
  const modelNames = new Set(allModels.map((m) => m.name));
  const compositeTypeNames = new Set(allCompositeTypes.map((ct) => ct.name));
  const modelMetadataByName = new Map<string, MongoModelMetadata>();
  for (const model of allModels) {
    modelMetadataByName.set(model.name, {
      collectionName: resolveCollectionName({ model, sourceFile, sourceId, diagnostics }),
      fieldMappings: resolveFieldMappings({ model, sourceFile, sourceId, diagnostics }),
    });
  }

  const topLevelEnumBlocks = Object.values(topLevel.blocks)
    .filter((b) => b.keyword === 'enum')
    .map((b) => b.block);

  const builtEnums = processEnumDeclarations({
    enumBlocks: topLevelEnumBlocks,
    sourceId,
    authoringContributions: input.authoringContributions,
    entityContext: {
      family: 'mongo',
      target: 'mongo',
      ...ifDefined('enumInferenceCodecs', input.enumInferenceCodecs),
      ...ifDefined('codecLookup', codecLookup),
      sourceId,
      diagnostics: {
        push: (d) => {
          diagnostics.push(
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

  for (const pslModel of allModels) {
    const metadata = modelMetadataByName.get(pslModel.name);
    if (!metadata) continue;
    const { collectionName, fieldMappings } = metadata;

    const fields: Record<string, ContractField> = {};
    const relations: Record<string, ContractReferenceRelation> = {};

    for (const field of Object.values(pslModel.fields)) {
      if (isRelationField(field, modelNames)) {
        const relationNode = findFieldAttributeNode(field, 'relation');
        const relation = relationNode
          ? interpretFieldAttribute({
              node: relationNode,
              spec: relationFieldSpec,
              model: pslModel,
              field,
              sourceFile,
              sourceId,
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
          const localMapped = relation.fields.map((f) => fieldMappings.pslNameToMapped.get(f) ?? f);

          const targetFieldMappings = modelMetadataByName.get(field.typeName)?.fieldMappings;
          const targetMapped = relation.references.map(
            (f) => targetFieldMappings?.pslNameToMapped.get(f) ?? f,
          );

          relations[field.name] = {
            to: mongoCrossRef(field.typeName),
            cardinality: 'N:1' as const,
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
        sourceId,
        diagnostics,
      );
      if (!resolved) continue;

      const mappedName = fieldMappings.pslNameToMapped.get(field.name) ?? field.name;
      fields[mappedName] = resolved;
    }

    const isVariantModel = pslModel.attributes.some((attr) => attr.name === 'base');
    const hasIdField = Object.values(pslModel.fields).some(
      (f) => getAttribute(f.attributes, 'id') !== undefined,
    );
    // Variant models inherit the base's identity and are validated through their base.
    if (!isVariantModel) {
      if (!hasIdField) {
        diagnostics.push({
          code: 'PSL_MISSING_ID_FIELD',
          message: `Model "${pslModel.name}" has no field with @id attribute. Every model must have exactly one @id field.`,
          sourceId,
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
          diagnostics.push({
            code: 'PSL_MONGO_ID_REQUIRED',
            message: `Model "${pslModel.name}" must declare an _id field of type ObjectId (e.g. \`id ObjectId @id @map("_id")\`).`,
            sourceId,
          });
        }
      }
    }

    models[pslModel.name] = { fields, relations, storage: { collection: collectionName } };
    const modelIndexes = collectIndexes(
      pslModel,
      fieldMappings,
      modelNames,
      sourceId,
      sourceFile,
      diagnostics,
      indexSpans,
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
        sourceId,
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
    const pairKey = fkRelationPairKey(candidate.targetModelName, candidate.modelName);
    const pairMatches = fkRelationsByPair.get(pairKey) ?? [];
    const matches = candidate.relationName
      ? pairMatches.filter((r) => r.relationName === candidate.relationName)
      : [...pairMatches];

    if (matches.length === 0) {
      diagnostics.push({
        code: 'PSL_ORPHANED_BACKRELATION',
        message: `Backrelation list field "${candidate.modelName}.${candidate.fieldName}" has no matching FK-side relation on model "${candidate.targetModelName}". Add @relation(fields: [...], references: [...]) on the FK-side relation or use an explicit join model for many-to-many.`,
        sourceId,
        span: candidate.field.span,
      });
      continue;
    }
    if (matches.length > 1) {
      diagnostics.push({
        code: 'PSL_AMBIGUOUS_BACKRELATION',
        message: `Backrelation list field "${candidate.modelName}.${candidate.fieldName}" matches multiple FK-side relations on model "${candidate.targetModelName}". Add @relation("...") to both sides to disambiguate.`,
        sourceId,
        span: candidate.field.span,
      });
      continue;
    }

    const fk = matches[0];
    if (!fk) continue;
    const modelEntry = models[candidate.modelName];
    if (!modelEntry) continue;
    modelEntry.relations[candidate.fieldName] = {
      to: mongoCrossRef(candidate.targetModelName),
      cardinality: candidate.cardinality,
      on: {
        localFields: fk.targetFields,
        targetFields: fk.localFields,
      },
    };
  }

  const { discriminatorDeclarations, baseDeclarations } = collectPolymorphismDeclarations(
    allModels,
    modelMetadataByName,
    sourceFile,
    sourceId,
    diagnostics,
  );
  const polyResult = resolvePolymorphism({
    models,
    roots,
    collections,
    allModels,
    discriminatorDeclarations,
    baseDeclarations,
    modelNames,
    indexSpans,
    modelIndexesByName,
    modelMetadataByName,
    sourceId,
  });

  if (diagnostics.length > 0 || polyResult.diagnostics.length > 0) {
    return notOk({
      summary: 'PSL to Mongo contract interpretation failed',
      diagnostics: [...diagnostics, ...polyResult.diagnostics],
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
