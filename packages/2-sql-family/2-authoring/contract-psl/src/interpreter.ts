import type {
  ContractSourceDiagnostic,
  ContractSourceDiagnosticSpan,
  ContractSourceDiagnostics,
} from '@internal/config/config-types';
import type {
  Contract,
  ContractDiscriminator,
  ContractModel,
  ControlPolicy,
  CrossReference,
  JsonValue,
} from '@internal/contract/types';
import { crossRef } from '@internal/contract/types';
import { resolveToOneRelationNullable } from '@internal/contract-authoring';
import type {
  AuthoringContributions,
  AuthoringEntityContext,
  AuthoringEntityTypeDescriptor,
  AuthoringEntityTypeNamespace,
  AuthoringModelAttributeContext,
  AuthoringModelAttributeDescriptor,
  AuthoringModelAttributeDescriptorNamespace,
  AuthoringModelAttributeLoweringOutput,
  AuthoringPslBlockDescriptorNamespace,
  AuthoringWarning,
  DataTypeSupport,
  DiscriminatorField,
  ParsedPslExtensionBlock,
  WrittenValue,
} from '@internal/framework-components/authoring';
import {
  applyDiscriminatorRule,
  describeDiscriminatorRefusal,
  encodeEnumMembers,
  instantiateAuthoringEntityType,
  isAuthoringEntityTypeDescriptor,
  isAuthoringModelAttributeDescriptor,
} from '@internal/framework-components/authoring';
import type { CodecLookupWithDescriptors } from '@internal/framework-components/codec';
import type {
  CapabilityMatrix,
  ExtensionPackRef,
  GeneratorFunctionRegistry,
  TargetPackRef,
} from '@internal/framework-components/components';
import type {
  ControlMutationDefaultRegistry,
  ControlMutationDefaults,
} from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { Binder, ParsedWrittenScalar } from '@internal/psl-parser';
import {
  type AttributeSpecContext,
  type BlockSymbol,
  type CompositeTypeSymbol,
  createPslDiagnosticCollector,
  type DiagnosticSource,
  diagnosticSource,
  type FieldSymbol,
  findBlockDescriptor,
  interpretExtensionBlocks,
  type ModelAttributeSpecFactory,
  type ModelSymbol,
  type NamespaceSymbol,
  nodePslSpan,
  type PslDiagnostic,
  type PslDiagnosticCollector,
  type Resolution,
  type ResolvedAttribute,
  type ResolvedEntityReference,
  type SymbolTable,
  typeAliasAttributeNames,
  typeReferenceNode,
} from '@internal/psl-parser';
import {
  claimedBlockKeywords,
  enumMemberAttributeDiagnostics,
  unsupportedBlockDiagnostic,
} from '@internal/psl-parser/interpret';
import type {
  DocumentAst,
  FieldAttributeAst,
  PslSources,
  SyntaxNode,
} from '@internal/psl-parser/syntax';
import { NamespaceDeclarationAst } from '@internal/psl-parser/syntax';
import {
  type LoweredPackEntity,
  providesPslEntityPlacement,
  type ResolvedPslModelRefs,
} from '@internal/sql-contract/entity-handle-lowering-hook';
import { FOREIGN_KEY_INDEX_UNRESOLVED } from '@internal/sql-contract/foreign-key-materialization';
import { isAuthoredIndexInput } from '@internal/sql-contract/index-naming';
import { sqlTextFromStored } from '@internal/sql-contract/sql-expression';
import type {
  SqlModelStorage,
  SqlNamespaceBase,
  SqlNamespaceInput,
} from '@internal/sql-contract/types';
import { deriveValueSetFromEntity } from '@internal/sql-contract/value-set-derivation-hook';
import {
  buildSqlContractFromDefinition,
  type CheckNode,
  type EnumTypeHandle,
  type FieldNode,
  type ForeignKeyNode,
  type IndexNode,
  type ModelNode,
  type PrimaryKeyNode,
  type RelationNode,
  type ScalarMemberNode,
  type UniqueConstraintNode,
  type ValueObjectFieldNode,
  type ValueObjectMemberNode,
  type ValueObjectNode,
} from '@internal/sql-contract-ts/contract-builder';
import { assertDefined, invariant } from '@internal/utils/assertions';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import { notOk, ok, type Result } from '@internal/utils/result';
import { isStructuredError } from '@internal/utils/structured-error';
import { compareStrings } from './compare-strings';
import { contractError } from './contract-errors';
import { defaultTableName } from './default-table-name';
import {
  getAttribute,
  getNamedArgument,
  mapFieldNamesToColumns,
  storageName,
} from './psl-attribute-parsing';
import type { ColumnDescriptor } from './psl-column-resolution';
import { getAuthoringEntity, resolveFieldTypeDescriptor } from './psl-column-resolution';
import {
  collectResolvedFields,
  type ModelNamespaceEntry,
  modelCoordinateKey,
  type ResolvedField,
} from './psl-field-resolution';
import {
  type ResolvedTypeAliases,
  resolveNamedTypeDeclarations,
} from './psl-named-type-resolution';
import {
  applyBackrelationCandidates,
  type FkRelationMetadata,
  type InvalidModelFkPairing,
  indexFkRelations,
  interpretRelationAttribute,
  type ModelBackrelationCandidate,
  normalizeReferentialAction,
  validateBackrelationFieldAttributes,
} from './psl-relation-resolution';
import {
  fieldSpecContext,
  interpretFieldAttribute,
  interpretModelAttribute,
  modelAttributeSpecsFrom,
  modelSpecContext,
  PSL_CHECK_ON_STI_VARIANT,
  sqlAttributeSpecs,
} from './sql-attribute-specs';
import type { ValueObjectTypes } from './value-object-default';

export interface InterpretPslDocumentToSqlContractInput {
  readonly documents: readonly DocumentAst[];
  readonly symbolTable: SymbolTable;
  readonly sources: PslSources;
  readonly binder: Binder;
  readonly target: TargetPackRef<'sql', string>;
  readonly scalarColumnDescriptors: ReadonlyMap<string, ColumnDescriptor>;
  readonly composedExtensions?: readonly string[];
  readonly composedExtensionPackRefs?: readonly ExtensionPackRef<'sql', string>[];
  readonly controlMutationDefaults?: ControlMutationDefaults;
  /** The stack's generator functions, which `@onCreate(fn())` and `@onUpdate(fn())` resolve through. */
  readonly generatorFunctions: GeneratorFunctionRegistry;
  /** The stack's data types with their authoring entries. ADR 254. */
  readonly dataTypes: DataTypeSupport;
  readonly authoringContributions?: AuthoringContributions;
  /**
   * Extension contracts keyed by space ID. Required for cross-space FK
   * resolution. A composed space must have an entry here; if the space ID
   * appears in `composedExtensions` but is absent from this map, the
   * interpreter emits `PSL_UNKNOWN_CONTRACT_SPACE` and fails fast — there
   * is no silent fallback. If a space's contract is present but the
   * referenced model or namespace is not found in it, the interpreter
   * emits `PSL_UNKNOWN_CROSS_SPACE_TARGET`.
   */
  readonly composedExtensionContracts: ReadonlyMap<string, Contract>;
  /** Target-supplied factory that materialises a `SqlNamespaceBase` concretion for each namespace coordinate. */
  readonly createNamespace: (input: SqlNamespaceInput) => SqlNamespaceBase;
  readonly codecLookup: CodecLookupWithDescriptors;
  readonly seedDiagnostics?: readonly ContractSourceDiagnostic[];
  /** The target's default codec ids for an `enum` block that omits `@@type`. */
  readonly enumInferenceCodecs?: { readonly text: string; readonly int: string };
  readonly capabilities: CapabilityMatrix;
}

function buildComposedExtensionPackRefs(
  target: TargetPackRef<'sql', string>,
  extensionIds: readonly string[],
  extensionPackRefs: readonly ExtensionPackRef<'sql', string>[] = [],
): Record<string, ExtensionPackRef<'sql', string>> | undefined {
  if (extensionIds.length === 0) {
    return undefined;
  }

  const extensionPackRefById = new Map(extensionPackRefs.map((packRef) => [packRef.id, packRef]));

  return Object.fromEntries(
    extensionIds.map((extensionId) => [
      extensionId,
      extensionPackRefById.get(extensionId) ??
        ({
          kind: 'extension',
          id: extensionId,
          familyId: target.familyId,
          targetId: target.targetId,
          version: '0.0.1',
        } satisfies ExtensionPackRef<'sql', string>),
    ]),
  );
}

function declarationsHoldingModels(namespace: NamespaceSymbol): ReadonlySet<SyntaxNode> {
  const declarations = new Set<SyntaxNode>();
  for (const model of Object.values(namespace.models)) {
    const written = model.node.syntax.findAncestor(NamespaceDeclarationAst.cast);
    if (written !== undefined) declarations.add(written.syntax);
  }
  return declarations;
}

function validateNamespaceBlocksForSqlTarget(input: {
  readonly namespaces: readonly NamespaceSymbol[];
  readonly target: TargetPackRef<'sql', string>;
  readonly source: DiagnosticSource;
  readonly sources: PslSources;
  readonly binder: Binder;
  readonly diagnostics: PslDiagnosticCollector;
}): void {
  if (input.target.supportsNamespaces === false) {
    const targetName = input.target.displayName ?? input.target.targetId;
    for (const namespace of input.namespaces) {
      for (const { node, span } of namespace.declarations) {
        input.diagnostics.push({
          code: 'PSL_UNSUPPORTED_NAMESPACE_BLOCK',
          message: `${targetName} does not support \`namespace ${node.name()?.name() ?? namespace.name} { … }\` blocks (declare models at the document top level instead).`,
          ...diagnosticSource(input.sources, node.syntax).at(span),
        });
      }
    }
    return;
  }

  const unboundNamespace = input.namespaces.find(
    (namespace) =>
      namespace.id === UNBOUND_NAMESPACE_ID && Object.keys(namespace.models).length > 0,
  );
  const hasSibling = input.namespaces.some(
    (namespace) => namespace.id !== UNBOUND_NAMESPACE_ID && namespace.declarations.length > 0,
  );
  // Late binding is a MODEL story: a model in `namespace unbound { }` gets
  // its schema resolved by the connection's search_path, which contradicts
  // sibling namespaces that pin schemas explicitly. Extension blocks (e.g.
  // `role`) carry no such conflict — a blocks-only unbound namespace is
  // legal next to named namespaces and lowers into the unbound bucket.
  if (unboundNamespace !== undefined && hasSibling) {
    const holdingModels = declarationsHoldingModels(unboundNamespace);
    for (const { node, span } of unboundNamespace.declarations) {
      if (!holdingModels.has(node.syntax)) continue;
      input.diagnostics.push({
        code: 'PSL_RESERVED_NAMESPACE_NAME',
        message:
          'Namespace "unbound" is reserved for the late-binding sentinel mapping; a `namespace unbound { … }` containing models cannot appear alongside other named namespace blocks. ' +
          'Use `namespace unbound { … }` alone (no sibling named namespaces) for late-binding multi-tenant contracts.',
        ...diagnosticSource(input.sources, node.syntax).at(span),
      });
    }
  }
}

/**
 * Walks the flat `entityTypes` namespace tree in `authoringContributions` and
 * returns a map from discriminator string to the matching descriptor. The
 * interpreter uses this to dispatch parsed extension blocks to their factory
 * without naming any specific discriminator value (generic, by-discriminator).
 */
export function buildEntityTypesByDiscriminator(
  contributions: AuthoringContributions | undefined,
): ReadonlyMap<string, AuthoringEntityTypeDescriptor> {
  const result = new Map<string, AuthoringEntityTypeDescriptor>();
  const namespace = contributions?.entityTypes;
  if (namespace === undefined) return result;

  const walk = (node: AuthoringEntityTypeNamespace): void => {
    for (const value of Object.values(node)) {
      if (isAuthoringEntityTypeDescriptor(value)) {
        result.set(value.discriminator, value);
      } else if (typeof value === 'object' && value !== null) {
        walk(value);
      }
    }
  };
  walk(namespace);
  return result;
}

/**
 * The `PSL_DUPLICATE_ATTRIBUTE` diagnostic for a model attribute declared
 * more than once on one model. Shared by the built-in `@@control` path and
 * the contributed-model-attribute path so the code and wording stay in one
 * place. `name` is the bare attribute name (`control`, `rls`, …).
 */
function duplicateModelAttributeDiagnostic(input: {
  readonly name: string;
  readonly modelName: string;
  readonly source: DiagnosticSource;
  readonly span: ContractSourceDiagnostic['span'];
}): PslDiagnostic {
  return {
    code: 'PSL_DUPLICATE_ATTRIBUTE',
    message: `\`@@${input.name}\` declared more than once on model "${input.modelName}".`,
    ...input.source.at(input.span),
  };
}

function isResolvedModelReference(value: unknown): value is ResolvedEntityReference<ModelSymbol> {
  if (typeof value !== 'object' || value === null || !('declaration' in value)) return false;
  const declaration = value.declaration;
  return (
    typeof declaration === 'object' &&
    declaration !== null &&
    'kind' in declaration &&
    declaration.kind === 'model'
  );
}

function validateBlockModelAttributeRequirements(input: {
  readonly parsedBlocks: ReadonlyMap<BlockSymbol, ParsedPslExtensionBlock>;
  readonly pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace;
  readonly sources: PslSources;
  readonly diagnostics: PslDiagnosticCollector;
}): void {
  for (const [blockSymbol, envelope] of input.parsedBlocks) {
    const descriptor = findBlockDescriptor(input.pslBlockDescriptors, blockSymbol.keyword);
    const requirement = descriptor?.requiresModelAttribute;
    if (requirement === undefined) continue;
    const target = envelope.values[requirement.parameter];
    if (!isResolvedModelReference(target)) continue;
    const model = target.declaration;
    if (model.attributes.some((attribute) => attribute.name === requirement.attribute)) {
      continue;
    }
    input.diagnostics.push({
      code: 'PSL_EXTENSION_TARGET_MODEL_MISSING_ATTRIBUTE',
      message: `\`${blockSymbol.keyword}\` block "${envelope.name}" targets model "${model.name}", which does not declare \`@@${requirement.attribute}\`. Add \`@@${requirement.attribute}\` to model "${model.name}".`,
      ...diagnosticSource(input.sources, blockSymbol.node.syntax).at(
        envelope.parameterSpans[requirement.parameter] ?? envelope.span,
      ),
    });
  }
}

