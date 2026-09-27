import type {
  ContractSourceDiagnostic,
  ContractSourceDiagnostics,
} from '@internal/config/config-types';
import { computeProfileHash } from '@internal/contract/hashing';
import {
  type Contract,
  type ContractEnum,
  type ContractField,
  type ContractReferenceRelation,
  type ContractValueObject,
  type CrossReference,
  crossRef,
  type ExecutionMutationDefault,
  type ExecutionMutationDefaultPhases,
  type JsonValue,
  type ValueSetRef,
} from '@internal/contract/types';
import { type EnumTypeHandle, resolveToOneRelationNullable } from '@internal/contract-authoring';
import {
  type AuthoringEntityContext,
  instantiateAuthoringEntityType,
  isAuthoringEntityTypeDescriptor,
  type PslExtensionBlock,
} from '@internal/framework-components/authoring';
import type { CodecLookup } from '@internal/framework-components/codec';
import type { AssembledAuthoringContributions } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import {
  buildMongoExecutionSection,
  buildMongoStorage,
  encodeMongoValueSets,
  type MongoCollectionInput,
  MongoIndex,
  type MongoIndexKeyDirection,
} from '@internal/mongo-contract';
import {
  type MongoBackRelationCandidate,
  type MongoForeignKeyRelation,
  pairMongoBackRelations,
} from '@internal/mongo-contract-psl';
import {
  type BlockSymbol,
  buildSymbolTable,
  type CompositeTypeSymbol,
  type FieldSymbol,
  keywordPslSpan,
  type ModelSymbol,
  mapPslDiagnostics,
  nodePslSpan,
  type PslSpan,
  type ResolvedAttribute,
  readResolvedAttribute,
  readResolvedAttributes,
} from '@internal/psl-parser';
import { fkRelationPairKey, type InvalidFkPairing } from '@internal/psl-parser/interpret';
import type { DocumentAst, PslSources, SourceFile } from '@internal/psl-parser/syntax';
import {
  ArrayLiteralAst,
  FunctionCallAst,
  IdentifierAst,
  StringLiteralExprAst,
} from '@internal/psl-parser/syntax';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import { notOk, ok, type Result } from '@internal/utils/result';
import { basename } from 'pathe';
import { prisma6Diagnostic } from './diagnostics';
import {
  type IndexAttribute,
  type IndexField,
  parseFieldUnique,
  parseIndexAttribute,
} from './indexes';
import type { Prisma6TargetBinding } from './target-binding';

export interface Prisma6Document {
  readonly document: DocumentAst;
  readonly sources: PslSources;
  readonly sourceFile: SourceFile;
  readonly sourceId: string;
}

export interface InterpretPrisma6DocumentsInput {
  readonly documents: readonly Prisma6Document[];
  readonly seedDiagnostics: readonly ContractSourceDiagnostic[];
  readonly binding: Prisma6TargetBinding;
  readonly authoringContributions: AssembledAuthoringContributions;
  readonly codecLookup: CodecLookup;
}

const SUMMARY = 'Prisma 6 MongoDB schema interpretation failed';

interface Located<T> {
  readonly symbol: T;
  readonly sourceId: string;
  readonly sources: PslSources;
}

type Diagnostics = ContractSourceDiagnostic[];

interface EnumBuild {
  readonly codecId: string;
  readonly members: readonly { readonly name: string; readonly value: unknown }[];
}

interface ModelBuild {
  readonly located: Located<ModelSymbol>;
  readonly collection: string;
  /** Prisma 6 field name to stored field name, for every field that is not a relation field. */
  readonly storedNames: Map<string, string>;
  readonly ignoredFields: Set<string>;
  readonly rejectedFields: Set<string>;
  readonly fields: Record<string, ContractField>;
  readonly relations: Record<string, ContractReferenceRelation>;
  readonly executionDefaults: {
    readonly field: string;
    readonly phases: ExecutionMutationDefaultPhases;
  }[];
  readonly uniqueFields: IndexAttribute[];
  readonly modelIndexes: IndexAttribute[];
  readonly relationFields: {
    readonly field: FieldSymbol;
    readonly relation: ResolvedAttribute | undefined;
  }[];
  hasId: boolean;
}

function stringArgument(attribute: ResolvedAttribute): string | undefined {
  const argument =
    attribute.args.find((arg) => arg.kind === 'positional') ??
    attribute.args.find((arg) => arg.name === 'name');
  const expression = argument?.expression;
  return expression === undefined
    ? undefined
    : StringLiteralExprAst.cast(expression.syntax)?.value();
}

function requireString(
  attribute: ResolvedAttribute,
  owner: string,
  sourceId: string,
  diagnostics: Diagnostics,
): string | undefined {
  const value = stringArgument(attribute);
  if (value === undefined) {
    diagnostics.push({
      code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
      message: `${owner}: attribute "@${attribute.name}" expects one string argument.`,
      sourceId,
      span: attribute.span,
    });
  }
  return value;
}

function attributeText(attribute: ResolvedAttribute): string {
  const args = attribute.args.map((arg) =>
    arg.kind === 'named' ? `${arg.name}: ${arg.value}` : arg.value,
  );
  return args.length === 0 ? `@${attribute.name}` : `@${attribute.name}(${args.join(', ')})`;
}

/** `auto()` and `now()` with no arguments; any other `@default` value is `other`. */
function defaultKind(attribute: ResolvedAttribute): 'auto' | 'now' | 'other' {
  const expression = attribute.args.find((arg) => arg.kind === 'positional')?.expression;
  const call = expression === undefined ? undefined : FunctionCallAst.cast(expression.syntax);
  if (call === undefined || [...call.args()].length > 0) return 'other';
  const path = call.path().join('.');
  return path === 'auto' ? 'auto' : path === 'now' ? 'now' : 'other';
}