/**
 * Walks the flat `modelAttributes` namespace tree in `authoringContributions`
 * and returns a map from bare `@@` attribute name to the matching
 * descriptor. The model-attribute loop in `buildModelNodeFromPsl` uses this
 * to dispatch a contributed attribute without naming any specific attribute.
 */
function buildModelAttributesByName(
  contributions: AuthoringContributions | undefined,
): ReadonlyMap<string, AuthoringModelAttributeDescriptor> {
  const result = new Map<string, AuthoringModelAttributeDescriptor>();
  const namespace = contributions?.modelAttributes;
  if (namespace === undefined) return result;

  const walk = (node: AuthoringModelAttributeDescriptorNamespace): void => {
    for (const value of Object.values(node)) {
      if (isAuthoringModelAttributeDescriptor(value)) {
        result.set(value.attribute, value);
      } else if (typeof value === 'object' && value !== null) {
        walk(value);
      }
    }
  };
  walk(namespace);
  return result;
}

/**
 * This pass is intentionally generic: no discriminator value is named here.
 * The factory (registered by the target pack) owns all block-specific logic.
 */
function lowerExtensionBlocksForNamespace(
  blocks: Readonly<Record<string, BlockSymbol>>,
  ownerNamespaceId: string,
  entityTypesByDiscriminator: ReadonlyMap<string, AuthoringEntityTypeDescriptor>,
  entityContext: AuthoringEntityContext,
  parsedBlocks: ReadonlyMap<BlockSymbol, ParsedPslExtensionBlock>,
  modelCoordinateOf: (
    model: ModelSymbol,
  ) => { readonly namespaceId: string; readonly tableName: string } | undefined,
  sources: PslSources,
): readonly LoweredPackEntity[] {
  const rows: LoweredPackEntity[] = [];

  for (const blockSymbol of Object.values(blocks)) {
    const envelope = parsedBlocks.get(blockSymbol);
    if (envelope === undefined) continue;
    const descriptor = entityTypesByDiscriminator.get(envelope.kind);
    if (descriptor === undefined) continue;

    let resolvedModelRefs: Record<string, ResolvedPslModelRefs[string]> | undefined;
    for (const [paramName, value] of Object.entries(envelope.values)) {
      if (!isResolvedModelReference(value)) continue;
      const coordinate = modelCoordinateOf(value.declaration);
      invariant(
        coordinate !== undefined,
        `model mappings cover every collected model; \`${envelope.keyword}\` block "${envelope.name}" selected model "${value.declaration.name}" in \`${paramName}\` without a storage coordinate`,
      );
      resolvedModelRefs = { ...(resolvedModelRefs ?? {}), [paramName]: coordinate };
    }

    const annotatedBlock = {
      ...envelope,
      namespaceId: ownerNamespaceId,
      ...(resolvedModelRefs !== undefined ? { resolvedModelRefs } : {}),
    };
    const entity = instantiateAuthoringEntityType(
      descriptor.discriminator,
      descriptor,
      [annotatedBlock],
      { ...entityContext, sourceId: sources.sourceFileFor(blockSymbol.node.syntax).filename },
    );
    if (entity === undefined) continue;

    const namespaceId = providesPslEntityPlacement(descriptor.output)
      ? descriptor.output.pslPlacement(entity).namespaceId
      : ownerNamespaceId;
    rows.push({ namespaceId, entityKind: descriptor.discriminator, key: envelope.name, entity });

    const derivedValueSet = deriveValueSetFromEntity(descriptor.output, entity);
    if (derivedValueSet !== undefined) {
      rows.push({
        namespaceId,
        entityKind: 'valueSet',
        key: envelope.name,
        entity: derivedValueSet,
      });
    }
  }

  return rows;
}

interface ProcessEnumDeclarationsInput {
  readonly enumBlocks: readonly BlockSymbol[];
  readonly parsedBlocks: ReadonlyMap<BlockSymbol, ParsedPslExtensionBlock>;
  readonly source: DiagnosticSource;
  readonly authoringContributions: AuthoringContributions | undefined;
  readonly entityContext: AuthoringEntityContext;
  readonly diagnostics: PslDiagnosticCollector;
}

function processEnumDeclarations(input: ProcessEnumDeclarationsInput): {
  readonly enumHandles: Map<BlockSymbol, EnumTypeHandle>;
  readonly enumTypeDescriptors: Map<BlockSymbol, ColumnDescriptor>;
} {
  const enumHandles = new Map<BlockSymbol, EnumTypeHandle>();
  const enumTypeDescriptors = new Map<BlockSymbol, ColumnDescriptor>();

  if (input.enumBlocks.length === 0) {
    return { enumHandles, enumTypeDescriptors };
  }

  const enumDescriptor = getAuthoringEntity(input.authoringContributions, ['enum']);
  if (!enumDescriptor) {
    for (const symbol of input.enumBlocks) {
      input.diagnostics.push({
        code: 'PSL_ENUM_MISSING_FACTORY',
        message: `enum "${symbol.name}" requires an "enum" entityType factory in the active authoring contributions`,
        ...diagnosticSource(input.source.sources, symbol.node.syntax).at(symbol.span),
      });
    }
    return { enumHandles, enumTypeDescriptors };
  }

  for (const symbol of input.enumBlocks) {
    const envelope = input.parsedBlocks.get(symbol);
    input.diagnostics.push(...enumMemberAttributeDiagnostics(symbol, input.source.sources));
    if (envelope === undefined) continue;
    const handle = instantiateAuthoringEntityType<EnumTypeHandle | undefined>(
      'enum',
      enumDescriptor,
      [envelope],
      {
        ...input.entityContext,
        sourceId: input.source.sources.sourceFileFor(symbol.node.syntax).filename,
      },
    );

    if (handle === undefined || handle === null) continue;

    enumHandles.set(symbol, handle);
    enumTypeDescriptors.set(symbol, { codecId: handle.codecId });
  }

  return { enumHandles, enumTypeDescriptors };
}

interface BuildModelNodeInput {
  readonly model: ModelSymbol;
  readonly droppedFields: Set<FieldSymbol>;
  readonly physicalNames: ReadonlyMap<ModelSymbol | FieldSymbol, string>;
  readonly namespaceId: string;
  /** The value objects the composite types declare, by name. */
  readonly valueObjectTypes: ValueObjectTypes;
  readonly enumTypeDescriptors: ReadonlyMap<BlockSymbol, ColumnDescriptor>;
  readonly typeAliases: ResolvedTypeAliases;
  /** Extension contracts keyed by space ID for cross-space FK table-name resolution. */
  readonly composedExtensionContracts: ReadonlyMap<string, Contract>;
  readonly familyId: string;
  readonly targetId: string;
  readonly authoringContributions: AuthoringContributions | undefined;
  readonly defaultFunctionRegistry: ControlMutationDefaultRegistry;
  readonly generatorFunctions: GeneratorFunctionRegistry;
  readonly dataTypes: DataTypeSupport;
  readonly scalarColumnDescriptors: ReadonlyMap<string, ColumnDescriptor>;
  readonly sources: PslSources;
  readonly binder: Binder;
  readonly symbolTable: SymbolTable;
  readonly diagnostics: PslDiagnosticCollector;
  readonly enumHandles: ReadonlyMap<BlockSymbol, EnumTypeHandle>;
  readonly capabilities: CapabilityMatrix;
  /**
   * Extension entities already lowered per namespace (the exact shape
   * `lowerExtensionBlocksForNamespace` produces), keyed by namespace id then
   * entries-slot discriminator then block name. Forwarded to
   * `collectResolvedFields` for entity-ref type-constructor resolution (e.g.
   * `pg.enum(Ref)`).
   */
  readonly namespaceExtensionEntities?: ReadonlyMap<
    string,
    Readonly<Record<string, Readonly<Record<string, unknown>>>>
  >;
  /** Codec-id-keyed descriptor lookup — forwarded to `collectResolvedFields` for entity-ref type-constructor resolution (e.g. `pg.enum(Ref)`). */
  readonly codecLookup: CodecLookupWithDescriptors;
  /** Contributed model-attribute descriptors keyed by bare `@@` attribute name (the exact shape `buildModelAttributesByName` produces). */
  readonly modelAttributesByName: ReadonlyMap<string, AuthoringModelAttributeDescriptor>;
  readonly contributedModelAttributeSpecs: Readonly<Record<string, ModelAttributeSpecFactory>>;
  readonly parsedBlocks: ReadonlyMap<BlockSymbol, ParsedPslExtensionBlock>;
}

/** Where a relation names its foreign key's index, so a refusal of that name is reported at the relation. */
interface RelationIndexLocation {
  readonly namespaceId: string;
  readonly tableName: string;
  readonly columns: readonly string[];
  readonly index: string;
  readonly location: ReturnType<DiagnosticSource['at']>;
}