function unknownAttribute(
  owner: string,
  attribute: ResolvedAttribute,
  prefix: '@' | '@@',
  sourceId: string,
): ContractSourceDiagnostic {
  return prisma6Diagnostic(
    'PSL.PRISMA6_MONGO_UNKNOWN_ATTRIBUTE',
    `${owner}: attribute "${prefix}${attribute.name}" is not supported by the Prisma 6 MongoDB contract source.`,
    sourceId,
    attribute.span,
  );
}

export function interpretPrisma6Documents(
  input: InterpretPrisma6DocumentsInput,
): Result<Contract, ContractSourceDiagnostics> {
  const { binding } = input;
  const diagnostics: Diagnostics = [...input.seedDiagnostics];
  const datasources: Located<BlockSymbol>[] = [];
  const enumBlocks: Located<BlockSymbol>[] = [];
  const compositeTypes: Located<CompositeTypeSymbol>[] = [];
  const models: Located<ModelSymbol>[] = [];
  const ignoredModels = new Set<string>();
  const declaredNames = new Map<string, string>();
  const claimName = (kind: string, name: string, sourceId: string, span: PslSpan): boolean => {
    const previous = declaredNames.get(name);
    if (previous === undefined) {
      declaredNames.set(name, sourceId);
      return true;
    }
    diagnostics.push({
      code: 'PSL_DUPLICATE_DECLARATION',
      message: `Duplicate declaration of ${kind} "${name}"; first declared in ${basename(previous)}.`,
      sourceId,
      span,
    });
    return false;
  };

  for (const { document, sources, sourceFile, sourceId } of input.documents) {
    const { symbolTable, diagnostics: tableDiagnostics } = buildSymbolTable({
      documents: [document],
      sources,
      pslBlockDescriptors: {},
    });
    for (const diagnostic of tableDiagnostics) {
      diagnostics.push({
        code: diagnostic.code,
        message: diagnostic.message,
        sourceId,
        span: sourceFile.rangeToPslSpan(diagnostic.range),
      });
    }
    const unsupported = (keyword: string, span: PslSpan): void => {
      diagnostics.push({
        code: 'PSL_UNSUPPORTED_TOP_LEVEL_BLOCK',
        message: `Unsupported top-level block "${keyword}"`,
        sourceId,
        span,
      });
    };
    for (const block of Object.values(symbolTable.topLevel.blocks)) {
      switch (block.keyword) {
        case 'datasource':
          datasources.push({ symbol: block, sourceId, sources });
          break;
        case 'generator':
          break;
        case 'enum':
          if (claimName('enum', block.name, sourceId, block.span)) {
            enumBlocks.push({ symbol: block, sourceId, sources });
          }
          break;
        case 'view':
          diagnostics.push(
            prisma6Diagnostic(
              'PSL.PRISMA6_MONGO_VIEW_UNSUPPORTED',
              `View "${block.name}" is not supported; Prisma 8 has no views on MongoDB. Remove the view from the schema this contract source reads.`,
              sourceId,
              keywordPslSpan(block.node.syntax, block.keyword, sources),
            ),
          );
          break;
        default:
          unsupported(block.keyword, keywordPslSpan(block.node.syntax, block.keyword, sources));
      }
    }
    for (const namespace of Object.values(symbolTable.topLevel.namespaces)) {
      for (const { span } of namespace.declarations) unsupported('namespace', span);
    }
    for (const namedType of Object.values(symbolTable.topLevel.namedTypes)) {
      unsupported('types', namedType.span);
    }
    for (const symbol of Object.values(symbolTable.topLevel.compositeTypes)) {
      if (claimName('type', symbol.name, sourceId, symbol.span)) {
        compositeTypes.push({ symbol, sourceId, sources });
      }
    }
    for (const symbol of Object.values(symbolTable.topLevel.models)) {
      if (!claimName('model', symbol.name, sourceId, symbol.span)) continue;
      if (symbol.attributes.some((attribute) => attribute.name === 'ignore')) {
        ignoredModels.add(symbol.name);
      } else {
        models.push({ symbol, sourceId, sources });
      }
    }
  }

  checkDatasource(
    datasources,
    input.documents[0]?.sourceId ?? 'schema.prisma',
    binding,
    diagnostics,
  );

  const enums = new Map<string, EnumBuild>();
  for (const located of enumBlocks) {
    const built = buildEnum(located, input, diagnostics);
    if (built !== undefined) enums.set(located.symbol.name, built);
  }

  const modelNames = new Set([...models.map((m) => m.symbol.name), ...ignoredModels]);
  const compositeTypeNames = new Set(compositeTypes.map((c) => c.symbol.name));
  const typeContext: TypeContext = { binding, enums, compositeTypeNames, diagnostics };

  const valueObjects: Record<string, ContractValueObject> = {};
  for (const located of compositeTypes) {
    valueObjects[located.symbol.name] = { fields: readCompositeFields(located, typeContext) };
  }

  const builds = new Map<string, ModelBuild>();
  for (const located of models) {
    builds.set(located.symbol.name, readModel(located, modelNames, ignoredModels, typeContext));
  }

  const foreignKeys: MongoForeignKeyRelation[] = [];
  const invalidFkPairings: InvalidFkPairing[] = [];
  const backRelations: MongoBackRelationCandidate[] = [];
  for (const build of builds.values()) {
    readRelationFields(
      build,
      builds,
      { foreignKeys, invalidFkPairings, backRelations },
      diagnostics,
    );
  }
  const paired = pairMongoBackRelations({
    foreignKeys,
    candidates: backRelations,
    invalidFkPairings,
  });
  diagnostics.push(...mapPslDiagnostics(paired.diagnostics, mergedSources(input.documents)));
  for (const { modelName, fieldName, relation } of paired.relations) {
    const build = builds.get(modelName);
    if (build !== undefined) build.relations[fieldName] = relation;
  }

  const collections: Record<string, { indexes: MongoIndex[] }> = {};
  const roots: Record<string, CrossReference> = {};
  const executionDefaults: ExecutionMutationDefault[] = [];
  for (const [modelName, build] of builds) {
    const indexes = buildIndexes(build, diagnostics);
    const existing = collections[build.collection];
    collections[build.collection] = { indexes: [...(existing?.indexes ?? []), ...indexes] };
    roots[build.collection] = crossRef(modelName, UNBOUND_NAMESPACE_ID);
    for (const { field, phases } of build.executionDefaults) {
      executionDefaults.push({
        ref: { namespace: UNBOUND_NAMESPACE_ID, entry: build.collection, field },
        ...phases,
      });
    }
    if (!build.hasId) {
      diagnostics.push({
        code: 'PSL_MISSING_ID_FIELD',
        message: `Model "${modelName}" has no field with @id attribute. Every model must have exactly one @id field.`,
        sourceId: build.located.sourceId,
        span: build.located.symbol.span,
      });
    }
  }

  if (diagnostics.length > 0) {
    return notOk({ summary: SUMMARY, diagnostics });
  }

  return ok(
    assembleContract({
      binding,
      builds,
      collections,
      roots,
      valueObjects,
      enums,
      executionDefaults,
      codecLookup: input.codecLookup,
    }),
  );
}

function checkDatasource(
  datasources: readonly Located<BlockSymbol>[],
  fallbackSourceId: string,
  binding: Prisma6TargetBinding,
  diagnostics: Diagnostics,
): void {
  const [datasource] = datasources;
  const [namedProvider] = binding.providers;
  if (datasource === undefined) {
    diagnostics.push(
      prisma6Diagnostic(
        'PSL.PRISMA6_MONGO_PROVIDER_MISMATCH',
        `No datasource block found; add \`datasource db { provider = "${namedProvider}" }\`.`,
        fallbackSourceId,
        undefined,
      ),
    );
    return;
  }
  const block = datasource.symbol.block;
  const parameter = block.parameters['provider'];
  let provider: string | undefined;
  if (parameter?.kind === 'value') {
    try {
      const parsed: unknown = JSON.parse(parameter.raw);
      provider = typeof parsed === 'string' ? parsed : undefined;
    } catch {
      provider = undefined;
    }
  }
  if (provider === undefined || !binding.providers.includes(provider)) {
    diagnostics.push(
      prisma6Diagnostic(
        'PSL.PRISMA6_MONGO_PROVIDER_MISMATCH',
        provider === undefined
          ? `The datasource block declares no string \`provider\`; this contract source reads Prisma 6 schemas for provider "${namedProvider}".`
          : `The datasource provider is "${provider}"; this contract source reads Prisma 6 schemas for provider "${namedProvider}".`,
        datasource.sourceId,
        parameter === undefined ? block.span : parameter.span,
      ),
    );
  }
}

function buildEnum(
  located: Located<BlockSymbol>,
  input: InterpretPrisma6DocumentsInput,
  diagnostics: Diagnostics,
): EnumBuild | undefined {
  const { symbol: block, sourceId, sources } = located;
  for (const attribute of readResolvedAttributes(block.node.attributes(), sources)) {
    if (attribute.name === 'map') continue;
    if (attribute.name === 'schema') {
      diagnostics.push(schemaUnsupported(`Enum "${block.name}"`, attribute, sourceId));
      continue;
    }
    diagnostics.push(unknownAttribute(`Enum "${block.name}"`, attribute, '@@', sourceId));
  }
  const parameters: PslExtensionBlock['parameters'] = {};
  for (const entry of block.node.entries()) {
    const name = entry.key()?.name();
    if (name === undefined) continue;
    let value = name;
    for (const attributeNode of entry.attributes()) {
      const attribute = readResolvedAttribute(attributeNode, sources);
      if (attribute.name === 'map') {
        value =
          requireString(attribute, `Enum member "${block.name}.${name}"`, sourceId, diagnostics) ??
          value;
      } else {
        diagnostics.push(
          unknownAttribute(`Enum member "${block.name}.${name}"`, attribute, '@', sourceId),
        );
      }
    }
    parameters[name] = {
      kind: 'value',
      raw: JSON.stringify(value),
      span: nodePslSpan(entry.syntax, sources),
    };
  }
  const descriptor = input.authoringContributions.entityTypes['enum'];
  if (descriptor === undefined || !isAuthoringEntityTypeDescriptor(descriptor)) {
    diagnostics.push({
      code: 'PSL_ENUM_MISSING_FACTORY',
      message: `enum "${block.name}" requires an "enum" entityType factory in the active authoring contributions`,
      sourceId,
      span: block.span,
    });
    return undefined;
  }
  const context: AuthoringEntityContext = {
    family: input.binding.target.familyId,
    target: input.binding.target.targetId,
    codecLookup: input.codecLookup,
    sourceId,
    enumInferenceCodecs: {
      text: input.binding.scalarCodecIds.String,
      int: input.binding.scalarCodecIds.Int,
    },
    diagnostics: {
      push: (diagnostic) => {
        diagnostics.push(
          blindCast<ContractSourceDiagnostic, 'entity factory diagnostics are span-compatible'>(
            diagnostic,
          ),
        );
      },
    },
  };
  const handle = instantiateAuthoringEntityType<EnumTypeHandle | undefined>(
    'enum',
    descriptor,
    [
      {
        kind: 'enum',
        keyword: 'enum',
        name: block.name,
        parameters,
        blockAttributes: [],
        attributes: {},
        span: block.span,
      } satisfies PslExtensionBlock,
    ],
    context,
  );
  if (handle === undefined || handle === null) return undefined;
  return {
    codecId: handle.codecId,
    members: handle.enumMembers.map((member) => ({ name: member.name, value: member.value })),
  };
}