interface BuildModelNodeResult {
  readonly modelNode: ModelNode;
  readonly relationIndexLocations: readonly RelationIndexLocation[];
  readonly fkRelationMetadata: FkRelationMetadata<ModelSymbol>[];
  readonly invalidFkPairings: InvalidModelFkPairing<ModelSymbol>[];
  readonly backrelationCandidates: ModelBackrelationCandidate<ModelSymbol>[];
  /** Cross-contract-space relation nodes that bypass the local back-relation matching. */
  readonly crossSpaceRelations: RelationNode[];
  /** Entities lowered by contributed model attributes, keyed by attribute name then entity key (`entries[attribute][key]`). */
  readonly modelAttributeEntities: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

/**
 * The owning side of a relation is the one that declares `fields`/`references` on its
 * `@relation` attribute — those name the FK columns. A singular model-typed field whose
 * `@relation` carries only a name (or nothing at all) is the back side: infer prints exactly
 * that shape for a 1:1 back-relation whenever the FK needs disambiguating (two FKs between the
 * same table pair, or a self-referencing unique FK). Checking for the attribute's mere presence
 * would misclassify that back side as the owning side.
 */
function relationAttributeDeclaresOwningSide(relationAttribute: ResolvedAttribute): boolean {
  return (
    getNamedArgument(relationAttribute, 'fields') !== undefined ||
    getNamedArgument(relationAttribute, 'references') !== undefined
  );
}

function relationNullabilityMismatch(
  relationField: FieldSymbol,
  localColumns: readonly string[],
  resolvedFields: readonly ResolvedField[],
): boolean {
  return (
    resolveToOneRelationNullable({
      declaredNullable: relationField.optional,
      localFieldNullability: resolvedFields
        .filter((resolvedField) => localColumns.includes(resolvedField.columnName))
        .map((resolvedField) => resolvedField.nullable),
      ownsReference: true,
    }).contradiction !== undefined
  );
}

function relationNullabilityMismatchDiagnostic(
  modelName: string,
  relationAttribute: {
    readonly field: FieldSymbol;
    readonly relation: ResolvedAttribute<FieldAttributeAst>;
  },
  source: DiagnosticSource,
): PslDiagnostic {
  const fieldLabel = `Relation field "${modelName}.${relationAttribute.field.name}"`;
  const message = relationAttribute.field.optional
    ? `${fieldLabel} is optional but every field in @relation(fields: [...]) is required. Make one of those fields optional with "?" or remove "?" from "${relationAttribute.field.name}".`
    : `${fieldLabel} is required but a field in @relation(fields: [...]) is optional. Add "?" to "${relationAttribute.field.name}" or make those fields required.`;
  return {
    code: 'PSL_RELATION_NULLABILITY_MISMATCH',
    message,
    ...source.at(relationAttribute.field.span),
  };
}

function buildModelNodeFromPsl(input: BuildModelNodeInput): BuildModelNodeResult {
  const { model, diagnostics } = input;
  const source = diagnosticSource(input.sources, model.node.syntax);
  const tableName = storageName(model, input.physicalNames);
  const specContext = modelSpecContext({
    symbols: input.symbolTable,
    model,
    defaultFunctionRegistry: input.defaultFunctionRegistry,
    generatorFunctions: input.generatorFunctions,
    dataTypes: input.dataTypes,
  });
  const modelNamespaceId = input.namespaceId;

  const resolvedFields = collectResolvedFields({
    model,
    physicalNames: input.physicalNames,
    symbolTable: input.symbolTable,
    enumTypeDescriptors: input.enumTypeDescriptors,
    typeAliases: input.typeAliases,
    valueObjectTypes: input.valueObjectTypes,
    authoringContributions: input.authoringContributions,
    targetId: input.targetId,
    defaultFunctionRegistry: input.defaultFunctionRegistry,
    generatorFunctions: input.generatorFunctions,
    dataTypes: input.dataTypes,
    diagnostics,
    droppedFields: input.droppedFields,
    sources: input.sources,
    binder: input.binder,
    scalarColumnDescriptors: input.scalarColumnDescriptors,
    enumHandles: input.enumHandles,
    capabilities: input.capabilities,
    namespaceId: modelNamespaceId,
    ...ifDefined('namespaceExtensionEntities', input.namespaceExtensionEntities),
    codecLookup: input.codecLookup,
  });

  const inlineIdFields = resolvedFields.filter((field) => field.isId);
  if (inlineIdFields.length > 1) {
    diagnostics.push({
      code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
      message: `Model "${model.name}" cannot declare inline @id on multiple fields; use model-level @@id([...]) for composite identity`,
      ...source.at(model.span),
    });
  }
  const singleInlineIdField = inlineIdFields.length === 1 ? inlineIdFields[0] : undefined;
  let primaryKey: PrimaryKeyNode | undefined = singleInlineIdField
    ? {
        columns: [singleInlineIdField.columnName],
        ...ifDefined('name', singleInlineIdField.idName),
      }
    : undefined;
  const hasInlinePrimaryKey = primaryKey !== undefined;
  let blockPrimaryKeyDeclared = false;
  let controlPolicyDeclared = false;
  let controlPolicy: ControlPolicy | undefined;
  const declaredContributedModelAttributes = new Set<string>();
  const modelAttributeEntities: Record<string, Record<string, unknown>> = {};

  const resultBackrelationCandidates: ModelBackrelationCandidate<ModelSymbol>[] = [];
  for (const field of Object.values(model.fields)) {
    const backrelationTarget = backrelationTargetSymbol(field, input.binder);
    if (backrelationTarget === undefined) {
      continue;
    }
    const relationAttribute = getAttribute(field.attributes, 'relation');
    if (
      !field.list &&
      relationAttribute &&
      relationAttributeDeclaresOwningSide(relationAttribute)
    ) {
      // The owning side of the relation: it declares fields/references and is
      // lowered separately below, by the `relationAttributes` FK-building loop.
      continue;
    }
    const attributesValid = validateBackrelationFieldAttributes({
      modelName: model.name,
      field,
      sources: input.sources,
      binder: input.binder,
      diagnostics,
    });
    let relationName: string | undefined;
    if (relationAttribute) {
      const parsedRelation = interpretRelationAttribute({
        selfModel: model,
        field,
        specContext: fieldSpecContext({ ...specContext, field, binder: input.binder }),
        symbols: input.symbolTable,
        sources: input.sources,
        binder: input.binder,
        diagnostics,
      });
      if (!parsedRelation) {
        continue;
      }
      if (parsedRelation.fields || parsedRelation.references) {
        diagnostics.push({
          code: 'PSL_INVALID_RELATION_ATTRIBUTE',
          message: `Backrelation list field "${model.name}.${field.name}" cannot declare fields/references; define them on the FK-side relation field`,
          ...source.at(relationAttribute.span),
        });
        continue;
      }
      if (
        parsedRelation.onDelete ||
        parsedRelation.onUpdate ||
        parsedRelation.index !== undefined
      ) {
        diagnostics.push({
          code: 'PSL_INVALID_RELATION_ATTRIBUTE',
          message: `Backrelation list field "${model.name}.${field.name}" cannot declare onDelete/onUpdate/index; define them on the FK-side relation field`,
          ...source.at(relationAttribute.span),
        });
        continue;
      }
      relationName = parsedRelation.name;
    }
    if (!attributesValid) {
      continue;
    }

    resultBackrelationCandidates.push({
      modelName: model,
      tableName,
      field,
      targetModelName: backrelationTarget,
      isList: field.list,
      ...ifDefined('relationName', relationName),
    });
  }

  const relationAttributes = Object.values(model.fields)
    .map((field) => ({
      field,
      relation: getAttribute(field.attributes, 'relation'),
    }))
    .filter(
      (entry): entry is { field: FieldSymbol; relation: ResolvedAttribute<FieldAttributeAst> } =>
        Boolean(entry.relation),
    );
  const uniqueConstraints: UniqueConstraintNode[] = resolvedFields
    .filter((field) => field.isUnique)
    .map((field) => ({
      columns: [field.columnName],
      ...ifDefined('name', field.uniqueName),
    }));
  const indexNodes: IndexNode[] = [];
  const checkNodes: CheckNode[] = [];
  const foreignKeyNodes: ForeignKeyNode[] = [];

  for (const modelAttribute of model.attributes) {
    if (
      !Object.hasOwn(sqlAttributeSpecs.model, modelAttribute.name) &&
      !input.modelAttributesByName.has(modelAttribute.name)
    ) {
      continue;
    }
    if (modelAttribute.name === 'map') {
      continue;
    }
    if (modelAttribute.name === 'discriminator' || modelAttribute.name === 'base') {
      continue;
    }
    if (modelAttribute.name === 'control') {
      if (controlPolicyDeclared) {
        diagnostics.push(
          duplicateModelAttributeDiagnostic({
            name: 'control',
            modelName: model.name,
            source,
            span: modelAttribute.span,
          }),
        );
        continue;
      }
      controlPolicyDeclared = true;
      const node = modelAttribute.node;
      const parsed = interpretModelAttribute({
        node,
        spec: sqlAttributeSpecs.model.control(specContext),
        model,
        symbols: input.symbolTable,
        sources: input.sources,
        binder: input.binder,
        diagnostics,
      });
      if (parsed !== undefined) {
        controlPolicy = parsed.policy;
      }
      continue;
    }
    const attributeLabel = `Model "${model.name}" @@${modelAttribute.name}`;
    if (modelAttribute.name === 'id') {
      if (blockPrimaryKeyDeclared) {
        diagnostics.push({
          code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
          message: `Model "${model.name}" declares @@id more than once`,
          ...source.at(modelAttribute.span),
        });
        continue;
      }
      if (hasInlinePrimaryKey) {
        diagnostics.push({
          code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
          message: `Model "${model.name}" cannot declare both field-level @id and model-level @@id`,
          ...source.at(modelAttribute.span),
        });
        blockPrimaryKeyDeclared = true;
        continue;
      }
      const node = modelAttribute.node;
      const parsed = interpretModelAttribute({
        node,
        spec: sqlAttributeSpecs.model.id(specContext),
        model,
        symbols: input.symbolTable,
        sources: input.sources,
        binder: input.binder,
        diagnostics,
      });
      if (parsed === undefined) {
        continue;
      }
      const fieldNames = parsed.fields;
      const nullableFieldName = fieldNames.find((name) => model.fields[name]?.optional === true);
      if (nullableFieldName !== undefined) {
        diagnostics.push({
          code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
          message: `${attributeLabel} cannot include optional field "${nullableFieldName}"; primary key columns must be NOT NULL`,
          ...source.at(modelAttribute.span),
        });
        continue;
      }
      const columnNames = mapFieldNamesToColumns({
        model,
        physicalNames: input.physicalNames,
        fieldNames,
        source,
        diagnostics,
        span: modelAttribute.span,
        entityLabel: attributeLabel,
      });
      if (!columnNames) {
        continue;
      }
      primaryKey = {
        columns: columnNames,
        ...ifDefined('name', parsed.map),
      };
      blockPrimaryKeyDeclared = true;
      continue;
    }
    if (modelAttribute.name === 'unique') {
      const node = modelAttribute.node;
      const parsed = interpretModelAttribute({
        node,
        spec: sqlAttributeSpecs.model.unique(specContext),
        model,
        symbols: input.symbolTable,
        sources: input.sources,
        binder: input.binder,
        diagnostics,
      });
      if (parsed === undefined) {
        continue;
      }
      const columnNames = mapFieldNamesToColumns({
        model,
        physicalNames: input.physicalNames,
        fieldNames: parsed.fields,
        source,
        diagnostics,
        span: modelAttribute.span,
        entityLabel: attributeLabel,
      });
      if (!columnNames) {
        continue;
      }
      uniqueConstraints.push({
        columns: columnNames,
        ...ifDefined('name', parsed.map),
      });
      continue;
    }
    if (modelAttribute.name === 'index') {
      const node = modelAttribute.node;
      const parsed = interpretModelAttribute({
        node,
        spec: sqlAttributeSpecs.model.index(specContext),
        model,
        symbols: input.symbolTable,
        sources: input.sources,
        binder: input.binder,
        diagnostics,
      });
      if (parsed === undefined) {
        continue;
      }
      let columnNames: readonly string[] | undefined;
      if (parsed.fields !== undefined) {
        const mapped = mapFieldNamesToColumns({
          model,
          physicalNames: input.physicalNames,
          fieldNames: parsed.fields,
          source,
          diagnostics,
          span: modelAttribute.span,
          entityLabel: attributeLabel,
        });
        if (!mapped) {
          continue;
        }
        columnNames = mapped;
      }
      indexNodes.push(
        // PSL attribute arguments are assembled one at a time, so the
        // compiler cannot see either union arm; the interpreter's own
        // span-anchored diagnostics reject both invalid shapes first.
        blindCast<
          IndexNode,
          'dynamically assembled from PSL arguments; the interpreter diagnoses both invalid shapes and lowerAuthoredIndex re-checks'
        >({
          ...ifDefined('columns', columnNames),
          ...ifDefined(
            'expression',
            parsed.expression === undefined
              ? undefined
              : sqlTextFromStored(parsed.expression.value.value),
          ),
          where:
            parsed.where === undefined ? undefined : sqlTextFromStored(parsed.where.value.value),
          unique: parsed.unique,
          name: parsed.name,
          map: parsed.map,
          type: parsed.type,
          options: parsed.options,
        }),
      );
      continue;
    }
    if (modelAttribute.name === 'check') {
      const node = modelAttribute.node;
      if (input.capabilities['sql']?.['checkConstraint'] !== true) {
        diagnostics.push({
          code: 'PSL_CHECK_UNSUPPORTED_TARGET',
          message: `Model "${model.name}" declares "@@check", but target "${input.targetId}" does not support check constraints (the adapter does not report the "checkConstraint" capability). Remove the check or author it against a target that supports check constraints.`,
          ...source.at(modelAttribute.span),
        });
        continue;
      }
      const parsed = interpretModelAttribute({
        node,
        spec: sqlAttributeSpecs.model.check(specContext),
        model,
        symbols: input.symbolTable,
        sources: input.sources,
        binder: input.binder,
        diagnostics,
      });
      if (parsed === undefined) {
        continue;
      }
      checkNodes.push({
        expression: sqlTextFromStored(parsed.expression.value.value),
        name: parsed.name,
        map: parsed.map,
      });
      continue;
    }
    const contributedModelAttribute = input.modelAttributesByName.get(modelAttribute.name);
    if (contributedModelAttribute !== undefined) {
      if (
        contributedModelAttribute.repeatable !== true &&
        declaredContributedModelAttributes.has(modelAttribute.name)
      ) {
        diagnostics.push(
          duplicateModelAttributeDiagnostic({
            name: modelAttribute.name,
            modelName: model.name,
            source,
            span: modelAttribute.span,
          }),
        );
        continue;
      }
      declaredContributedModelAttributes.add(modelAttribute.name);
      const node = modelAttribute.node;
      const specFactory = input.contributedModelAttributeSpecs[contributedModelAttribute.attribute];
      if (specFactory === undefined) {
        continue;
      }
      const parsed = interpretModelAttribute({
        node,
        spec: specFactory(specContext),
        model,
        symbols: input.symbolTable,
        sources: input.sources,
        binder: input.binder,
        diagnostics,
      });
      if (parsed === undefined) {
        continue;
      }
      const lower = blindCast<
        (
          parsed: unknown,
          ctx: AuthoringModelAttributeContext,
        ) => AuthoringModelAttributeLoweringOutput | undefined,
        "lowering is called with the exact value interpretModelAttribute parsed against this descriptor's own spec"
      >(contributedModelAttribute.lower);
      const lowered = lower(parsed, {
        family: input.familyId,
        target: input.targetId,
        codecLookup: input.codecLookup,
        dataTypes: input.dataTypes,
        modelName: model.name,
        storageName: tableName,
        fieldStorageName: (fieldName) => {
          const field = model.fields[fieldName];
          return field === undefined ? undefined : storageName(field, input.physicalNames);
        },
        fieldCodecId: (fieldName) =>
          resolvedFields.find((resolved) => resolved.field.name === fieldName)?.descriptor.codecId,
        namespaceId: modelNamespaceId,
        sourceId: source.sources.sourceFileFor(source.node).filename,
        diagnostics: {
          push: (d) => {
            diagnostics.pushExternal(
              blindCast<ContractSourceDiagnostic, 'sink diagnostics are span-compatible'>(d),
            );
          },
        },
      });
      if (lowered === undefined) {
        continue;
      }
      if ('index' in lowered) {
        if (!isAuthoredIndexInput(lowered.index)) {
          throw contractError(
            'CONTRACT.PACK_CONTRIBUTION_INVALID',
            `model attribute "@@${modelAttribute.name}" on model "${model.name}" lowered to a malformed index. A contributed attribute that returns { index } must return an authored-index input: exactly one of a columns list or an expression, plus explicit where/unique/name/map and a type-with-options pair.`,
            { meta: { attribute: modelAttribute.name, modelName: model.name } },
          );
        }
        indexNodes.push(lowered.index);
        continue;
      }
      const slot = modelAttributeEntities[contributedModelAttribute.attribute] ?? {};
      modelAttributeEntities[contributedModelAttribute.attribute] = slot;
      slot[lowered.key] = lowered.entity;
      continue;
    }
    throw new InternalError(
      `Model attribute "@@${modelAttribute.name}" is registered but has no interpreter branch`,
    );
  }

  const resultFkRelationMetadata: FkRelationMetadata<ModelSymbol>[] = [];
  const relationIndexLocations: RelationIndexLocation[] = [];
  const resultInvalidFkPairings: InvalidModelFkPairing<ModelSymbol>[] = [];
  const resultCrossSpaceRelations: RelationNode[] = [];
  for (const relationAttribute of relationAttributes) {
    const {
      typeName: fieldTypeName,
      typeNamespaceId: fieldTypeNamespaceId,
      typeContractSpaceId: fieldTypeContractSpaceId,
    } = relationAttribute.field;

    if (relationAttribute.field.list) {
      // F-list: cross-space list relations are explicitly unsupported (Option B does not
      // navigate, so a list target makes no sense to carry). Emit a diagnostic instead of
      // silently dropping the field — the author needs to know the field was ignored.
      if (fieldTypeContractSpaceId !== undefined) {
        diagnostics.push({
          code: 'PSL_UNSUPPORTED_CROSS_SPACE_LIST',
          message: `Relation field "${model.name}.${relationAttribute.field.name}" is a cross-space list relation (type "${fieldTypeContractSpaceId}:${fieldTypeNamespaceId !== undefined ? `${fieldTypeNamespaceId}.` : ''}${fieldTypeName}[]"). Cross-space relations must be singular in v0.1 — list cross-space relations are not supported.`,
          ...source.at(relationAttribute.field.span),
        });
      }
      continue;
    }

    if (!relationAttributeDeclaresOwningSide(relationAttribute.relation)) {
      // A singular model-typed field whose `@relation` carries only a name (or nothing) is the
      // back side of a 1:1 relation, already lowered above via backrelationCandidates. It is
      // not the owning side, so it has no fields/references to validate here.
      continue;
    }

    // Cross-contract-space relation: the target model lives in a different contract space
    // identified by `typeContractSpaceId` (e.g. `supabase:auth.User`).
    if (fieldTypeContractSpaceId !== undefined) {
      // Fail fast if the space has no entry in composedExtensionContracts (AC5 PSL half).
      const extContractForSpace = input.composedExtensionContracts.get(fieldTypeContractSpaceId);
      if (extContractForSpace === undefined) {
        diagnostics.push({
          code: 'PSL_UNKNOWN_CONTRACT_SPACE',
          message: `Relation field "${model.name}.${relationAttribute.field.name}" references contract space "${fieldTypeContractSpaceId}" which is not declared in extensions. Add "${fieldTypeContractSpaceId}" to extensions in prisma.config.ts.`,
          ...source.at(relationAttribute.field.span),
          data: { space: fieldTypeContractSpaceId, suggestedPack: fieldTypeContractSpaceId },
        });
        continue;
      }

      const parsedRelation = interpretRelationAttribute({
        selfModel: model,
        field: relationAttribute.field,
        specContext: fieldSpecContext({
          ...specContext,
          field: relationAttribute.field,
          binder: input.binder,
        }),
        symbols: input.symbolTable,
        sources: input.sources,
        binder: input.binder,
        diagnostics,
      });
      if (!parsedRelation) {
        continue;
      }
      if (!parsedRelation.fields || !parsedRelation.references) {
        diagnostics.push({
          code: 'PSL_INVALID_RELATION_ATTRIBUTE',
          message: `Relation field "${model.name}.${relationAttribute.field.name}" requires fields and references arguments`,
          ...source.at(relationAttribute.relation.span),
        });
        continue;
      }

      const localColumns = mapFieldNamesToColumns({
        model,
        physicalNames: input.physicalNames,
        fieldNames: parsedRelation.fields,
        source,
        diagnostics,
        span: relationAttribute.relation.span,
        entityLabel: `Relation field "${model.name}.${relationAttribute.field.name}"`,
      });
      if (!localColumns) {
        continue;
      }

      if (relationNullabilityMismatch(relationAttribute.field, localColumns, resolvedFields)) {
        diagnostics.push(
          relationNullabilityMismatchDiagnostic(model.name, relationAttribute, source),
        );
        continue;
      }

      // For cross-space references the `references` list provides field names from the remote
      // model. Since the interpreter has no access to the extension contract, these field names
      // are treated as column names directly (matching the TS builder's cross-space path).
      const referencedColumns = parsedRelation.references;

      if (localColumns.length !== referencedColumns.length) {
        diagnostics.push({
          code: 'PSL_INVALID_RELATION_ATTRIBUTE',
          message: `Relation field "${model.name}.${relationAttribute.field.name}" must provide the same number of fields and references`,
          ...source.at(relationAttribute.relation.span),
        });
        continue;
      }

      const onDelete = parsedRelation.onDelete
        ? normalizeReferentialAction(parsedRelation.onDelete)
        : undefined;
      const onUpdate = parsedRelation.onUpdate
        ? normalizeReferentialAction(parsedRelation.onUpdate)
        : undefined;

      // Target namespace: use the colon-prefix namespace qualifier, or `__unbound__` when the
      // no-namespace form is used (e.g. `supabase:User` → AC3).
      const crossTargetNamespaceId = fieldTypeNamespaceId ?? UNBOUND_NAMESPACE_ID;

      // Target table name: resolved from the extension contract. The get() check above
      // guarantees extContractForSpace is defined here; if the model or namespace is not
      // found in it, emit PSL_UNKNOWN_CROSS_SPACE_TARGET (user typo).
      const extContract = extContractForSpace;
      const resolvedTable =
        extContract.domain.namespaces[crossTargetNamespaceId]?.models[fieldTypeName]?.storage[
          'table'
        ];
      if (typeof resolvedTable !== 'string') {
        const availableModels =
          Object.keys(extContract.domain.namespaces[crossTargetNamespaceId]?.models ?? {}).join(
            ', ',
          ) || '(none)';
        diagnostics.push({
          code: 'PSL_UNKNOWN_CROSS_SPACE_TARGET',
          message: `Relation field "${model.name}.${relationAttribute.field.name}" references model "${fieldTypeName}" in namespace "${crossTargetNamespaceId}" of space "${fieldTypeContractSpaceId}", but that model was not found in the extension contract. Available models: ${availableModels}`,
          ...source.at(relationAttribute.field.span),
          data: {
            space: fieldTypeContractSpaceId,
            namespace: crossTargetNamespaceId,
            model: fieldTypeName,
          },
        });
        continue;
      }
      const crossTargetTableName = resolvedTable;

      foreignKeyNodes.push({
        columns: localColumns,
        references: {
          model: fieldTypeName,
          table: crossTargetTableName,
          columns: referencedColumns,
          namespaceId: crossTargetNamespaceId,
          spaceId: fieldTypeContractSpaceId,
        },
        ...ifDefined('name', parsedRelation.map),
        ...ifDefined('onDelete', onDelete),
        ...ifDefined('onUpdate', onUpdate),
        ...ifDefined('index', parsedRelation.index),
      });
      if (typeof parsedRelation.index === 'string') {
        relationIndexLocations.push({
          namespaceId: modelNamespaceId,
          tableName,
          columns: localColumns,
          index: parsedRelation.index,
          location: source.at(relationAttribute.relation.span),
        });
      }

      // Build the cross-space RelationNode directly (no local back-relation candidate).
      // `buildSqlContractFromDefinition` recognises `spaceId` on a RelationNode and routes it
      // through the cross-space domain-relation path (produces a non-navigable CrossReference).
      resultCrossSpaceRelations.push({
        fieldName: relationAttribute.field.name,
        toModel: fieldTypeName,
        toTable: crossTargetTableName,
        cardinality: 'N:1',
        nullable: relationAttribute.field.optional,
        spaceId: fieldTypeContractSpaceId,
        namespaceId: crossTargetNamespaceId,
        on: {
          parentTable: tableName,
          parentColumns: localColumns,
          childTable: crossTargetTableName,
          childColumns: referencedColumns,
        },
      });

      continue;
    }

    const qualifiedTypeName = fieldTypeNamespaceId
      ? `${fieldTypeNamespaceId}.${fieldTypeName}`
      : fieldTypeName;

    const typeReference = typeReferenceNode(relationAttribute.field);
    const targetResolution =
      typeReference === undefined ? undefined : input.binder.symbolForNode(typeReference);
    if (targetResolution?.kind === 'unresolved') {
      continue;
    }
    if (targetResolution?.kind !== 'model') {
      const foundKind =
        targetResolution === undefined ? undefined : relationTargetKindLabel(targetResolution);
      diagnostics.push({
        code: 'PSL_INVALID_RELATION_TARGET',
        message:
          foundKind === undefined
            ? `Relation field "${model.name}.${relationAttribute.field.name}" references unknown model "${qualifiedTypeName}"`
            : `Relation field "${model.name}.${relationAttribute.field.name}" references ${foundKind} "${qualifiedTypeName}"; a relation target must be a model`,
        ...source.at(relationAttribute.field.span),
      });
      continue;
    }
    const targetModel = targetResolution.symbol;
    const targetNamespaceId = targetResolution.namespace.id;

    const parsedRelation = interpretRelationAttribute({
      selfModel: model,
      field: relationAttribute.field,
      specContext: fieldSpecContext({
        ...specContext,
        field: relationAttribute.field,
        binder: input.binder,
      }),
      symbols: input.symbolTable,
      sources: input.sources,
      binder: input.binder,
      diagnostics,
    });
    if (!parsedRelation) {
      continue;
    }
    if (!parsedRelation.fields || !parsedRelation.references) {
      diagnostics.push({
        code: 'PSL_INVALID_RELATION_ATTRIBUTE',
        message: `Relation field "${model.name}.${relationAttribute.field.name}" requires fields and references arguments`,
        ...source.at(relationAttribute.relation.span),
      });
      continue;
    }

    const localColumns = mapFieldNamesToColumns({
      model,
      physicalNames: input.physicalNames,
      fieldNames: parsedRelation.fields,
      source,
      diagnostics,
      span: relationAttribute.relation.span,
      entityLabel: `Relation field "${model.name}.${relationAttribute.field.name}"`,
    });
    if (!localColumns) {
      continue;
    }
    if (relationNullabilityMismatch(relationAttribute.field, localColumns, resolvedFields)) {
      diagnostics.push(
        relationNullabilityMismatchDiagnostic(model.name, relationAttribute, source),
      );
      resultInvalidFkPairings.push({
        declaringModel: model,
        targetModel,
        ...ifDefined('relationName', parsedRelation.name),
      });
      continue;
    }
    const referencedColumns = mapFieldNamesToColumns({
      model: targetModel,
      physicalNames: input.physicalNames,
      fieldNames: parsedRelation.references,
      source,
      diagnostics,
      span: relationAttribute.relation.span,
      entityLabel: `Relation field "${model.name}.${relationAttribute.field.name}"`,
    });
    if (!referencedColumns) {
      continue;
    }
    if (localColumns.length !== referencedColumns.length) {
      diagnostics.push({
        code: 'PSL_INVALID_RELATION_ATTRIBUTE',
        message: `Relation field "${model.name}.${relationAttribute.field.name}" must provide the same number of fields and references`,
        ...source.at(relationAttribute.relation.span),
      });
      continue;
    }

    const onDelete = parsedRelation.onDelete
      ? normalizeReferentialAction(parsedRelation.onDelete)
      : undefined;
    const onUpdate = parsedRelation.onUpdate
      ? normalizeReferentialAction(parsedRelation.onUpdate)
      : undefined;

    const targetTableName = storageName(targetModel, input.physicalNames);
    foreignKeyNodes.push({
      columns: localColumns,
      references: {
        model: targetModel.name,
        table: targetTableName,
        columns: referencedColumns,
        namespaceId: targetNamespaceId,
      },
      ...ifDefined('name', parsedRelation.map),
      ...ifDefined('onDelete', onDelete),
      ...ifDefined('onUpdate', onUpdate),
      ...ifDefined('index', parsedRelation.index),
    });
    if (typeof parsedRelation.index === 'string') {
      relationIndexLocations.push({
        namespaceId: modelNamespaceId,
        tableName,
        columns: localColumns,
        index: parsedRelation.index,
        location: source.at(relationAttribute.relation.span),
      });
    }

    resultFkRelationMetadata.push({
      declaringModelName: model,
      declaringFieldName: relationAttribute.field.name,
      declaringTableName: tableName,
      ...ifDefined('declaringNamespaceId', modelNamespaceId),
      targetModelName: targetModel,
      targetTableName,
      ...ifDefined('targetNamespaceId', targetNamespaceId),
      ...ifDefined('relationName', parsedRelation.name),
      nullable: relationAttribute.field.optional,
      localColumns,
      referencedColumns,
    });
  }

  return {
    modelNode: {
      modelName: model.name,
      tableName,
      fields: resolvedFields.map((resolvedField): FieldNode | ValueObjectFieldNode => {
        const common = {
          fieldName: resolvedField.field.name,
          columnName: resolvedField.columnName,
          descriptor: resolvedField.descriptor,
          nullable: resolvedField.nullable,
          ...ifDefined('many', resolvedField.many),
          ...ifDefined(
            'elementNullable',
            resolvedField.many ? resolvedField.elementNullable === true : undefined,
          ),
          ...ifDefined('default', resolvedField.defaultValue),
          ...ifDefined('executionDefaults', resolvedField.executionDefaults),
        };
        if (resolvedField.valueObjectTypeName !== undefined) {
          return { ...common, valueObjectName: resolvedField.valueObjectTypeName };
        }
        return {
          ...common,
          ...ifDefined('enumTypeHandle', resolvedField.enumTypeHandle),
        };
      }),
      ...ifDefined('id', primaryKey),
      ...(uniqueConstraints.length > 0 ? { uniques: uniqueConstraints } : {}),
      ...(indexNodes.length > 0 ? { indexes: indexNodes } : {}),
      ...(checkNodes.length > 0 ? { checks: checkNodes } : {}),
      ...(foreignKeyNodes.length > 0 ? { foreignKeys: foreignKeyNodes } : {}),
      ...ifDefined('control', controlPolicy),
    },
    fkRelationMetadata: resultFkRelationMetadata,
    relationIndexLocations,
    invalidFkPairings: resultInvalidFkPairings,
    crossSpaceRelations: resultCrossSpaceRelations,
    backrelationCandidates: resultBackrelationCandidates,
    modelAttributeEntities,
  };
}

interface BuildValueObjectNodesInput {
  readonly compositeTypes: readonly CompositeTypeSymbol[];
  readonly droppedFields: Set<FieldSymbol>;
  readonly enumTypeDescriptors: ReadonlyMap<BlockSymbol, ColumnDescriptor>;
  readonly enumHandles: ReadonlyMap<BlockSymbol, EnumTypeHandle>;
  readonly typeAliases: ResolvedTypeAliases;
  readonly dataTypes: DataTypeSupport;
  readonly diagnostics: PslDiagnosticCollector;
  readonly sources: PslSources;
  /** Composite types are placed in the default namespace, so their members resolve against it. */
  readonly defaultNamespaceId: string;
  readonly namespaceExtensionEntities: ReadonlyMap<
    string,
    Readonly<Record<string, Readonly<Record<string, unknown>>>>
  >;
  readonly codecLookup: CodecLookupWithDescriptors;
  readonly binder: Binder;
}

function buildValueObjectNodes(input: BuildValueObjectNodesInput): ValueObjectNode[] {
  const { compositeTypes, enumHandles, diagnostics, sources, binder } = input;

  return compositeTypes.map((compositeType) => {
    for (const attribute of compositeType.attributes) {
      diagnostics.push({
        code: 'PSL_UNSUPPORTED_COMPOSITE_TYPE_ATTRIBUTE',
        message: `Composite type "${compositeType.name}" uses attribute "@@${attribute.name}", which a composite type does not take`,
        ...diagnosticSource(sources, compositeType.node.syntax).at(attribute.span),
      });
    }
    const fields: (ScalarMemberNode | ValueObjectMemberNode)[] = [];
    for (const field of Object.values(compositeType.fields)) {
      for (const attribute of field.attributes) {
        diagnostics.push({
          code: 'PSL_UNSUPPORTED_FIELD_ATTRIBUTE',
          message: `Member "${field.name}" of composite type "${compositeType.name}" uses attribute "@${attribute.name}", which a composite type member does not take`,
          ...diagnosticSource(sources, field.node.syntax).at(attribute.span),
        });
      }
      const common = {
        fieldName: field.name,
        nullable: field.optional,
        ...ifDefined('many', field.list ? (true as const) : undefined),
        ...ifDefined('elementNullable', field.list ? field.elementOptional : undefined),
      };
      const fieldTypeReference = typeReferenceNode(field);
      const fieldTypeResolution =
        fieldTypeReference === undefined ? undefined : binder.symbolForNode(fieldTypeReference);
      if (fieldTypeResolution?.kind === 'compositeType') {
        fields.push({ ...common, valueObjectName: fieldTypeResolution.symbol.name });
        continue;
      }
      const resolved = resolveFieldTypeDescriptor({
        field,
        resolution: fieldTypeResolution,
        enumTypeDescriptors: input.enumTypeDescriptors,
        typeAliases: input.typeAliases,
        diagnostics,
        sources,
        entityLabel: `Field "${compositeType.name}.${field.name}"`,
        namespaceId: input.defaultNamespaceId,
        namespaceExtensionEntities: input.namespaceExtensionEntities,
        binder,
        codecLookup: input.codecLookup,
        dataTypes: input.dataTypes,
      });
      if (!resolved.ok) {
        input.droppedFields.add(field);
        continue;
      }
      const { descriptor } = resolved;
      if (descriptor.valueSet !== undefined) {
        diagnostics.push({
          code: 'PSL_UNSUPPORTED_FIELD_TYPE',
          message: `Field "${compositeType.name}.${field.name}" is typed by the storage enum "${descriptor.valueSet.entityName}", which a composite type member cannot use: a member has no column to store it in. Use a PSL enum instead.`,
          ...diagnosticSource(sources, field.node.syntax).at(field.span),
        });
        continue;
      }
      const typeAlias = input.typeAliases.ofResolution(fieldTypeResolution);
      for (const attribute of typeAlias === undefined
        ? []
        : typeAliasAttributeNames(typeAlias.alias)) {
        diagnostics.push({
          code: 'PSL_UNSUPPORTED_FIELD_ATTRIBUTE',
          message: `Member "${field.name}" of composite type "${compositeType.name}" is typed by the type alias "${field.typeName}", which carries "@${attribute}", an attribute a composite type member does not take`,
          ...diagnosticSource(sources, field.node.syntax).at(field.span),
        });
      }
      fields.push({
        ...common,
        descriptor: {
          codecId: descriptor.codecId,
          ...ifDefined('typeParams', descriptor.typeParams),
        },
        ...ifDefined(
          'enumTypeHandle',
          fieldTypeResolution?.kind === 'block'
            ? enumHandles.get(fieldTypeResolution.symbol)
            : typeAlias?.enumHandle,
        ),
      });
    }
    return { name: compositeType.name, fields };
  });
}

type DiscriminatorDeclaration = {
  readonly model: ModelSymbol;
  readonly source: DiagnosticSource;
  readonly fieldName: string;
  readonly span: ContractSourceDiagnosticSpan;
};

type ModelIdentity = {
  readonly model: ModelSymbol;
  readonly namespaceId: string;
  readonly key: string;
};

type BaseDeclaration = {
  readonly model: ModelSymbol;
  readonly namespaceId: string;
  readonly source: DiagnosticSource;
  readonly base: ModelIdentity;
  /** The discriminator value as the discriminator column stores it; `undefined` when the base has no discriminator or the value was refused. */
  readonly value: string | undefined;
  readonly span: ContractSourceDiagnosticSpan;
};

type PendingBaseDeclaration = Omit<BaseDeclaration, 'value'> & {
  readonly written: ParsedWrittenScalar;
};

/** A discriminator field as the discriminator rule reads it, with the name of the enum that types it. */
type DiscriminatorFieldWithEnum = {
  readonly field: DiscriminatorField;
  readonly enumName: string | undefined;
};

type DiscriminatorFieldOf = (model: ModelSymbol, fieldName: string) => DiscriminatorFieldWithEnum;

/** The discriminators already reported, by their model's key: refused by the discriminator rule or failed to parse. No orphaned-base diagnostic is added for them. */
type ReportedPolymorphism = {
  readonly discriminators: Set<string>;
};

type PendingDiscriminator = {
  readonly declaration: DiscriminatorDeclaration;
  readonly field: DiscriminatorFieldWithEnum;
};

function collectPolymorphismDeclarations(
  identities: ReadonlyMap<ModelSymbol, ModelIdentity>,
  symbols: SymbolTable,
  sources: PslSources,
  binder: Binder,
  specContextFor: (model: ModelSymbol) => AttributeSpecContext,
  discriminatorFieldOf: DiscriminatorFieldOf,
  codecLookup: CodecLookupWithDescriptors,
  dataTypes: DataTypeSupport,
  diagnostics: PslDiagnosticCollector,
): {
  discriminatorDeclarations: Map<string, DiscriminatorDeclaration>;
  baseDeclarations: Map<string, BaseDeclaration>;
  reported: ReportedPolymorphism;
} {
  const pendingDiscriminators = new Map<string, PendingDiscriminator>();
  const pendingBaseDeclarations = new Map<string, PendingBaseDeclaration>();
  const reported: ReportedPolymorphism = { discriminators: new Set() };

  for (const { model, namespaceId, key } of identities.values()) {
    const source = diagnosticSource(sources, model.node.syntax);
    const discriminatorNode = getAttribute(model.attributes, 'discriminator')?.node;
    if (discriminatorNode !== undefined) {
      const parsed = interpretModelAttribute({
        node: discriminatorNode,
        symbols,
        spec: sqlAttributeSpecs.model.discriminator(specContextFor(model)),
        model,
        sources,
        binder,
        diagnostics,
      });
      if (parsed !== undefined) {
        pendingDiscriminators.set(key, {
          declaration: {
            model,
            fieldName: parsed.field,
            span: nodePslSpan(discriminatorNode.syntax, sources),
            source,
          },
          field: discriminatorFieldOf(model, parsed.field),
        });
      } else {
        reported.discriminators.add(key);
      }
    }

    const baseNode = getAttribute(model.attributes, 'base')?.node;
    if (baseNode !== undefined) {
      const parsed = interpretModelAttribute({
        node: baseNode,
        symbols,
        spec: sqlAttributeSpecs.model.base(specContextFor(model)),
        model,
        sources,
        binder,
        diagnostics,
      });
      if (parsed !== undefined) {
        const base = identities.get(parsed.base.declaration);
        invariant(
          base !== undefined,
          `Resolved base model "${parsed.base.declaration.name}" is missing from the collected model identities`,
        );
        pendingBaseDeclarations.set(key, {
          model,
          namespaceId,
          source,
          base,
          written: parsed.value,
          span: nodePslSpan(baseNode.syntax, sources),
        });
      }
    }
  }

  const discriminatorDeclarations = new Map<string, DiscriminatorDeclaration>();
  const values = new Map<string, string>();
  for (const [baseKey, { declaration, field }] of pendingDiscriminators) {
    const bases = [...pendingBaseDeclarations].filter(([, base]) => base.base.key === baseKey);
    const accepted = acceptedDiscriminator(declaration, field, bases, {
      codecLookup,
      dataTypes,
      diagnostics,
    });
    if (accepted === undefined) {
      reported.discriminators.add(baseKey);
      continue;
    }
    discriminatorDeclarations.set(baseKey, declaration);
    for (const [variantKey, value] of accepted) values.set(variantKey, value);
  }

  const baseDeclarations = new Map<string, BaseDeclaration>();
  for (const [key, { model, namespaceId, source, base, span }] of pendingBaseDeclarations) {
    baseDeclarations.set(key, { model, namespaceId, source, base, span, value: values.get(key) });
  }

  return { discriminatorDeclarations, baseDeclarations, reported };
}

/**
 * The stored discriminator value of each variant, by the variant's key, when the discriminator rule accepts the field; `undefined` when it refuses the field. A refusal is reported at the `@@discriminator` attribute or at the `@@base` value it is about.
 */
function acceptedDiscriminator(
  declaration: DiscriminatorDeclaration,
  discriminatorField: DiscriminatorFieldWithEnum,
  bases: readonly (readonly [string, PendingBaseDeclaration])[],
  input: {
    readonly codecLookup: CodecLookupWithDescriptors;
    readonly dataTypes: DataTypeSupport;
    readonly diagnostics: PslDiagnosticCollector;
  },
): ReadonlyMap<string, string> | undefined {
  const { model, fieldName } = declaration;
  const baseByKey = new Map(bases);
  const decision = applyDiscriminatorRule({
    field: discriminatorField.field,
    variants: bases.map(([key, base]) => ({ key, written: writtenBaseValue(base) })),
    subject: `Field "${model.name}.${fieldName}"`,
    codecLookup: input.codecLookup,
    dataTypes: input.dataTypes,
  });
  const baseOf = (variantKey: string): PendingBaseDeclaration => {
    const base = baseByKey.get(variantKey);
    invariant(base !== undefined, 'A refused @@base value belongs to a collected variant');
    return base;
  };
  const subject = {
    modelName: model.name,
    fieldName,
    typeName: model.fields[fieldName]?.typeName ?? fieldName,
    enumName: discriminatorField.enumName,
    variantName: (variantKey: string) => baseOf(variantKey).model.name,
  };
  for (const refusal of decision.fieldRefusals) {
    input.diagnostics.push({
      code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
      message: describeDiscriminatorRefusal(refusal, subject),
      ...declaration.source.at(declaration.span),
    });
  }
  if (decision.fieldRefusals.length > 0) return undefined;
  for (const refusal of decision.variantRefusals) {
    const base = baseOf(refusal.key);
    input.diagnostics.push({
      ...(refusal.kind === 'unreadable'
        ? refusal.refusal
        : {
            code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
            message: describeDiscriminatorRefusal(refusal, subject),
          }),
      ...base.source.at(base.written.span),
    });
  }
  return decision.values;
}

/** A `@@base` value as it is written; the grammar reads only a quoted string there. */
function writtenBaseValue(base: PendingBaseDeclaration): WrittenValue {
  if (base.written.written === undefined) {
    throw new InternalError('A @@base value is a quoted string, never a tagged literal.');
  }
  return base.written.written;
}

function modelLabel(namespaceId: string, modelName: string, qualified: boolean): string {
  return qualified ? `${namespaceId}.${modelName}` : modelName;
}

/** What `@@discriminator` and `@@base` declare, by model key, as the build writes it into the domain models and the storage. */
type ResolvedPolymorphism = {
  readonly discriminators: ReadonlyMap<
    string,
    {
      readonly discriminator: ContractDiscriminator;
      readonly variants: Record<string, CrossReference>;
    }
  >;
  readonly bases: ReadonlyMap<string, CrossReference>;
};

/**
 * Pairs each `@@discriminator` with the variants that declare `@@base` on it, before the build, so the build writes the discriminator's value set before it computes the storage hash (ADR 309). Reports a model with both attributes, a discriminator no variant names, a duplicate value, and a base with no discriminator.
 */
function resolveVariants(
  modelKeys: ReadonlySet<string>,
  discriminatorDeclarations: Map<string, DiscriminatorDeclaration>,
  baseDeclarations: Map<string, BaseDeclaration>,
  reported: ReportedPolymorphism,
  diagnostics: PslDiagnosticCollector,
): ResolvedPolymorphism {
  const discriminators = new Map<
    string,
    {
      readonly discriminator: ContractDiscriminator;
      readonly variants: Record<string, CrossReference>;
    }
  >();
  for (const [modelKey, decl] of discriminatorDeclarations) {
    const modelName = decl.model.name;
    if (baseDeclarations.has(modelKey)) {
      diagnostics.push({
        code: 'PSL_DISCRIMINATOR_AND_BASE',
        message: `Model "${modelName}" cannot have both @@discriminator and @@base`,
        ...decl.source.at(decl.span),
      });
      continue;
    }
    if (!modelKeys.has(modelKey)) continue;

    const variants: Record<string, CrossReference> = {};
    for (const baseDecl of baseDeclarations.values()) {
      if (baseDecl.base.key !== modelKey || baseDecl.value === undefined) continue;
      const variantName = baseDecl.model.name;
      const existingVariant = variants[baseDecl.value];
      if (existingVariant) {
        const qualified =
          existingVariant.namespace !== baseDecl.base.namespaceId ||
          baseDecl.namespaceId !== baseDecl.base.namespaceId;
        diagnostics.push({
          code: 'PSL_DUPLICATE_DISCRIMINATOR_VALUE',
          message: `Discriminator value "${baseDecl.value}" is used by both "${modelLabel(existingVariant.namespace, existingVariant.model, qualified)}" and "${modelLabel(baseDecl.namespaceId, variantName, qualified)}" on base model "${modelLabel(baseDecl.base.namespaceId, modelName, qualified)}"`,
          ...baseDecl.source.at(baseDecl.span),
        });
        continue;
      }
      variants[baseDecl.value] = crossRef(variantName, baseDecl.namespaceId);
    }

    if (Object.keys(variants).length === 0) {
      const alreadyReported = [...baseDeclarations.values()].some(
        (baseDecl) => baseDecl.base.key === modelKey && baseDecl.value === undefined,
      );
      if (alreadyReported) continue;
      diagnostics.push({
        code: 'PSL_ORPHANED_DISCRIMINATOR',
        message: `Model "${modelName}" has @@discriminator but no variant models declare @@base(${modelName}, ...)`,
        ...decl.source.at(decl.span),
      });
      continue;
    }
    discriminators.set(modelKey, { discriminator: { field: decl.fieldName }, variants });
  }

  const bases = new Map<string, CrossReference>();
  for (const [variantKey, baseDecl] of baseDeclarations) {
    if (!discriminatorDeclarations.has(baseDecl.base.key)) {
      if (reported.discriminators.has(baseDecl.base.key)) continue;
      const qualified = baseDecl.namespaceId !== baseDecl.base.namespaceId;
      const variantLabel = modelLabel(baseDecl.namespaceId, baseDecl.model.name, qualified);
      const baseLabel = modelLabel(baseDecl.base.namespaceId, baseDecl.base.model.name, qualified);
      diagnostics.push({
        code: 'PSL_ORPHANED_BASE',
        message: `Model "${variantLabel}" declares @@base(${baseLabel}, ...) but "${baseLabel}" has no @@discriminator`,
        ...baseDecl.source.at(baseDecl.span),
      });
      continue;
    }
    if (discriminatorDeclarations.has(variantKey) || !modelKeys.has(variantKey)) continue;
    bases.set(variantKey, crossRef(baseDecl.base.model.name, baseDecl.base.namespaceId));
  }
  return { discriminators, bases };
}

/** The model nodes with the discriminator, variants and base the build writes. */
function withPolymorphism(
  modelNodes: readonly ModelNode[],
  polymorphism: ResolvedPolymorphism,
  defaultNamespaceId: string,
): ModelNode[] {
  return modelNodes.map((node) => {
    const key = modelCoordinateKey(node.namespaceId ?? defaultNamespaceId, node.modelName);
    const discriminator = polymorphism.discriminators.get(key);
    const base = polymorphism.bases.get(key);
    return {
      ...node,
      ...(discriminator ?? {}),
      ...ifDefined('base', base),
    };
  });
}

/**
 * Points each variant without `@@map` at its base table, and strips from the domain the columns a variant's or a base's model only stores: STI columns on the base, and the link column of an MTI variant. The discriminator, the variants and the base are written by the build.
 */
function resolveVariantStorage(
  models: Record<string, ContractModel>,
  physicalNames: ReadonlyMap<ModelSymbol | FieldSymbol, string>,
  baseDeclarations: Map<string, BaseDeclaration>,
  polymorphism: ResolvedPolymorphism,
  syntheticPkFieldsByVariant: ReadonlyMap<string, readonly string[]>,
  stiBaseFieldsByBase: ReadonlyMap<string, readonly string[]>,
): Record<string, ContractModel> {
  let patched = models;

  for (const [baseKey, fieldNames] of stiBaseFieldsByBase) {
    const baseModel = patched[baseKey];
    if (!baseModel || fieldNames.length === 0) continue;
    patched = {
      ...patched,
      [baseKey]: stripStorageOnlyDomainFields(baseModel, fieldNames),
    };
  }

  for (const variantKey of polymorphism.bases.keys()) {
    const baseDecl = baseDeclarations.get(variantKey);
    const variantModel = patched[variantKey];
    if (!baseDecl || !variantModel) continue;

    const hasExplicitMap = getAttribute(baseDecl.model.attributes, 'map') !== undefined;
    const resolvedTable = storageName(
      hasExplicitMap ? baseDecl.model : baseDecl.base.model,
      physicalNames,
    );

    const patchedVariant: ContractModel = {
      ...variantModel,
      ...(resolvedTable ? { storage: { ...variantModel.storage, table: resolvedTable } } : {}),
    };

    patched = {
      ...patched,
      [variantKey]: stripStorageOnlyDomainFields(
        patchedVariant,
        syntheticPkFieldsByVariant.get(variantKey) ?? [],
      ),
    };
  }

  return patched;
}

/**
 * Multi-table-inheritance variants (`@@base` + their own `@@map`) live in a
 * separate table from their base. The ORM joins that table to the base on the
 * shared primary key (`base.id = variant.id`), so the variant storage table
 * must carry the base PK column even though the variant domain model declares
 * only its own fields. This enriches each MTI variant's `ModelNode` with that
 * link column, a primary key on it, and a FK back to the base table.
 *
 * The link column is reported back per variant in `syntheticPkFieldsByVariant`
 * so the domain-model patch can drop it again — keeping the variant's domain
 * surface thin (its create/read inputs don't gain a redundant `id`) while the
 * storage table stays joinable. Single-table-inheritance variants (no own
 * table) are left untouched.
 */
function materializeMtiVariantStorageLinks(
  modelNodes: readonly ModelNode[],
  baseDeclarations: ReadonlyMap<string, BaseDeclaration>,
  stiVariantKeys: ReadonlySet<string>,
  defaultNamespaceId: string,
): { modelNodes: ModelNode[]; syntheticPkFieldsByVariant: Map<string, readonly string[]> } {
  const keyOf = (node: ModelNode) =>
    modelCoordinateKey(node.namespaceId ?? defaultNamespaceId, node.modelName);
  const nodeByModel = new Map(modelNodes.map((node) => [keyOf(node), node]));
  const syntheticPkFieldsByVariant = new Map<string, readonly string[]>();

  const enriched = modelNodes.map((node): ModelNode => {
    const variantKey = keyOf(node);
    const baseDecl = baseDeclarations.get(variantKey);
    if (!baseDecl) return node;
    const baseNode = nodeByModel.get(baseDecl.base.key);
    if (!baseNode) return node;
    // Single-table inheritance (no own `@@map`) shares the base table; it gets
    // its columns materialised onto the base instead (see
    // {@link materializeStiVariantStorageColumns}), never a link column.
    if (stiVariantKeys.has(variantKey)) return node;
    const basePrimaryKey = baseNode.id;
    if (!basePrimaryKey || basePrimaryKey.columns.length === 0) return node;

    const existingColumns = new Set(node.fields.map((field) => field.columnName));
    const linkFields: FieldNode[] = [];
    for (const pkColumn of basePrimaryKey.columns) {
      if (existingColumns.has(pkColumn)) continue;
      const baseField = baseNode.fields.find((field) => field.columnName === pkColumn);
      if (!baseField) continue;
      linkFields.push({
        fieldName: baseField.fieldName,
        columnName: pkColumn,
        descriptor: baseField.descriptor,
        nullable: false,
        many: false,
      });
    }
    if (linkFields.length === 0) return node;

    syntheticPkFieldsByVariant.set(
      variantKey,
      linkFields.map((field) => field.fieldName),
    );

    const foreignKey: ForeignKeyNode = {
      columns: basePrimaryKey.columns,
      references: {
        model: baseNode.modelName,
        table: baseNode.tableName,
        columns: basePrimaryKey.columns,
        ...ifDefined('namespaceId', baseNode.namespaceId),
      },
      constraint: true,
      // Deleting a base row must delete its variant extension row — classic
      // multi-table-inheritance semantics.
      onDelete: 'cascade',
    };

    return {
      ...node,
      fields: [...linkFields, ...node.fields],
      id: { columns: basePrimaryKey.columns },
      foreignKeys: [...(node.foreignKeys ?? []), foreignKey],
    };
  });

  return { modelNodes: enriched, syntheticPkFieldsByVariant };
}

/**
 * Single-table-inheritance variants (`@@base` with no own `@@map`) share the
 * base table: `resolvePolymorphism` points the variant's `storage.table` at the
 * base, and the ORM reads variant-declared fields straight off the base table.
 * For that to validate and round-trip, the base storage table must physically
 * carry every STI variant's declared columns. This enriches the base
 * `ModelNode` with those columns.
 *
 * The materialised columns are always nullable in storage: the base table hosts
 * every variant's rows, so a column a variant declares as required is still
 * NULL on sibling-variant rows. The variant's domain field keeps its declared
 * nullability — required-in-domain / nullable-in-storage is the intended STI
 * shape.
 *
 * Collisions (two variants declaring the same column, or a variant column name
 * clashing with a base column) are resolved skip-if-exists here, mirroring the
 * MTI link guard; surfacing them as diagnostics is tracked separately
 * (TML-2827).
 */
function materializeStiVariantStorageColumns(
  modelNodes: readonly ModelNode[],
  baseDeclarations: ReadonlyMap<string, BaseDeclaration>,
  stiVariantKeys: ReadonlySet<string>,
  defaultNamespaceId: string,
): { modelNodes: ModelNode[]; stiBaseFieldsByBase: Map<string, readonly string[]> } {
  if (stiVariantKeys.size === 0) {
    return { modelNodes: [...modelNodes], stiBaseFieldsByBase: new Map() };
  }

  const keyOf = (node: ModelNode) =>
    modelCoordinateKey(node.namespaceId ?? defaultNamespaceId, node.modelName);
  const nodeByModel = new Map(modelNodes.map((node) => [keyOf(node), node]));
  type StiColumn = ModelNode['fields'][number];
  const stiColumnsByBase = new Map<string, StiColumn[]>();

  for (const variantKey of stiVariantKeys) {
    const variantNode = nodeByModel.get(variantKey);
    const baseDecl = baseDeclarations.get(variantKey);
    if (!variantNode || !baseDecl) continue;
    const baseNode = nodeByModel.get(baseDecl.base.key);
    if (!baseNode) continue;

    const baseColumns = new Set(baseNode.fields.map((field) => field.columnName));
    const claimed = stiColumnsByBase.get(baseDecl.base.key) ?? [];
    const claimedColumns = new Set(claimed.map((field) => field.columnName));

    for (const field of variantNode.fields) {
      if (baseColumns.has(field.columnName) || claimedColumns.has(field.columnName)) {
        continue;
      }
      claimedColumns.add(field.columnName);
      claimed.push({ ...field, nullable: true });
    }
    stiColumnsByBase.set(baseDecl.base.key, claimed);
  }

  // The materialised columns exist on the base STORAGE table so the variants'
  // `storage.fields` resolve, but they are NOT base DOMAIN fields — `severity`
  // belongs to `Bug`, not to `Task`. Report the materialised field names per
  // base so the domain patch can strip them from the base model (the table
  // column stays); this is the STI analogue of `syntheticPkFieldsByVariant`.
  const stiBaseFieldsByBase = new Map<string, readonly string[]>();
  for (const [baseName, columns] of stiColumnsByBase) {
    stiBaseFieldsByBase.set(
      baseName,
      columns.map((field) => field.fieldName),
    );
  }

  const enriched = modelNodes.map((node): ModelNode => {
    // STI variant: contributes a domain model but no storage table of its own.
    if (stiVariantKeys.has(keyOf(node))) {
      return { ...node, sharesBaseTable: true };
    }
    const stiColumns = stiColumnsByBase.get(keyOf(node));
    if (!stiColumns || stiColumns.length === 0) return node;
    return { ...node, fields: [...node.fields, ...stiColumns] };
  });

  return { modelNodes: enriched, stiBaseFieldsByBase };
}

/**
 * Drop the storage-only link fields (added by
 * {@link materializeMtiVariantStorageLinks}) from a variant's domain model, so
 * the domain surface stays thin while the storage table keeps the link column.
 */
function stripStorageOnlyDomainFields(
  model: ContractModel,
  fieldNames: readonly string[],
): ContractModel {
  if (fieldNames.length === 0) return model;
  const fields = { ...model.fields };
  for (const name of fieldNames) delete fields[name];
  const storage = blindCast<
    SqlModelStorage,
    'SQL interpreter domain models always carry SqlModelStorage'
  >(model.storage);
  const storageFields = { ...storage.fields };
  for (const name of fieldNames) delete storageFields[name];
  return { ...model, fields, storage: { ...storage, fields: storageFields } };
}

function backrelationTargetSymbol(field: FieldSymbol, binder: Binder): ModelSymbol | undefined {
  const typeReference = typeReferenceNode(field);
  if (typeReference === undefined) return undefined;
  const resolution = binder.symbolForNode(typeReference);
  return resolution?.kind === 'model' ? resolution.symbol : undefined;
}

function relationTargetKindLabel(resolution: Resolution): string | undefined {
  switch (resolution.kind) {
    case 'compositeType':
      return 'composite type';
    case 'namedType':
      return 'type alias';
    case 'block':
      return resolution.symbol.keyword;
    case 'namespace':
    case 'contributedNamespace':
      return 'namespace';
    case 'contributedType':
      return 'type';
    default:
      return undefined;
  }
}

/**
 * The relation a refusal of `index: "<name>"` belongs to, and the message to report there; `undefined` for every other error.
 */
function relationIndexRefusal(
  error: unknown,
  locations: readonly RelationIndexLocation[],
): { readonly at: RelationIndexLocation; readonly message: string } | undefined {
  if (!isStructuredError(error) || error.meta?.['reason'] !== FOREIGN_KEY_INDEX_UNRESOLVED) {
    return undefined;
  }
  const { namespaceId, tableName, columns, index } = error.meta ?? {};
  const at = locations.find(
    (candidate) =>
      candidate.namespaceId === namespaceId &&
      candidate.tableName === tableName &&
      candidate.index === index &&
      Array.isArray(columns) &&
      candidate.columns.length === columns.length &&
      candidate.columns.every((column, position) => column === columns[position]),
  );
  if (at === undefined) return undefined;
  return { at, message: error.fix === undefined ? error.message : `${error.message} ${error.fix}` };
}

export function interpretPslDocumentToSqlContract(
  input: InterpretPslDocumentToSqlContractInput,
): Result<Contract, ContractSourceDiagnostics> {
  if (!input.target) {
    throw new InternalError(
      'PSL interpretation requires an explicit target context from composition.',
    );
  }
  if (!input.scalarColumnDescriptors) {
    throw new InternalError('PSL interpretation requires composed scalar type descriptors.');
  }
  const [anchorDocument] = input.documents;
  assertDefined(anchorDocument, 'interpretPslDocumentToSqlContract requires at least one document');
  const source = diagnosticSource(input.sources, anchorDocument.syntax);
  const diagnostics = createPslDiagnosticCollector(input.sources);
  const modelAttributesByName = buildModelAttributesByName(input.authoringContributions);
  const contributedModelSpecs = modelAttributeSpecsFrom(modelAttributesByName);
  const composedPslBlockDescriptors = input.authoringContributions?.pslBlockDescriptors ?? {};
  const { binder, dataTypes } = input;
  const defaultFunctionRegistry: ControlMutationDefaultRegistry =
    input.controlMutationDefaults?.defaultFunctionRegistry ?? new Map();
  const { generatorFunctions } = input;
  const specContextFor = (model: ModelSymbol) =>
    modelSpecContext({
      symbols: input.symbolTable,
      model,
      defaultFunctionRegistry,
      generatorFunctions,
      dataTypes,
    });

  const namespaceSymbols = Object.values(input.symbolTable.namespaces);
  validateNamespaceBlocksForSqlTarget({
    namespaces: namespaceSymbols,
    target: input.target,
    source,
    sources: input.sources,
    binder,
    diagnostics,
  });
  const { parsedBlocks, diagnostics: blockDiagnostics } = interpretExtensionBlocks({
    symbolTable: input.symbolTable,
    sources: input.sources,
    pslBlockDescriptors: composedPslBlockDescriptors,
    binder,
    dataTypes,
  });
  diagnostics.push(...blockDiagnostics);
  validateBlockModelAttributeRequirements({
    parsedBlocks,
    pslBlockDescriptors: composedPslBlockDescriptors,
    sources: input.sources,
    diagnostics,
  });
  const models: ModelSymbol[] = [];
  const modelEntries: ModelNamespaceEntry[] = [];
  const compositeTypes: CompositeTypeSymbol[] = [];
  const compositeTypeNamespaces = new Map<string, string>();

  for (const namespace of namespaceSymbols) {
    for (const model of Object.values(namespace.models)) {
      models.push(model);
      modelEntries.push({ model, namespaceId: namespace.id });
    }
    for (const compositeType of Object.values(namespace.compositeTypes)) {
      const firstNamespaceId = compositeTypeNamespaces.get(compositeType.name);
      if (firstNamespaceId !== undefined) {
        diagnostics.push({
          code: 'PSL_DUPLICATE_DECLARATION',
          message: `Composite type "${compositeType.name}" is declared in namespace "${firstNamespaceId}" and in namespace "${namespace.id}". Every composite type is stored in the default storage namespace, so composite type names must differ across namespaces. Rename one of them.`,
          ...diagnosticSource(input.sources, compositeType.node.syntax).at(),
        });
        continue;
      }
      compositeTypeNamespaces.set(compositeType.name, namespace.id);
      compositeTypes.push(compositeType);
    }
  }
  const physicalNames = new Map<ModelSymbol | FieldSymbol, string>();
  for (const model of models) {
    const mapNode = getAttribute(model.attributes, 'map')?.node;
    const mapped =
      mapNode === undefined
        ? undefined
        : interpretModelAttribute({
            node: mapNode,
            symbols: input.symbolTable,
            spec: sqlAttributeSpecs.model.map(specContextFor(model)),
            model,
            sources: input.sources,
            binder,
            diagnostics,
          });
    physicalNames.set(model, mapped?.name ?? defaultTableName(model.name));
    for (const field of Object.values(model.fields)) {
      const mapNode = getAttribute(field.attributes, 'map')?.node;
      const mapped =
        mapNode === undefined
          ? undefined
          : interpretFieldAttribute({
              node: mapNode,
              symbols: input.symbolTable,
              spec: sqlAttributeSpecs.field.map(
                fieldSpecContext({ ...specContextFor(model), field, binder }),
              ),
              model,
              field,
              sources: input.sources,
              binder,
              diagnostics,
            });
      physicalNames.set(field, mapped?.name ?? field.name);
    }
  }
  const defaultNamespaceId = input.symbolTable.defaultNamespace.id;

  const composedExtensions = new Set(input.composedExtensions ?? []);
  const composedExtensionContracts: ReadonlyMap<string, Contract> =
    input.composedExtensionContracts;

  const isEnumBlock = (block: BlockSymbol): boolean => block.keyword === 'enum';
  const legitimateBlockKeywords = claimedBlockKeywords(
    input.authoringContributions?.pslBlockDescriptors,
  );
  const reportUnsupportedTopLevelBlock = (block: BlockSymbol): void => {
    diagnostics.push(unsupportedBlockDiagnostic(block, input.sources));
  };

  const topLevelEnums: BlockSymbol[] = [];
  const extensionBlocksByNamespace = new Map<NamespaceSymbol, Record<string, BlockSymbol>>();
  for (const namespace of namespaceSymbols) {
    const extensionBlocks: Record<string, BlockSymbol> = {};
    extensionBlocksByNamespace.set(namespace, extensionBlocks);
    for (const [blockName, block] of Object.entries(namespace.blocks)) {
      const writtenNamespace = block.node.syntax.findAncestor(NamespaceDeclarationAst.cast);
      if (writtenNamespace === undefined) {
        if (!legitimateBlockKeywords.has(block.keyword)) {
          reportUnsupportedTopLevelBlock(block);
        } else if (isEnumBlock(block)) {
          topLevelEnums.push(block);
        } else {
          extensionBlocks[blockName] = block;
        }
        continue;
      }
      extensionBlocks[blockName] = block;
      if (isEnumBlock(block)) {
        diagnostics.push({
          code: 'PSL_ENUM_NAMESPACE_NOT_SUPPORTED',
          message: `enum "${block.name}" inside namespace "${writtenNamespace.name()?.name() ?? namespace.name}" is not supported; declare enum at the top level`,
          ...diagnosticSource(input.sources, block.node.syntax).at(
            nodePslSpan(block.node.syntax, input.sources),
          ),
        });
        continue;
      }
      if (!legitimateBlockKeywords.has(block.keyword)) {
        reportUnsupportedTopLevelBlock(block);
      }
    }
  }

  const enumResult = processEnumDeclarations({
    enumBlocks: topLevelEnums,
    parsedBlocks,
    source,
    authoringContributions: input.authoringContributions,
    entityContext: {
      family: input.target.familyId,
      target: input.target.targetId,
      codecLookup: input.codecLookup,
      dataTypes: input.dataTypes,
      sourceId: source.sources.sourceFileFor(source.node).filename,
      diagnostics: {
        push: (d) => {
          diagnostics.pushExternal(
            blindCast<ContractSourceDiagnostic, 'sink diagnostics are span-compatible'>(d),
          );
        },
      },
      ...ifDefined('enumInferenceCodecs', input.enumInferenceCodecs),
    },
    diagnostics,
  });

  const allEnumTypeDescriptors = enumResult.enumTypeDescriptors;
  const enumHandles = enumResult.enumHandles;
  const validEnumHandles: Record<string, EnumTypeHandle> = Object.fromEntries(
    Array.from(enumHandles, ([symbol, handle]) => [symbol.name, handle]),
  );

  // Generic extension-block lowering pass: per namespace, lower all parsed extension
  // blocks into IR entities via the registered factory for each block's
  // discriminator, then collect by entrySlotName. The pass names no specific
  // discriminator value — all target-specific logic lives in the factory
  // contributed by the target pack, and value-set derivation rides the
  // generic `deriveValueSet` descriptor hook (see
  // `lowerExtensionBlocksForNamespace`).
  //
  // This runs before model/field resolution (not just before contract
  // assembly) so that a field-type resolver contributed by a target pack
  // (e.g. Postgres's `pg.enum(Ref)`) can resolve `Ref` against an
  // already-lowered extension entity — see `namespaceExtensionEntities`
  // threaded into `collectResolvedFields` below.
  const entityTypesByDiscriminator = buildEntityTypesByDiscriminator(input.authoringContributions);
  // Warnings pushed by entity factories run ahead of
  // `buildSqlContractFromDefinition`; handed to the build via the definition
  // so its one per-build flush covers the whole build.
  const authoringWarnings: AuthoringWarning[] = [];
  const extensionEntityContext: AuthoringEntityContext = {
    family: input.target.familyId,
    target: input.target.targetId,
    ...ifDefined('enumInferenceCodecs', input.enumInferenceCodecs),
    codecLookup: input.codecLookup,
    dataTypes: input.dataTypes,
    sourceId: source.sources.sourceFileFor(source.node).filename,
    diagnostics: {
      push: (d) => {
        diagnostics.pushExternal(
          blindCast<ContractSourceDiagnostic, 'sink diagnostics are span-compatible'>(d),
        );
      },
    },
    warnings: authoringWarnings,
  };
  const namespaceIdByModel = new Map(
    modelEntries.map(({ model, namespaceId }) => [model, namespaceId]),
  );
  const modelCoordinateOf = (model: ModelSymbol) => {
    const namespaceId = namespaceIdByModel.get(model);
    return namespaceId === undefined
      ? undefined
      : { namespaceId, tableName: storageName(model, physicalNames) };
  };
  const namespaceExtensionEntities = new Map<string, Record<string, Record<string, unknown>>>();
  const fileExtensionEntityRows = (
    rows: readonly LoweredPackEntity[],
    blocks: Readonly<Record<string, BlockSymbol>>,
  ): void => {
    for (const row of rows) {
      let entities = namespaceExtensionEntities.get(row.namespaceId);
      if (entities === undefined) {
        entities = {};
        namespaceExtensionEntities.set(row.namespaceId, entities);
      }
      const slot = entities[row.entityKind] ?? {};
      entities[row.entityKind] = slot;
      if (Object.hasOwn(slot, row.key)) {
        const block = Object.values(blocks).find((candidate) => candidate.name === row.key);
        invariant(block !== undefined, 'Lowered entity has an owning block');
        diagnostics.pushUnlocated({
          code: 'PSL_DUPLICATE_EXTENSION_ENTITY',
          message: `entries slot "${row.entityKind}" in namespace "${row.namespaceId}": entity "${row.key}" is declared more than once in the same namespace.`,
          ...diagnosticSource(input.sources, block.node.syntax).at(),
        });
        continue;
      }
      slot[row.key] = row.entity;
    }
  };
  for (const [namespace, extensionBlocks] of extensionBlocksByNamespace) {
    fileExtensionEntityRows(
      lowerExtensionBlocksForNamespace(
        extensionBlocks,
        namespace.id,
        entityTypesByDiscriminator,
        extensionEntityContext,
        parsedBlocks,
        modelCoordinateOf,
        input.sources,
      ),
      extensionBlocks,
    );
  }

  // A domain `enum` and an extension-derived value-set (e.g. from a
  // `native_enum`) that share a name in one namespace would both target the
  // same `entries.valueSet[name]` slot — the merge below would otherwise let
  // the extension one silently overwrite the domain one. Domain enums always
  // register under `defaultNamespaceId` (see `build-contract.ts`), so a
  // collision can only occur there. Flag it rather than resolve it silently.
  const defaultNsExtensionValueSets =
    namespaceExtensionEntities.get(defaultNamespaceId)?.['valueSet'];
  if (defaultNsExtensionValueSets !== undefined) {
    for (const name of Object.keys(defaultNsExtensionValueSets)) {
      if (Object.hasOwn(validEnumHandles, name)) {
        const enumSymbol = input.symbolTable.defaultNamespace.blocks[name];
        invariant(enumSymbol !== undefined, 'Domain enum has an owning block');
        diagnostics.pushUnlocated({
          code: 'PSL_VALUE_SET_NAME_COLLISION',
          message: `namespace "${defaultNamespaceId}": name "${name}" is declared both as a domain enum and as an extension entity that derives a value-set; rename one`,
          ...diagnosticSource(input.sources, enumSymbol.node.syntax).at(),
        });
      }
    }
  }

  // No checkpoint here: this pass runs early so `namespaceExtensionEntities` is
  // ready for field resolution. The checkpoint after field resolution catches
  // this pass's failures too.

  const typeAliases = resolveNamedTypeDeclarations({
    declarations: Object.values(input.symbolTable.namedTypes),
    sources: input.sources,
    symbolTable: input.symbolTable,
    binder,
    enumTypeDescriptors: allEnumTypeDescriptors,
    enumHandles,
    codecLookup: input.codecLookup,
    defaultFunctionRegistry,
    generatorFunctions,
    dataTypes,
    diagnostics,
    authoringTypes: input.authoringContributions?.type,
  });

  const modelNodes = new Map<ModelSymbol, ModelNode>();
  const fkRelationMetadata: FkRelationMetadata<ModelSymbol>[] = [];
  const relationIndexLocations: RelationIndexLocation[] = [];
  const invalidFkPairings: InvalidModelFkPairing<ModelSymbol>[] = [];
  const backrelationCandidates: ModelBackrelationCandidate<ModelSymbol>[] = [];
  const crossSpaceRelationsByModel = new Map<ModelSymbol, RelationNode[]>();
  // Entities lowered by contributed model attributes, keyed by namespace id
  // then attribute name then entity key — merged into `entries` alongside
  // `namespaceExtensionEntities` once every model has been processed.
  const modelAttributeEntitiesByNamespace = new Map<
    string,
    Record<string, Record<string, unknown>>
  >();

  const droppedFields = new Set<FieldSymbol>();
  const valueObjects = buildValueObjectNodes({
    compositeTypes,
    droppedFields,
    enumTypeDescriptors: allEnumTypeDescriptors,
    enumHandles,
    typeAliases,
    diagnostics,
    sources: input.sources,
    defaultNamespaceId,
    namespaceExtensionEntities,
    codecLookup: input.codecLookup,
    dataTypes: input.dataTypes,
    binder,
  });
  const valueObjectTypes: ValueObjectTypes = {
    nodes: new Map(valueObjects.map((valueObject) => [valueObject.name, valueObject])),
    declaredMembers: new Map(
      compositeTypes.map((compositeType) => [
        compositeType.name,
        new Set(Object.keys(compositeType.fields)),
      ]),
    ),
  };

  for (const { model, namespaceId } of modelEntries) {
    const result = buildModelNodeFromPsl({
      model,
      droppedFields,
      physicalNames,
      namespaceId,
      valueObjectTypes,
      enumTypeDescriptors: allEnumTypeDescriptors,
      typeAliases,
      composedExtensionContracts,
      familyId: input.target.familyId,
      targetId: input.target.targetId,
      authoringContributions: input.authoringContributions,
      defaultFunctionRegistry,
      generatorFunctions,
      dataTypes,
      scalarColumnDescriptors: input.scalarColumnDescriptors,
      sources: input.sources,
      binder,
      symbolTable: input.symbolTable,
      diagnostics,
      enumHandles,
      capabilities: input.capabilities,
      ...(namespaceExtensionEntities.size > 0 ? { namespaceExtensionEntities } : {}),
      codecLookup: input.codecLookup,
      modelAttributesByName,
      contributedModelAttributeSpecs: contributedModelSpecs,
      parsedBlocks,
    });
    modelNodes.set(model, { ...result.modelNode, namespaceId });
    fkRelationMetadata.push(...result.fkRelationMetadata);
    relationIndexLocations.push(...result.relationIndexLocations);
    invalidFkPairings.push(...result.invalidFkPairings);
    backrelationCandidates.push(...result.backrelationCandidates);
    if (result.crossSpaceRelations.length > 0) {
      const existing = crossSpaceRelationsByModel.get(model) ?? [];
      crossSpaceRelationsByModel.set(model, [...existing, ...result.crossSpaceRelations]);
    }
    if (Object.keys(result.modelAttributeEntities).length > 0) {
      const existingByAttribute = modelAttributeEntitiesByNamespace.get(namespaceId) ?? {};
      for (const [attribute, keyed] of Object.entries(result.modelAttributeEntities)) {
        existingByAttribute[attribute] = { ...(existingByAttribute[attribute] ?? {}), ...keyed };
      }
      modelAttributeEntitiesByNamespace.set(namespaceId, existingByAttribute);
    }
  }

  const { modelRelations, fkRelationsByPair, fkRelationsByDeclaringModel } = indexFkRelations({
    fkRelationMetadata,
  });
  const modelIdColumns = new Map<ModelSymbol, readonly string[]>();
  const modelUniqueColumnSets = new Map<ModelSymbol, readonly (readonly string[])[]>();
  for (const [model, modelNode] of modelNodes) {
    if (modelNode.id) {
      modelIdColumns.set(model, modelNode.id.columns);
    }
    const uniqueColumnSets: (readonly string[])[] = [];
    if (modelNode.id) {
      uniqueColumnSets.push(modelNode.id.columns);
    }
    for (const unique of modelNode.uniques ?? []) {
      uniqueColumnSets.push(unique.columns);
    }
    // A unique index constrains its columns exactly as a unique constraint
    // does, so a singular back-relation over those columns is just as sound.
    for (const index of modelNode.indexes ?? []) {
      if (index.unique === true && index.columns !== undefined && index.where === undefined) {
        uniqueColumnSets.push(index.columns);
      }
    }
    modelUniqueColumnSets.set(model, uniqueColumnSets);
  }
  applyBackrelationCandidates({
    backrelationCandidates,
    fkRelationsByPair,
    invalidFkPairings,
    fkRelationsByDeclaringModel,
    modelIdColumns,
    modelUniqueColumnSets,
    modelRelations,
    diagnostics,
    sources: input.sources,
  });

  // Merge cross-space relations into modelRelations after local back-relation matching.
  // Cross-space targets have no local back-relation candidates, so they bypass that step.
  for (const [modelName, relations] of crossSpaceRelationsByModel) {
    const existing = modelRelations.get(modelName);
    if (existing) {
      existing.push(...relations);
    } else {
      modelRelations.set(modelName, [...relations]);
    }
  }

  const modelIdentities = new Map<ModelSymbol, ModelIdentity>(
    modelEntries.map(({ model, namespaceId }) => [
      model,
      { model, namespaceId, key: modelCoordinateKey(namespaceId, model.name) },
    ]),
  );
  const discriminatorFieldOf: DiscriminatorFieldOf = (model, fieldName) => {
    const field = modelNodes.get(model)?.fields.find((node) => node.fieldName === fieldName);
    if (field === undefined || !('columnName' in field)) {
      return {
        field: { ref: undefined, nullable: false, many: false, enumMembers: undefined },
        enumName: undefined,
      };
    }
    const handle = 'enumTypeHandle' in field ? field.enumTypeHandle : undefined;
    const encoded = handle === undefined ? undefined : encodeEnumMembers(handle, input.codecLookup);
    return {
      field: {
        ref: {
          codecId: field.descriptor.codecId,
          ...ifDefined(
            'typeParams',
            field.descriptor.typeParams === undefined
              ? undefined
              : blindCast<JsonValue, 'type parameters are read from PSL and checked by the codec'>(
                  field.descriptor.typeParams,
                ),
          ),
        },
        nullable: field.nullable,
        many: field.many === true,
        enumMembers: encoded?.ok ? encoded.value.map(({ value }) => value) : undefined,
      },
      enumName: handle?.enumName,
    };
  };
  const { discriminatorDeclarations, baseDeclarations, reported } = collectPolymorphismDeclarations(
    modelIdentities,
    input.symbolTable,
    input.sources,
    binder,
    specContextFor,
    discriminatorFieldOf,
    input.codecLookup,
    dataTypes,
    diagnostics,
  );

  // A variant with `@@base` but no own `@@map` is single-table inheritance:
  // it shares the base table. (`@@map` ⇒ multi-table inheritance.) This is the
  // authoritative STI/MTI signal — the variant's resolved table name is not,
  // because a no-`@@map` STI variant still gets its own verbatim default table
  // name (`defaultTableName`) that differs from the base before
  // `resolvePolymorphism` rewrites it onto the base table.
  const stiVariantKeys = new Set<string>();
  for (const [variantKey, declaration] of baseDeclarations) {
    const hasExplicitMap = getAttribute(declaration.model.attributes, 'map') !== undefined;
    if (!hasExplicitMap) {
      stiVariantKeys.add(variantKey);
    }
  }

  // An STI variant shares its base model's storage table (see
  // `materializeStiVariantStorageColumns` below) and never gets a table of
  // its own, so a check declared on it has nowhere to attach — silently
  // dropping it at build time would defeat the whole point of `@@check`.
  // Catch it here, while the PSL source still has the `@@check` attribute's
  // span and the base model's name in hand.
  for (const variantKey of stiVariantKeys) {
    const baseDecl = baseDeclarations.get(variantKey);
    invariant(
      baseDecl !== undefined,
      `stiVariantKeys is derived from baseDeclarations.keys(), so "${variantKey}" must have a base declaration`,
    );
    const variantName = baseDecl.model.name;
    if (baseDecl.namespaceId !== baseDecl.base.namespaceId) {
      const variantLabel = modelLabel(baseDecl.namespaceId, variantName, true);
      const baseLabel = modelLabel(baseDecl.base.namespaceId, baseDecl.base.model.name, true);
      diagnostics.push({
        code: 'PSL_BASE_IN_OTHER_NAMESPACE_WITHOUT_MAP',
        message: `Model "${variantLabel}" declares @@base(${baseLabel}, ...) without @@map, so it would share the table of "${baseLabel}", which belongs to namespace "${baseDecl.base.namespaceId}". Add @@map to give "${variantLabel}" its own table.`,
        ...baseDecl.source.at(baseDecl.span),
      });
    }
    for (const attribute of baseDecl.model.attributes) {
      if (attribute.node.name()?.isSimpleName('check') !== true) continue;
      diagnostics.push({
        code: PSL_CHECK_ON_STI_VARIANT,
        message: `Model "${variantName}" declares "@@check", but it shares its base model "${baseDecl.base.model.name}"'s storage table (single-table inheritance via @@base) and has no table of its own to declare a check constraint on. Declare the check on "${baseDecl.base.model.name}" instead.`,
        ...diagnosticSource(input.sources, attribute.node.syntax).at(
          nodePslSpan(attribute.node.syntax, input.sources),
        ),
      });
    }
  }

  const { modelNodes: mtiLinkedModelNodes, syntheticPkFieldsByVariant } =
    materializeMtiVariantStorageLinks(
      Array.from(modelNodes, ([symbol, model]) => ({
        ...model,
        ...(modelRelations.has(symbol)
          ? {
              relations: [...(modelRelations.get(symbol) ?? [])].sort((left, right) =>
                compareStrings(left.fieldName, right.fieldName),
              ),
            }
          : {}),
      })),
      baseDeclarations,
      stiVariantKeys,
      defaultNamespaceId,
    );
  const { modelNodes: stiColumnModelNodes, stiBaseFieldsByBase } =
    materializeStiVariantStorageColumns(
      mtiLinkedModelNodes,
      baseDeclarations,
      stiVariantKeys,
      defaultNamespaceId,
    );

  if (
    diagnostics.length > 0 ||
    (input.seedDiagnostics?.length ?? 0) > 0 ||
    droppedFields.size > 0
  ) {
    return notOk({
      summary: 'PSL to SQL contract interpretation failed',
      diagnostics: [...(input.seedDiagnostics ?? []), ...diagnostics.toExternal()],
    });
  }

  const polyDiagnostics = createPslDiagnosticCollector(input.sources);
  const polymorphism = resolveVariants(
    new Set(
      stiColumnModelNodes.map((node) =>
        modelCoordinateKey(node.namespaceId ?? defaultNamespaceId, node.modelName),
      ),
    ),
    discriminatorDeclarations,
    baseDeclarations,
    reported,
    polyDiagnostics,
  );
  if (polyDiagnostics.length > 0) {
    return notOk({
      summary: 'PSL to SQL contract interpretation failed',
      diagnostics: polyDiagnostics.toExternal(),
    });
  }

  // Merge lowered extension-block entities into each namespace's entries.
  // `valueSet` is unioned rather than overwritten: a namespace may derive
  // value-sets from both a PSL `enum` block and an extension entity, and both
  // must survive (name collisions are already rejected above).
  const { createNamespace } = input;
  const createNamespaceWithExtensions = (nsInput: SqlNamespaceInput) => {
    const entities = namespaceExtensionEntities.get(nsInput.id);
    const attributeEntities = modelAttributeEntitiesByNamespace.get(nsInput.id);
    if (entities === undefined && attributeEntities === undefined) {
      return createNamespace(nsInput);
    }
    // A model-attribute entries slot must not collide with a base slot
    // (`table`, `valueSet`) or a block-produced slot — the merge below spreads
    // `...attributeEntities` last and would otherwise silently shallow-replace
    // it. Fail loud so a pack that files a model attribute under an
    // already-claimed kind name is caught at composition rather than losing
    // data. (`rls` vs `policy`/`role`/`valueSet`/`table` is disjoint today.)
    if (attributeEntities !== undefined) {
      for (const slot of Object.keys(attributeEntities)) {
        if (Object.hasOwn(nsInput.entries, slot) || (entities !== undefined && slot in entities)) {
          throw contractError(
            'CONTRACT.PACK_CONTRIBUTION_INVALID',
            `entries slot "${slot}" in namespace "${nsInput.id}" is contributed by both a model attribute and a block/base entry kind. A model-attribute entries key must be unique across the namespace's entry kinds.`,
            { meta: { slot, namespaceId: nsInput.id } },
          );
        }
      }
    }
    const mergedValueSet = { ...nsInput.entries['valueSet'], ...entities?.['valueSet'] };
    const extended: SqlNamespaceInput = {
      ...nsInput,
      entries: {
        ...nsInput.entries,
        ...entities,
        ...attributeEntities,
        ...(Object.keys(mergedValueSet).length > 0 ? { valueSet: mergedValueSet } : {}),
      },
    };
    return createNamespace(extended);
  };

  let contract: Contract;
  try {
    contract = buildSqlContractFromDefinition(
      {
        target: input.target,
        capabilities: input.capabilities,
        warnings: authoringWarnings.length > 0 ? authoringWarnings : undefined,
        ...ifDefined(
          'extensions',
          buildComposedExtensionPackRefs(
            input.target,
            [...composedExtensions].sort(compareStrings),
            input.composedExtensionPackRefs,
          ),
        ),
        ...(Object.keys(validEnumHandles).length > 0 ? { enums: validEnumHandles } : {}),
        // A namespace that carries extension entities but no models (e.g.
        // `namespace unbound { role anon {} }`) would otherwise never enter
        // `SqlStorage.namespaces` — declare every entity-carrying coordinate;
        // model-derived coordinates dedupe downstream.
        ...(namespaceExtensionEntities.size > 0
          ? { namespaces: [...namespaceExtensionEntities.keys()] }
          : {}),
        createNamespace: createNamespaceWithExtensions,
        ...ifDefined('valueObjects', valueObjects.length > 0 ? valueObjects : undefined),
        models: withPolymorphism(stiColumnModelNodes, polymorphism, defaultNamespaceId),
      },
      input.codecLookup,
      input.dataTypes.lookup,
    );
  } catch (error) {
    const refusal = relationIndexRefusal(error, relationIndexLocations);
    if (refusal === undefined) throw error;
    diagnostics.push({
      code: 'PSL_INVALID_RELATION_ATTRIBUTE',
      message: refusal.message,
      ...refusal.at.location,
    });
    return notOk({
      summary: 'PSL to SQL contract interpretation failed',
      diagnostics: diagnostics.toExternal(),
    });
  }

  // Key by namespace so same bare model names across namespaces stay distinct;
  // same-coordinate duplicates were already collapsed first-wins.
  const modelsByCoordinate: Record<string, ContractModel> = {};
  for (const [namespaceId, namespaceSlice] of Object.entries(contract.domain.namespaces)) {
    for (const [modelName, model] of Object.entries(namespaceSlice.models)) {
      const coordinate = modelCoordinateKey(namespaceId, modelName);
      invariant(
        !Object.hasOwn(modelsByCoordinate, coordinate),
        `symbol table guarantees coordinate uniqueness; duplicate model "${namespaceId}.${modelName}" reached interpretation`,
      );
      modelsByCoordinate[coordinate] = model;
    }
  }

  const polymorphicModels = resolveVariantStorage(
    modelsByCoordinate,
    physicalNames,
    baseDeclarations,
    polymorphism,
    syntheticPkFieldsByVariant,
    stiBaseFieldsByBase,
  );

  const filteredRoots = Object.fromEntries(
    Object.entries(contract.roots).filter(
      ([, crossReference]) =>
        !baseDeclarations.has(modelCoordinateKey(crossReference.namespace, crossReference.model)),
    ),
  );

  const patchedContract: Contract = {
    ...contract,
    roots: filteredRoots,
    domain: {
      namespaces: Object.fromEntries(
        Object.entries(contract.domain.namespaces).map(([namespaceId, namespaceSlice]) => [
          namespaceId,
          {
            models: Object.fromEntries(
              Object.entries(namespaceSlice.models).map(([modelName, model]) => [
                modelName,
                polymorphicModels[modelCoordinateKey(namespaceId, modelName)] ?? model,
              ]),
            ),
            ...ifDefined('enum', namespaceSlice.enum),
          },
        ]),
      ),
    },
  };

  return ok(patchedContract);
}