function schemaUnsupported(
  owner: string,
  attribute: ResolvedAttribute,
  sourceId: string,
): ContractSourceDiagnostic {
  return prisma6Diagnostic(
    'PSL.PRISMA6_MONGO_SCHEMA_UNSUPPORTED',
    `${owner}: "@@schema" is not supported; a MongoDB contract has one database, bound by the connection string. Remove @@schema.`,
    sourceId,
    attribute.span,
  );
}

interface TypeContext {
  readonly binding: Prisma6TargetBinding;
  readonly enums: ReadonlyMap<string, EnumBuild>;
  readonly compositeTypeNames: ReadonlySet<string>;
  readonly diagnostics: Diagnostics;
}

interface FieldOwner {
  readonly kind: 'model' | 'type';
  readonly name: string;
}

function unsupportedTypeMessage(label: string, typeName: string, owner: FieldOwner): string {
  const ownerLabel = `${owner.kind} "${owner.name}"`;
  const base = `${label} has type "${typeName}(...)", which has no Prisma 8 codec, so ${ownerLabel} cannot use this contract source while it has the field. Prisma 6 rejects @ignore on an Unsupported field. Removing the field from the schema leaves its stored values in the documents, but the Prisma 6 client no longer reads or writes them.`;
  if (owner.kind === 'type') return base;
  return `${base} Adding @@ignore to model "${owner.name}" keeps the model out of the contract, but the model disappears from the Prisma 6 client too, and every relation field in another model that points to it needs @ignore, which removes that field from the Prisma 6 client as well.`;
}

/** The field's contract type, or `undefined` after reporting why it has none. */
function resolveFieldType(
  field: FieldSymbol,
  owner: FieldOwner,
  nativeType: ResolvedAttribute | undefined,
  sourceId: string,
  ctx: TypeContext,
): ContractField | undefined {
  const { binding, diagnostics } = ctx;
  const label = `Field "${owner.name}.${field.name}"`;
  if (field.typeConstructor !== undefined) {
    diagnostics.push(
      prisma6Diagnostic(
        'PSL.PRISMA6_MONGO_UNSUPPORTED_TYPE',
        unsupportedTypeMessage(label, field.typeConstructor.path.join('.'), owner),
        sourceId,
        field.typeConstructor.span,
      ),
    );
    return undefined;
  }
  const nativeTypeUnsupported = (attribute: ResolvedAttribute): undefined => {
    diagnostics.push(
      prisma6Diagnostic(
        'PSL.PRISMA6_MONGO_NATIVE_TYPE_UNSUPPORTED',
        attribute.name === 'db.ObjectId'
          ? `${label}: @db.ObjectId is only supported on a String field, and this field is "${field.typeName}". Remove @db.ObjectId, or change the field type to String.`
          : `${label}: native type "@${attribute.name}" is not supported by the Prisma 6 MongoDB contract source; only @db.ObjectId is. Remove it: the stored BSON type then follows the field type.`,
        sourceId,
        attribute.span,
      ),
    );
    return undefined;
  };
  const many = field.list ? { many: true as const } : {};
  if (ctx.compositeTypeNames.has(field.typeName)) {
    if (nativeType !== undefined) return nativeTypeUnsupported(nativeType);
    return {
      type: { kind: 'valueObject', name: field.typeName },
      nullable: field.optional,
      ...many,
    };
  }
  const enumBuild = ctx.enums.get(field.typeName);
  if (enumBuild !== undefined) {
    if (nativeType !== undefined) return nativeTypeUnsupported(nativeType);
    const valueSet: ValueSetRef = {
      plane: 'domain',
      entityKind: 'enum',
      namespaceId: UNBOUND_NAMESPACE_ID,
      entityName: field.typeName,
    };
    return {
      type: { kind: 'scalar', codecId: enumBuild.codecId },
      nullable: field.optional,
      valueSet,
      ...many,
    };
  }
  const scalarCodecId = Object.hasOwn(binding.scalarCodecIds, field.typeName)
    ? binding.scalarCodecIds[field.typeName]
    : undefined;
  if (scalarCodecId === undefined) {
    diagnostics.push(
      prisma6Diagnostic(
        'PSL.PRISMA6_MONGO_UNSUPPORTED_TYPE',
        `${label} has unknown type "${field.typeName}": it is not a scalar type, an enum, a composite type, or a model. Correct the type name.`,
        sourceId,
        field.span,
      ),
    );
    return undefined;
  }
  let codecId = scalarCodecId;
  if (nativeType !== undefined) {
    if (nativeType.name !== 'db.ObjectId' || field.typeName !== 'String') {
      return nativeTypeUnsupported(nativeType);
    }
    codecId = binding.objectIdCodecId;
  }
  return { type: { kind: 'scalar', codecId }, nullable: field.optional, ...many };
}

function readCompositeFields(
  located: Located<CompositeTypeSymbol>,
  ctx: TypeContext,
): Record<string, ContractField> {
  const { symbol, sourceId } = located;
  for (const attribute of symbol.attributes) {
    ctx.diagnostics.push(unknownAttribute(`Type "${symbol.name}"`, attribute, '@@', sourceId));
  }
  const fields: Record<string, ContractField> = {};
  for (const field of Object.values(symbol.fields)) {
    if (field.malformedType) continue;
    const label = `Field "${symbol.name}.${field.name}"`;
    let nativeType: ResolvedAttribute | undefined;
    let rejected = false;
    for (const attribute of field.attributes) {
      if (attribute.name.startsWith('db.')) {
        nativeType = attribute;
      } else if (attribute.name === 'map') {
        ctx.diagnostics.push(
          prisma6Diagnostic(
            'PSL.PRISMA6_MONGO_COMPOSITE_MAP_UNSUPPORTED',
            `${label}: @map on a field of a composite type is not supported yet. The stored field keeps the name "${stringArgument(attribute) ?? field.name}", so removing @map renames it in storage; keep the schema as it is until Prisma 8 supports it.`,
            sourceId,
            attribute.span,
          ),
        );
        rejected = true;
      } else if (attribute.name === 'default') {
        ctx.diagnostics.push(defaultUnsupported(label, attribute, sourceId));
        rejected = true;
      } else {
        ctx.diagnostics.push(unknownAttribute(label, attribute, '@', sourceId));
        rejected = true;
      }
    }
    if (rejected) continue;
    const resolved = resolveFieldType(
      field,
      { kind: 'type', name: symbol.name },
      nativeType,
      sourceId,
      ctx,
    );
    if (resolved !== undefined) fields[field.name] = resolved;
  }
  return fields;
}

function defaultUnsupported(
  label: string,
  attribute: ResolvedAttribute,
  sourceId: string,
): ContractSourceDiagnostic {
  return prisma6Diagnostic(
    'PSL.PRISMA6_MONGO_DEFAULT_UNSUPPORTED',
    `${label}: ${attributeText(attribute)} is not supported. MongoDB has no stored defaults, and Prisma 8 fills only \`now()\` on DateTime fields. Remove the default and set the value when you create documents.`,
    sourceId,
    attribute.span,
  );
}

function readModel(
  located: Located<ModelSymbol>,
  modelNames: ReadonlySet<string>,
  ignoredModels: ReadonlySet<string>,
  ctx: TypeContext,
): ModelBuild {
  const { symbol, sourceId, sources } = located;
  const { diagnostics } = ctx;
  const modelLabel = `Model "${symbol.name}"`;
  let collection = symbol.name;
  const build: ModelBuild = {
    located,
    collection: symbol.name,
    storedNames: new Map(),
    ignoredFields: new Set(),
    rejectedFields: new Set(),
    fields: {},
    relations: {},
    executionDefaults: [],
    uniqueFields: [],
    modelIndexes: [],
    relationFields: [],
    hasId: false,
  };
  const indexContext = { owner: modelLabel, prefix: '@@' as const, sourceId, sources, diagnostics };
  for (const attribute of symbol.attributes) {
    switch (attribute.name) {
      case 'map':
        collection = requireString(attribute, modelLabel, sourceId, diagnostics) ?? collection;
        break;
      case 'index':
      case 'unique':
      case 'fulltext': {
        const parsed = parseIndexAttribute({ ...attribute, name: attribute.name }, indexContext);
        if (parsed !== undefined) build.modelIndexes.push(parsed);
        break;
      }
      case 'id':
        build.hasId = true;
        diagnostics.push(
          prisma6Diagnostic(
            'PSL.PRISMA6_MONGO_COMPOSITE_ID_UNSUPPORTED',
            `${modelLabel}: @@id is not supported; a MongoDB document is identified by its "_id" field. Declare the id as \`id String @id @default(auto()) @map("_id") @db.ObjectId\`.`,
            sourceId,
            attribute.span,
          ),
        );
        break;
      case 'schema':
        diagnostics.push(schemaUnsupported(modelLabel, attribute, sourceId));
        break;
      case 'ignore':
        break;
      default:
        diagnostics.push(unknownAttribute(modelLabel, attribute, '@@', sourceId));
    }
  }

  for (const field of Object.values(symbol.fields)) {
    const reported = diagnostics.length;
    readModelField(field, build, modelNames, ignoredModels, ctx);
    if (diagnostics.length > reported) build.rejectedFields.add(field.name);
  }
  return { ...build, collection };
}

function readModelField(
  field: FieldSymbol,
  build: ModelBuild,
  modelNames: ReadonlySet<string>,
  ignoredModels: ReadonlySet<string>,
  ctx: TypeContext,
): void {
  const { symbol, sourceId, sources } = build.located;
  const { diagnostics, binding } = ctx;
  const label = `Field "${symbol.name}.${field.name}"`;
  const isRelationField = modelNames.has(field.typeName) && field.typeConstructor === undefined;
  if (field.attributes.some((attribute) => attribute.name === 'ignore')) {
    build.ignoredFields.add(field.name);
    const unique = field.attributes.find((attribute) => attribute.name === 'unique');
    if (unique !== undefined) {
      diagnostics.push(
        ignoredFieldReferenced(
          symbol.name,
          [field.name],
          `@unique on field "${symbol.name}.${field.name}"`,
          sourceId,
          unique.span,
        ),
      );
    }
    return;
  }
  if (isRelationField) {
    if (ignoredModels.has(field.typeName)) return;
    let relation: ResolvedAttribute | undefined;
    for (const attribute of field.attributes) {
      if (attribute.name === 'relation') {
        relation = attribute;
      } else {
        diagnostics.push(unknownAttribute(label, attribute, '@', sourceId));
      }
    }
    build.relationFields.push({ field, relation });
    return;
  }

  let storedName = field.name;
  let nativeType: ResolvedAttribute | undefined;
  let idAttribute: ResolvedAttribute | undefined;
  let defaultAttribute: ResolvedAttribute | undefined;
  let updatedAt: ResolvedAttribute | undefined;
  for (const attribute of field.attributes) {
    switch (attribute.name) {
      case 'map':
        storedName = requireString(attribute, label, sourceId, diagnostics) ?? storedName;
        break;
      case 'id':
        idAttribute = attribute;
        break;
      case 'default':
        defaultAttribute = attribute;
        break;
      case 'updatedAt':
        updatedAt = attribute;
        break;
      case 'unique': {
        const parsed = parseFieldUnique(attribute, field.name, {
          owner: label,
          prefix: '@',
          sourceId,
          sources,
          diagnostics,
        });
        if (parsed !== undefined) build.uniqueFields.push(parsed);
        break;
      }
      default:
        if (attribute.name.startsWith('db.')) {
          nativeType = attribute;
        } else {
          diagnostics.push(unknownAttribute(label, attribute, '@', sourceId));
        }
    }
  }
  build.storedNames.set(field.name, storedName);
  if (field.malformedType) return;

  const resolved = resolveFieldType(
    field,
    { kind: 'model', name: symbol.name },
    nativeType,
    sourceId,
    ctx,
  );
  if (resolved === undefined) return;
  const codecId = resolved.type.kind === 'scalar' ? resolved.type.codecId : undefined;

  if (idAttribute !== undefined) {
    build.hasId = true;
    if (
      codecId !== binding.objectIdCodecId ||
      storedName !== '_id' ||
      field.optional ||
      field.list
    ) {
      diagnostics.push(
        prisma6Diagnostic(
          'PSL.PRISMA6_MONGO_ID_NOT_OBJECTID',
          `${label} is the model's @id, but it is not a required ObjectId stored as "_id". Prisma 8 identifies a MongoDB document by an ObjectId "_id"; declare the id as \`${field.name} String @id @default(auto()) @map("_id") @db.ObjectId\`.`,
          sourceId,
          idAttribute.span,
        ),
      );
      return;
    }
    if (defaultAttribute !== undefined && defaultKind(defaultAttribute) !== 'auto') {
      diagnostics.push(defaultUnsupported(label, defaultAttribute, sourceId));
      return;
    }
    build.fields[storedName] = resolved;
    return;
  }

  const isDateTime = codecId === binding.scalarCodecIds.DateTime && !field.list;
  if (updatedAt !== undefined && !isDateTime) {
    diagnostics.push(
      prisma6Diagnostic(
        'PSL.PRISMA6_MONGO_UPDATED_AT_TYPE_UNSUPPORTED',
        `${label}: @updatedAt is only supported on a DateTime field. Remove @updatedAt and set the value when you write documents.`,
        sourceId,
        updatedAt.span,
      ),
    );
    return;
  }
  const defaultIsNow = defaultAttribute !== undefined && defaultKind(defaultAttribute) === 'now';
  if (defaultAttribute !== undefined && (!defaultIsNow || !isDateTime)) {
    diagnostics.push(defaultUnsupported(label, defaultAttribute, sourceId));
    return;
  }
  const generator = { kind: 'generator' as const, id: binding.timestampGeneratorId };
  const phases: ExecutionMutationDefaultPhases | undefined =
    updatedAt !== undefined
      ? { onCreate: generator, onUpdate: generator }
      : defaultIsNow
        ? { onCreate: generator }
        : undefined;
  if (phases !== undefined && field.optional) {
    const written = updatedAt ?? defaultAttribute;
    diagnostics.push(
      prisma6Diagnostic(
        'PSL.PRISMA6_MONGO_OPTIONAL_GENERATED_FIELD_UNSUPPORTED',
        `${label} is optional and its value comes from ${written === undefined ? 'a generator' : attributeText(written)}, which Prisma 8 cannot express on an optional field yet. Make the field required, or remove ${written === undefined ? 'the generator' : attributeText(written)} and set the value when you write documents.`,
        sourceId,
        written?.span ?? field.span,
      ),
    );
    return;
  }
  build.fields[storedName] = resolved;
  if (phases !== undefined) build.executionDefaults.push({ field: storedName, phases });
}

interface RelationArguments {
  readonly name: string | undefined;
  readonly fields: readonly string[] | undefined;
  readonly references: readonly string[] | undefined;
}

function identifierList(
  attributeArg: ResolvedAttribute['args'][number],
): readonly string[] | undefined {
  const expression = attributeArg.expression;
  const array = expression === undefined ? undefined : ArrayLiteralAst.cast(expression.syntax);
  if (array === undefined) return undefined;
  const names: string[] = [];
  for (const element of array.elements()) {
    const name = IdentifierAst.cast(element.syntax)?.name();
    if (name === undefined) return undefined;
    names.push(name);
  }
  return names;
}

function readRelationArguments(
  attribute: ResolvedAttribute,
  label: string,
  sourceId: string,
  diagnostics: Diagnostics,
): RelationArguments | undefined {
  let name: string | undefined;
  let fields: readonly string[] | undefined;
  let references: readonly string[] | undefined;
  const invalid = (what: string, span: PslSpan): undefined => {
    diagnostics.push({
      code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
      message: `${label}: @relation ${what}.`,
      sourceId,
      span,
    });
    return undefined;
  };
  for (const arg of attribute.args) {
    const key = arg.kind === 'positional' ? 'name' : arg.name;
    switch (key) {
      case 'name': {
        const expression = arg.expression;
        name =
          expression === undefined
            ? undefined
            : StringLiteralExprAst.cast(expression.syntax)?.value();
        if (name === undefined) return invalid('name must be a string', arg.span);
        break;
      }
      case 'fields':
        fields = identifierList(arg);
        if (fields === undefined) return invalid('fields must be a list of field names', arg.span);
        break;
      case 'references':
        references = identifierList(arg);
        if (references === undefined) {
          return invalid('references must be a list of field names', arg.span);
        }
        break;
      case 'onDelete':
      case 'onUpdate':
      case 'map':
        diagnostics.push(
          prisma6Diagnostic(
            'PSL.PRISMA6_MONGO_REFERENTIAL_ACTION_UNSUPPORTED',
            key === 'map'
              ? `${label}: @relation argument "map" is not supported; it names a foreign key constraint, and MongoDB has none. Remove "map".`
              : `${label}: @relation argument "${key}" is not supported; Prisma 8 enforces no referential actions on MongoDB. Remove "${key}" and handle related documents in application code.`,
            sourceId,
            arg.span,
          ),
        );
        return undefined;
      default:
        return invalid(`argument "${key ?? ''}" is not supported`, arg.span);
    }
  }
  return { name, fields, references };
}

function ignoredFieldReferenced(
  modelName: string,
  fieldNames: readonly string[],
  usedBy: string,
  sourceId: string,
  span: PslSpan,
): ContractSourceDiagnostic {
  const one = fieldNames.length === 1;
  const fields = fieldNames.map((name) => `"${modelName}.${name}"`).join(', ');
  return prisma6Diagnostic(
    'PSL.PRISMA6_MONGO_IGNORED_FIELD_REFERENCED',
    `${one ? 'Field' : 'Fields'} ${fields} ${one ? 'is' : 'are'} marked @ignore, but ${usedBy} uses ${one ? 'it' : 'them'}. Remove @ignore from ${fields}, or remove ${usedBy}.`,
    sourceId,
    span,
  );
}

function readRelationFields(
  build: ModelBuild,
  builds: ReadonlyMap<string, ModelBuild>,
  out: {
    readonly foreignKeys: MongoForeignKeyRelation[];
    readonly invalidFkPairings: InvalidFkPairing[];
    readonly backRelations: MongoBackRelationCandidate[];
  },
  diagnostics: Diagnostics,
): void {
  const { symbol, sourceId, sources } = build.located;
  for (const { field, relation } of build.relationFields) {
    const label = `Relation field "${symbol.name}.${field.name}"`;
    const reject = (): void => {
      out.invalidFkPairings.push({
        pairKey: fkRelationPairKey(symbol.name, field.typeName),
        ...ifDefined('relationName', relation === undefined ? undefined : stringArgument(relation)),
      });
    };
    const args =
      relation === undefined
        ? undefined
        : readRelationArguments(relation, label, sourceId, diagnostics);
    if (relation !== undefined && args === undefined) {
      reject();
      continue;
    }
    const target = builds.get(field.typeName);
    if (target === undefined) continue;
    const hasKeys = args?.fields !== undefined || args?.references !== undefined;
    if (!hasKeys) {
      out.backRelations.push({
        modelName: symbol.name,
        field,
        targetModelName: field.typeName,
        ...ifDefined('relationName', args?.name),
        cardinality: field.list ? '1:N' : '1:1',
        sources,
      });
      continue;
    }
    if (field.list) {
      diagnostics.push(
        prisma6Diagnostic(
          'PSL.PRISMA6_MONGO_LIST_RELATION_UNSUPPORTED',
          `${label} is a list relation that stores its keys in a list field (a many-to-many relation on MongoDB), which Prisma 8 does not support yet. Remove the relation fields from the schema this contract source reads and keep the key list as a plain field.`,
          sourceId,
          relation?.span ?? field.span,
        ),
      );
      reject();
      continue;
    }
    const localNames = args?.fields ?? [];
    const targetNames = args?.references ?? [];
    const ignoredLocal = localNames.filter((name) => build.ignoredFields.has(name));
    if (ignoredLocal.length > 0) {
      diagnostics.push(
        ignoredFieldReferenced(
          symbol.name,
          ignoredLocal,
          `relation field "${symbol.name}.${field.name}"`,
          sourceId,
          relation?.span ?? field.span,
        ),
      );
      reject();
      continue;
    }
    const ignoredTarget = targetNames.filter((name) => target.ignoredFields.has(name));
    if (ignoredTarget.length > 0) {
      diagnostics.push(
        ignoredFieldReferenced(
          target.located.symbol.name,
          ignoredTarget,
          `relation field "${symbol.name}.${field.name}"`,
          sourceId,
          relation?.span ?? field.span,
        ),
      );
      reject();
      continue;
    }
    const localFields = localNames.map((name) => build.storedNames.get(name));
    const targetFields = targetNames.map((name) => target.storedNames.get(name));
    if (
      localFields.some((name) => name === undefined) ||
      targetFields.some((name) => name === undefined) ||
      localNames.length !== targetNames.length ||
      localNames.length === 0
    ) {
      diagnostics.push({
        code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
        message: `${label}: @relation fields and references must name the same number of scalar fields of "${symbol.name}" and "${field.typeName}".`,
        sourceId,
        span: relation?.span ?? field.span,
      });
      reject();
      continue;
    }
    const nullability = resolveToOneRelationNullable({
      declaredNullable: field.optional,
      localFieldNullability: localNames.map((name) => symbol.fields[name]?.optional === true),
      ownsReference: true,
    });
    if (nullability.contradiction !== undefined) {
      diagnostics.push({
        code: 'PSL_RELATION_NULLABILITY_MISMATCH',
        message: field.optional
          ? `${label} is optional but every field in @relation(fields: [...]) is required. Make one of those fields optional with "?" or remove "?" from "${field.name}".`
          : `${label} is required but a field in @relation(fields: [...]) is optional. Add "?" to "${field.name}" or make those fields required.`,
        sourceId,
        span: field.span,
      });
      reject();
      continue;
    }
    const local = localFields.filter((name): name is string => name !== undefined);
    const referenced = targetFields.filter((name): name is string => name !== undefined);
    build.relations[field.name] = {
      to: crossRef(field.typeName, UNBOUND_NAMESPACE_ID),
      cardinality: 'N:1',
      nullable: field.optional,
      on: { localFields: local, targetFields: referenced },
    };
    out.foreignKeys.push({
      declaringModel: symbol.name,
      targetModel: field.typeName,
      ...ifDefined('relationName', args?.name),
      localFields: local,
      targetFields: referenced,
    });
  }
}

function buildIndexes(build: ModelBuild, diagnostics: Diagnostics): MongoIndex[] {
  const { symbol, sourceId } = build.located;
  const indexes: MongoIndex[] = [];
  let textIndexes = 0;
  const keyFor = (
    field: IndexField,
    text: boolean,
  ): { readonly field: string; readonly direction: MongoIndexKeyDirection } => ({
    field: build.storedNames.get(field.name) ?? field.name,
    direction: field.direction ?? (text ? 'text' : 1),
  });
  for (const attribute of [...build.uniqueFields, ...build.modelIndexes]) {
    const names = attribute.fields.map((field) => field.name);
    const usedBy = build.uniqueFields.includes(attribute)
      ? `@unique on field "${symbol.name}.${attribute.fields[0]?.name ?? ''}"`
      : `@@${attribute.kind} on model "${symbol.name}"`;
    const ignored = names.filter((name) => build.ignoredFields.has(name));
    if (ignored.length > 0) {
      diagnostics.push(
        ignoredFieldReferenced(symbol.name, ignored, usedBy, sourceId, attribute.span),
      );
      continue;
    }
    if (names.some((name) => build.rejectedFields.has(name))) continue;
    const unknown = names.find((name) => !build.storedNames.has(name));
    if (unknown !== undefined) {
      diagnostics.push({
        code: 'PSL_INDEX_FIELD_NOT_FOUND',
        message: `Index on model "${symbol.name}" references unknown field "${unknown}"`,
        sourceId,
        span: attribute.span,
      });
      continue;
    }
    if (attribute.kind === 'fulltext') {
      textIndexes++;
      if (textIndexes > 1) {
        diagnostics.push(
          prisma6Diagnostic(
            'PSL.PRISMA6_MONGO_TEXT_INDEX_LIMIT',
            `Model "${symbol.name}" has more than one @@fulltext; MongoDB allows one text index per collection. Merge the fields into one @@fulltext.`,
            sourceId,
            attribute.span,
          ),
        );
        continue;
      }
    }
    indexes.push(
      new MongoIndex({
        keys: attribute.fields.map((field) => keyFor(field, attribute.kind === 'fulltext')),
        ...(attribute.kind === 'unique' ? { unique: true } : {}),
      }),
    );
  }
  return indexes;
}

function assembleContract(input: {
  readonly binding: Prisma6TargetBinding;
  readonly builds: ReadonlyMap<string, ModelBuild>;
  readonly collections: Readonly<Record<string, { readonly indexes: readonly MongoIndex[] }>>;
  readonly roots: Record<string, CrossReference>;
  readonly valueObjects: Record<string, ContractValueObject>;
  readonly enums: ReadonlyMap<string, EnumBuild>;
  readonly executionDefaults: readonly ExecutionMutationDefault[];
  readonly codecLookup: CodecLookup;
}): Contract {
  const target = input.binding.target.targetId;
  const targetFamily = input.binding.target.familyId;

  const builtEnums: Record<string, ContractEnum> = {};
  for (const [enumName, built] of input.enums) {
    builtEnums[enumName] = {
      codecId: built.codecId,
      members: built.members.map((member) => ({
        name: member.name,
        value: blindCast<JsonValue, 'factory-validated enum members are JsonValue-compatible'>(
          member.value,
        ),
      })),
    };
  }

  const collections: Record<string, MongoCollectionInput> = {};
  for (const [name, collection] of Object.entries(input.collections)) {
    collections[name] = collection.indexes.length > 0 ? { indexes: collection.indexes } : {};
  }
  const storage = blindCast<
    Contract['storage'],
    'MongoStorage is the Mongo family concrete storage class; it structurally satisfies the Contract storage slot.'
  >(
    buildMongoStorage({
      collections,
      valueSets: encodeMongoValueSets(Object.fromEntries(input.enums), input.codecLookup),
    }),
  );

  const models: Record<string, unknown> = {};
  for (const [modelName, build] of input.builds) {
    models[modelName] = {
      fields: build.fields,
      relations: build.relations,
      storage: { collection: build.collection },
    };
  }
  const capabilities: Record<string, Record<string, boolean>> = {};
  const execution = buildMongoExecutionSection(input.executionDefaults);
  return {
    targetFamily,
    target,
    roots: input.roots,
    domain: {
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: {
          models: blindCast<
            Contract['domain']['namespaces'][string]['models'],
            'Mongo model entries built above'
          >(models),
          ...(Object.keys(input.valueObjects).length > 0
            ? { valueObjects: input.valueObjects }
            : {}),
          ...(Object.keys(builtEnums).length > 0 ? { enum: builtEnums } : {}),
        },
      },
    },
    storage,
    extensions: {},
    capabilities,
    profileHash: computeProfileHash({ target, targetFamily, capabilities }),
    meta: {},
    ...(execution !== undefined ? { execution } : {}),
  };
}

function mergedSources(documents: readonly Prisma6Document[]): PslSources {
  const [first, ...rest] = documents.map((document) => document.sources);
  if (first === undefined) throw new InternalError('A Prisma 6 schema has at least one document');
  return first.merge(...rest);
}
