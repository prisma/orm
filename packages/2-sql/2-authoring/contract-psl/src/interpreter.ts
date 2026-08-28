import type {
  ContractSourceDiagnostic,
  ContractSourceDiagnosticSpan,
  ContractSourceDiagnostics,
} from '@internal/config/config-types';
import type {
  Contract,
  ContractField,
  ContractModel,
  ContractValueObject,
  ControlPolicy,
} from '@internal/contract/types';
import { crossRef } from '@internal/contract/types';
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
  PslExtensionBlock,
} from '@internal/framework-components/authoring';
import {
  instantiateAuthoringEntityType,
  isAuthoringEntityTypeDescriptor,
  isAuthoringModelAttributeDescriptor,
  isAuthoringPslBlockDescriptor,
} from '@internal/framework-components/authoring';
import type { CodecLookup } from '@internal/framework-components/codec';
import type {
  CapabilityMatrix,
  ExtensionPackRef,
  TargetPackRef,
} from '@internal/framework-components/components';
import type {
  ControlMutationDefaultRegistry,
  ControlMutationDefaults,
  MutationDefaultGeneratorDescriptor,
} from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import {
  type BlockSymbol,
  type CompositeTypeSymbol,
  type FieldSymbol,
  findBlockDescriptor,
  keywordPslSpan,
  type ModelAttributeSpecFactory,
  type ModelSymbol,
  type NamedTypeSymbol,
  type NamespaceSymbol,
  nodePslSpan,
  type ResolvedAttribute,
  type SymbolTable,
} from '@internal/psl-parser';
import type { SourceFile } from '@internal/psl-parser/syntax';
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
  type UniqueConstraintNode,
} from '@internal/sql-contract-ts/contract-builder';
import { invariant } from '@internal/utils/assertions';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { notOk, ok, type Result } from '@internal/utils/result';
import { contractError } from './contract-errors';

import { getAttribute, getNamedArgument, mapFieldNamesToColumns } from './psl-attribute-parsing';
import type { ColumnDescriptor } from './psl-column-resolution';
import {
  checkUncomposedNamespace,
  getAuthoringEntity,
  reportUncomposedNamespace,
  resolveFieldTypeDescriptor,
} from './psl-column-resolution';
import {
  buildModelMappings,
  collectResolvedFields,
  type ModelNameMapping,
  type ModelNamespaceEntry,
  modelCoordinateKey,
  type ResolvedField,
} from './psl-field-resolution';
import { resolveNamedTypeDeclarations } from './psl-named-type-resolution';
import {
  applyBackrelationCandidates,
  type FkRelationMetadata,
  indexFkRelations,
  interpretRelationAttribute,
  type ModelBackrelationCandidate,
  normalizeReferentialAction,
  validateBackrelationFieldAttributes,
} from './psl-relation-resolution';
import {
  baseModelSpec,
  checkModelSpec,
  controlModelSpec,
  discriminatorModelSpec,
  findModelAttributeNode,
  idModelSpec,
  indexModelSpec,
  interpretModelAttribute,
  PSL_CHECK_ON_STI_VARIANT,
  uniqueModelSpec,
} from './sql-attribute-specs';

export interface InterpretPslDocumentToSqlContractInput {
  readonly symbolTable: SymbolTable;
  readonly sourceFile: SourceFile;
  readonly sourceId: string;
  readonly target: TargetPackRef<'sql', string>;
  readonly scalarColumnDescriptors: ReadonlyMap<string, ColumnDescriptor>;
  readonly composedExtensions?: readonly string[];
  readonly composedExtensionPackRefs?: readonly ExtensionPackRef<'sql', string>[];
  readonly controlMutationDefaults?: ControlMutationDefaults;
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
  readonly codecLookup?: CodecLookup;
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

function compareStrings(left: string, right: string): -1 | 0 | 1 {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

/**
 * Name of the framework-parser synthesised bucket for top-level
 * declarations. Re-declared here so the per-target dispatch does not
 * have to import from `@internal/framework-components/psl-ast`
 * (which would cross a layer that the interpreter does not otherwise
 * import from). The value is part of the framework parser's contract;
 * if it changes there, the matching test in this package's
 * `interpreter.diagnostics.test.ts` flips first.
 */
const UNSPECIFIED_PSL_NAMESPACE_NAME = '__unspecified__';

/**
 * Per-target namespace-block validation: walk the AST's namespace buckets and
 * emit diagnostics for syntactic constructs the target does not accept.
 *
 * - **SQLite** has no schema concept and rejects every explicit
 *   `namespace { … }` block. The implicit `__unspecified__` bucket
 *   (produced by the parser for top-level declarations outside any
 *   block) is the only namespace SQLite accepts.
 * - **Postgres** accepts every explicit block — `namespace unbound { … }`
 *   is the late-binding opt-in (lowers to the IR `__unbound__` slot in
 *   a follow-on commit), `namespace public { … }` reopen-merges with
 *   the implicit bucket, and any other name lowers to a named schema.
 *
 * Storage-side lowering of these buckets to IR namespace slots is not
 * yet wired; this helper closes only the diagnostic surface.
 */
/**
 * Per-target namespace lowering: map a PSL AST namespace bucket name to the
 * resolved IR namespace id (the key downstream consumers use against
 * `SqlStorage.namespaces`).
 *
 * - **Postgres**: an explicit `namespace unbound { … }` block lowers
 *   to the framework sentinel `__unbound__` — the slot whose binding
 *   the connection's `search_path` resolves at runtime. Every other
 *   explicit bucket name (e.g. `auth`, `public`) passes through as a
 *   named schema id. The implicit `__unspecified__` bucket — top-level
 *   declarations outside any `namespace { … }` block — leaves the
 *   coordinate unset; downstream consumers treat unset as the
 *   late-bound default, and TS / PSL authoring stay byte-identical
 *   on single-namespace contracts. (A future round will add a
 *   target-default-namespace surface so `__unspecified__` lowers to
 *   `public` consistently on both authoring paths.)
 * - **SQLite**: SQLite has no schema concept; every namespace
 *   collapses to the late-bound default. The namespace-block
 *   validation step (above) has already rejected any explicit
 *   `namespace { … }` block on SQLite, so the only bucket the
 *   lowering ever sees there is `__unspecified__`.
 *
 * Returns `undefined` for targets / bucket names with no explicit
 * namespaceId to assign — callers leave the model's `namespaceId`
 * slot empty (which means the late-bound default at the `StorageTable`
 * layer; emitted JSON omits the field).
 */
function resolveNamespaceIdForSqlTarget(input: {
  readonly bucketName: string;
  readonly targetId: string;
}): string | undefined {
  if (input.targetId !== 'postgres') {
    return undefined;
  }
  if (input.bucketName === UNSPECIFIED_PSL_NAMESPACE_NAME) {
    return 'public';
  }
  if (input.bucketName === 'unbound') {
    return UNBOUND_NAMESPACE_ID;
  }
  return input.bucketName;
}

/**
 * A namespace block is the unbound block when its name RESOLVES to the
 * unbound id — both the `namespace unbound { }` spelling (mapped by
 * {@link resolveNamespaceIdForSqlTarget}) and the raw sentinel spelling
 * `namespace __unbound__ { }` (passed through verbatim) behave identically:
 * same models-sibling restriction, same block-lowering bucket.
 */
function isUnboundNamespaceBlock(ns: NamespaceSymbol, targetId: string): boolean {
  return resolveNamespaceIdForSqlTarget({ bucketName: ns.name, targetId }) === UNBOUND_NAMESPACE_ID;
}

function validateNamespaceBlocksForSqlTarget(input: {
  readonly namespaces: readonly NamespaceSymbol[];
  readonly targetId: string;
  readonly sourceId: string;
  readonly sourceFile: SourceFile;
  readonly diagnostics: ContractSourceDiagnostic[];
}): void {
  if (input.targetId === 'sqlite') {
    for (const namespace of input.namespaces) {
      input.diagnostics.push({
        code: 'PSL_UNSUPPORTED_NAMESPACE_BLOCK',
        message: `SQLite does not support \`namespace ${namespace.name} { … }\` blocks (SQLite has no schema concept; declare models at the document top level instead).`,
        sourceId: input.sourceId,
        span: nodePslSpan(namespace.node.syntax, input.sourceFile),
      });
    }
    return;
  }

  if (input.targetId === 'postgres') {
    // Both the `namespace unbound { }` spelling and the raw `namespace
    // __unbound__ { }` spelling resolve to the same storage id, so a
    // document can declare BOTH as separate blocks. Find the one that
    // actually carries models — not just the first block that resolves to
    // the unbound id — otherwise a blocks-only unbound alias declared before
    // a model-carrying one under the other spelling would hide the
    // model-carrying one from this check.
    const unboundBlock = input.namespaces.find(
      (ns) => isUnboundNamespaceBlock(ns, input.targetId) && Object.keys(ns.models).length > 0,
    );
    const hasSibling = input.namespaces.some((ns) => !isUnboundNamespaceBlock(ns, input.targetId));
    // Late binding is a MODEL story: a model in `namespace unbound { }` gets
    // its schema resolved by the connection's search_path, which contradicts
    // sibling namespaces that pin schemas explicitly. Extension blocks (e.g.
    // `role`) carry no such conflict — a blocks-only unbound namespace is
    // legal next to named namespaces and lowers into the unbound bucket.
    if (unboundBlock !== undefined && hasSibling) {
      input.diagnostics.push({
        code: 'PSL_RESERVED_NAMESPACE_NAME',
        message:
          'Namespace "unbound" is reserved for the late-binding sentinel mapping; a `namespace unbound { … }` containing models cannot appear alongside other named namespace blocks. ' +
          'Use `namespace unbound { … }` alone (no sibling named namespaces) for late-binding multi-tenant contracts.',
        sourceId: input.sourceId,
        span: nodePslSpan(unboundBlock.node.syntax, input.sourceFile),
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
function buildEntityTypesByDiscriminator(
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
  readonly sourceId: string;
  readonly span: ContractSourceDiagnostic['span'];
}): ContractSourceDiagnostic {
  return {
    code: 'PSL_DUPLICATE_ATTRIBUTE',
    message: `\`@@${input.name}\` declared more than once on model "${input.modelName}".`,
    sourceId: input.sourceId,
    ...ifDefined('span', input.span),
  };
}

/**
 * Enforces `AuthoringPslBlockDescriptor.requiresModelAttribute` over one
 * scope (the top level or one namespace): every block whose descriptor
 * declares the requirement must name a model that carries the required
 * bare `@@` attribute. Runs on the parsed symbol table, so it is
 * independent of block/model declaration order and of lowering order. A
 * missing parameter or an unresolvable model is skipped — the
 * missing-required-parameter and unresolved-ref diagnostics own those
 * failure modes.
 */
function validateBlockModelAttributeRequirements(input: {
  readonly scopes: readonly {
    readonly models: Readonly<Record<string, ModelSymbol>>;
    readonly blocks: Readonly<Record<string, BlockSymbol>>;
  }[];
  readonly pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace;
  readonly sourceId: string;
  readonly diagnostics: ContractSourceDiagnostic[];
}): void {
  for (const scope of input.scopes) {
    for (const blockSymbol of Object.values(scope.blocks)) {
      const descriptor = findBlockDescriptor(input.pslBlockDescriptors, blockSymbol.keyword);
      const requirement = descriptor?.requiresModelAttribute;
      if (requirement === undefined) continue;
      const captured = blockSymbol.block.parameters[requirement.parameter];
      if (captured?.kind !== 'ref') continue;
      const model = scope.models[captured.identifier];
      if (model === undefined) continue;
      if (model.attributes.some((attribute) => attribute.name === requirement.attribute)) {
        continue;
      }
      input.diagnostics.push({
        code: 'PSL_EXTENSION_TARGET_MODEL_MISSING_ATTRIBUTE',
        message: `\`${blockSymbol.keyword}\` block "${blockSymbol.block.name}" targets model "${captured.identifier}", which does not declare \`@@${requirement.attribute}\`. Add \`@@${requirement.attribute}\` to model "${captured.identifier}".`,
        sourceId: input.sourceId,
        span: captured.span,
      });
    }
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
 * For a single lexical scope (a named PSL namespace, or the document top
 * level), lowers all extension blocks into IR entities via the registered
 * factory for each block's discriminator. Groups results by discriminator
 * (the entries key — one-string rule: discriminator === entries key).
 *
 * This pass is intentionally generic: no discriminator value is named here.
 * The factory (registered by the target pack) owns all block-specific logic.
 * A descriptor's factory output may also opt into value-set derivation via
 * the SQL family's `SqlValueSetDerivingEntityTypeOutput.deriveValueSet` hook
 * (probed by {@link deriveValueSetFromEntity}) — when present, the derived
 * value-set is folded into the namespace's `valueSet` slot (keyed by block
 * name), so a value-set-carrying pack entity (e.g. Postgres `native_enum`)
 * contributes the value-set that drives value-set → codec typing without
 * this pass inspecting a target-specific shape.
 *
 * The `namespaceId` is attached to the block before the factory call so the
 * factory can record the namespace coordinate without the interpreter
 * containing any target-specific knowledge about how namespace ids are used.
 *
 * Ref conversion is this pass's job, over typed data: each block-descriptor
 * parameter declared `{ kind: 'ref', refKind: 'model' }` (same-namespace
 * scope) is resolved to the referenced model's storage table name and
 * attached to the block as `resolvedModelRefs` ({@link ResolvedPslModelRefs})
 * before the factory runs — the factory consumes a resolved coordinate and
 * never looks a model up itself. A required model ref that is missing or
 * does not resolve is this pass's diagnostic; the factory is skipped.
 */
function lowerExtensionBlocksForNamespace(
  blocks: Readonly<Record<string, BlockSymbol>>,
  nsId: string,
  entityTypesByDiscriminator: ReadonlyMap<string, AuthoringEntityTypeDescriptor>,
  entityContext: AuthoringEntityContext,
  pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace,
  resolveModelTable: (modelName: string) => string | undefined,
): Readonly<Record<string, Readonly<Record<string, unknown>>>> {
  const blockSymbols = Object.values(blocks);
  if (blockSymbols.length === 0) return {};

  const result: Record<string, Record<string, unknown>> = {};

  for (const blockSymbol of blockSymbols) {
    const block = blockSymbol.block;
    const descriptor = entityTypesByDiscriminator.get(block.kind);
    if (descriptor === undefined) continue;

    const blockDescriptor = findBlockDescriptor(pslBlockDescriptors, block.keyword);
    let unresolvedRef = false;
    let resolvedModelRefs: Record<string, { readonly tableName: string }> | undefined;
    for (const [paramName, paramDecl] of Object.entries(blockDescriptor?.parameters ?? {})) {
      if (
        paramDecl.kind !== 'ref' ||
        paramDecl.refKind !== 'model' ||
        paramDecl.scope !== 'same-namespace'
      ) {
        continue;
      }
      const captured = block.parameters[paramName];
      if (captured?.kind !== 'ref') {
        if (paramDecl.required === true) {
          entityContext.diagnostics?.push({
            code: 'PSL_EXTENSION_MODEL_REF_UNRESOLVED',
            message: `\`${block.keyword}\` block "${block.name}" is missing the required \`${paramName}\` model reference.`,
            sourceId: entityContext.sourceId ?? 'unknown',
            span: block.span,
          });
          unresolvedRef = true;
        }
        continue;
      }
      const tableName = resolveModelTable(captured.identifier);
      if (tableName === undefined) {
        entityContext.diagnostics?.push({
          code: 'PSL_EXTENSION_MODEL_REF_UNRESOLVED',
          message: `\`${block.keyword}\` block "${block.name}" references model "${captured.identifier}" in \`${paramName}\`, which is not declared in the same namespace. Declare the model or fix the reference.`,
          sourceId: entityContext.sourceId ?? 'unknown',
          span: captured.span,
        });
        unresolvedRef = true;
        continue;
      }
      resolvedModelRefs = { ...(resolvedModelRefs ?? {}), [paramName]: { tableName } };
    }
    if (unresolvedRef) continue;

    const annotatedBlock = {
      ...block,
      namespaceId: nsId,
      ...(resolvedModelRefs !== undefined ? { resolvedModelRefs } : {}),
    };
    const entity = instantiateAuthoringEntityType(
      descriptor.discriminator,
      descriptor,
      [annotatedBlock],
      entityContext,
    );
    if (entity === undefined) continue;

    const entriesKey = descriptor.discriminator;
    const slot = result[entriesKey] ?? {};
    result[entriesKey] = slot;
    slot[block.name] = entity;

    const derivedValueSet = deriveValueSetFromEntity(descriptor.output, entity);
    if (derivedValueSet !== undefined) {
      const valueSetSlot = result['valueSet'] ?? {};
      result['valueSet'] = valueSetSlot;
      valueSetSlot[block.name] = derivedValueSet;
    }
  }

  return result;
}

interface ProcessEnumDeclarationsInput {
  readonly enumBlocks: readonly PslExtensionBlock[];
  readonly sourceId: string;
  readonly authoringContributions: AuthoringContributions | undefined;
  readonly entityContext: AuthoringEntityContext;
  readonly diagnostics: ContractSourceDiagnostic[];
}

function processEnumDeclarations(input: ProcessEnumDeclarationsInput): {
  readonly enumHandles: Record<string, EnumTypeHandle>;
  readonly enumTypeDescriptors: Map<string, ColumnDescriptor>;
} {
  const enumHandles: Record<string, EnumTypeHandle> = {};
  const enumTypeDescriptors = new Map<string, ColumnDescriptor>();

  if (input.enumBlocks.length === 0) {
    return { enumHandles, enumTypeDescriptors };
  }

  const enumDescriptor = getAuthoringEntity(input.authoringContributions, ['enum']);
  if (!enumDescriptor) {
    for (const decl of input.enumBlocks) {
      input.diagnostics.push({
        code: 'PSL_ENUM_MISSING_FACTORY',
        message: `enum "${decl.name}" requires an "enum" entityType factory in the active authoring contributions`,
        sourceId: input.sourceId,
        span: decl.span,
      });
    }
    return { enumHandles, enumTypeDescriptors };
  }

  for (const decl of input.enumBlocks) {
    const handle = instantiateAuthoringEntityType<EnumTypeHandle | undefined>(
      'enum',
      enumDescriptor,
      [decl],
      input.entityContext,
    );

    if (handle === undefined || handle === null) continue;

    enumHandles[decl.name] = handle;
    enumTypeDescriptors.set(decl.name, {
      codecId: handle.codecId,
      nativeType: handle.nativeType,
    });
  }

  return { enumHandles, enumTypeDescriptors };
}

/** Generic top-level blocks are supported only when a composed descriptor claims their keyword. */
function composedBlockKeywords(
  authoringContributions: AuthoringContributions | undefined,
): ReadonlySet<string> {
  const keywords = new Set<string>();
  const descriptors: AuthoringPslBlockDescriptorNamespace =
    authoringContributions?.pslBlockDescriptors ?? {};
  for (const [keyword, value] of Object.entries(descriptors)) {
    if (isAuthoringPslBlockDescriptor(value)) {
      keywords.add(keyword);
    }
  }
  return keywords;
}

interface BuildModelNodeInput {
  readonly model: ModelSymbol;
  readonly mapping: ModelNameMapping;
  readonly modelMappings: ReadonlyMap<string, ModelNameMapping>;
  /**
   * Model mappings keyed by `(namespaceId, modelName)` coordinate. Used to
   * resolve a namespace-qualified relation target (`auth.User`) to the exact
   * model even when the bare name is shared across namespaces.
   */
  readonly modelMappingsByCoordinate: ReadonlyMap<string, ModelNameMapping>;
  readonly modelNames: Set<string>;
  readonly compositeTypeNames: ReadonlySet<string>;
  readonly enumTypeDescriptors: Map<string, ColumnDescriptor>;
  readonly namedTypeDescriptors: Map<string, ColumnDescriptor>;
  readonly composedExtensions: Set<string>;
  /** Extension contracts keyed by space ID for cross-space FK table-name resolution. */
  readonly composedExtensionContracts: ReadonlyMap<string, Contract>;
  readonly familyId: string;
  readonly targetId: string;
  readonly authoringContributions: AuthoringContributions | undefined;
  readonly defaultFunctionRegistry: ControlMutationDefaultRegistry;
  readonly generatorDescriptorById: ReadonlyMap<string, MutationDefaultGeneratorDescriptor>;
  readonly scalarColumnDescriptors: ReadonlyMap<string, ColumnDescriptor>;
  readonly sourceId: string;
  readonly sourceFile: SourceFile;
  readonly symbolTable: SymbolTable;
  readonly diagnostics: ContractSourceDiagnostic[];
  /** Resolved namespace id keyed by model name — used to stamp the target namespace on FKs. */
  readonly modelNamespaceIds: ReadonlyMap<string, string>;
  readonly enumHandles?: ReadonlyMap<string, EnumTypeHandle>;
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
  readonly codecLookup?: CodecLookup;
  /** Contributed model-attribute descriptors keyed by bare `@@` attribute name (the exact shape `buildModelAttributesByName` produces). */
  readonly modelAttributesByName: ReadonlyMap<string, AuthoringModelAttributeDescriptor>;
  /** The target's default namespace id — the lowering context's `namespaceId` fallback for a model with no explicit PSL namespace. */
  readonly defaultNamespaceId: string;
}

interface BuildModelNodeResult {
  readonly modelNode: ModelNode;
  readonly fkRelationMetadata: FkRelationMetadata[];
  readonly backrelationCandidates: ModelBackrelationCandidate[];
  readonly resolvedFields: readonly ResolvedField[];
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

function buildModelNodeFromPsl(input: BuildModelNodeInput): BuildModelNodeResult {
  const { model, mapping, sourceId, diagnostics } = input;
  const tableName = mapping.tableName;
  const modelNamespaceId = input.modelNamespaceIds.get(model.name);
  const namespaceExtensionEntitiesForModel =
    modelNamespaceId !== undefined
      ? input.namespaceExtensionEntities?.get(modelNamespaceId)
      : undefined;

  const resolvedFields = collectResolvedFields({
    model,
    mapping,
    enumTypeDescriptors: input.enumTypeDescriptors,
    namedTypeDescriptors: input.namedTypeDescriptors,
    modelNames: input.modelNames,
    compositeTypeNames: input.compositeTypeNames,
    composedExtensions: input.composedExtensions,
    authoringContributions: input.authoringContributions,
    familyId: input.familyId,
    targetId: input.targetId,
    defaultFunctionRegistry: input.defaultFunctionRegistry,
    generatorDescriptorById: input.generatorDescriptorById,
    diagnostics,
    sourceId,
    sourceFile: input.sourceFile,
    scalarColumnDescriptors: input.scalarColumnDescriptors,
    ...ifDefined('enumHandles', input.enumHandles),
    capabilities: input.capabilities,
    ...ifDefined('namespaceId', modelNamespaceId),
    ...ifDefined('namespaceExtensionEntities', namespaceExtensionEntitiesForModel),
    ...ifDefined('codecLookup', input.codecLookup),
  });

  const inlineIdFields = resolvedFields.filter((field) => field.isId);
  if (inlineIdFields.length > 1) {
    diagnostics.push({
      code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
      message: `Model "${model.name}" cannot declare inline @id on multiple fields; use model-level @@id([...]) for composite identity`,
      sourceId,
      span: model.span,
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

  const resultBackrelationCandidates: ModelBackrelationCandidate[] = [];
  for (const field of Object.values(model.fields)) {
    if (!input.modelNames.has(field.typeName)) {
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
      sourceId,
      composedExtensions: input.composedExtensions,
      authoringContributions: input.authoringContributions,
      diagnostics,
      familyId: input.familyId,
      targetId: input.targetId,
    });
    let relationName: string | undefined;
    if (relationAttribute) {
      const parsedRelation = interpretRelationAttribute({
        selfModel: model,
        field,
        symbols: input.symbolTable,
        sourceFile: input.sourceFile,
        sourceId,
        diagnostics,
      });
      if (!parsedRelation) {
        continue;
      }
      if (parsedRelation.fields || parsedRelation.references) {
        diagnostics.push({
          code: 'PSL_INVALID_RELATION_ATTRIBUTE',
          message: `Backrelation list field "${model.name}.${field.name}" cannot declare fields/references; define them on the FK-side relation field`,
          sourceId,
          span: relationAttribute.span,
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
          sourceId,
          span: relationAttribute.span,
        });
        continue;
      }
      relationName = parsedRelation.name;
    }
    if (!attributesValid) {
      continue;
    }

    resultBackrelationCandidates.push({
      modelName: model.name,
      tableName,
      field,
      targetModelName: field.typeName,
      isList: field.list,
      ...ifDefined('relationName', relationName),
    });
  }

  const relationAttributes = Object.values(model.fields)
    .map((field) => ({
      field,
      relation: getAttribute(field.attributes, 'relation'),
    }))
    .filter((entry): entry is { field: FieldSymbol; relation: ResolvedAttribute } =>
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

  const modelAttributeNodes = Array.from(model.node.attributes());
  for (const [attributeIndex, modelAttribute] of model.attributes.entries()) {
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
            sourceId,
            span: modelAttribute.span,
          }),
        );
        continue;
      }
      controlPolicyDeclared = true;
      const node = modelAttributeNodes[attributeIndex];
      if (node === undefined) {
        continue;
      }
      const parsed = interpretModelAttribute({
        node,
        spec: controlModelSpec,
        model,
        sourceFile: input.sourceFile,
        sourceId,
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
          sourceId,
          span: modelAttribute.span,
        });
        continue;
      }
      if (hasInlinePrimaryKey) {
        diagnostics.push({
          code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
          message: `Model "${model.name}" cannot declare both field-level @id and model-level @@id`,
          sourceId,
          span: modelAttribute.span,
        });
        blockPrimaryKeyDeclared = true;
        continue;
      }
      const node = modelAttributeNodes[attributeIndex];
      if (node === undefined) {
        continue;
      }
      const parsed = interpretModelAttribute({
        node,
        spec: idModelSpec,
        model,
        sourceFile: input.sourceFile,
        sourceId,
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
          sourceId,
          span: modelAttribute.span,
        });
        continue;
      }
      const columnNames = mapFieldNamesToColumns({
        modelName: model.name,
        fieldNames,
        mapping,
        sourceId,
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
      const node = modelAttributeNodes[attributeIndex];
      if (node === undefined) {
        continue;
      }
      const parsed = interpretModelAttribute({
        node,
        spec: uniqueModelSpec,
        model,
        sourceFile: input.sourceFile,
        sourceId,
        diagnostics,
      });
      if (parsed === undefined) {
        continue;
      }
      const columnNames = mapFieldNamesToColumns({
        modelName: model.name,
        fieldNames: parsed.fields,
        mapping,
        sourceId,
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
      const node = modelAttributeNodes[attributeIndex];
      if (node === undefined) {
        continue;
      }
      const parsed = interpretModelAttribute({
        node,
        spec: indexModelSpec,
        model,
        sourceFile: input.sourceFile,
        sourceId,
        diagnostics,
      });
      if (parsed === undefined) {
        continue;
      }
      let columnNames: readonly string[] | undefined;
      if (parsed.fields !== undefined) {
        const mapped = mapFieldNamesToColumns({
          modelName: model.name,
          fieldNames: parsed.fields,
          mapping,
          sourceId,
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
          ...ifDefined('expression', parsed.expression),
          where: parsed.where,
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
      const node = modelAttributeNodes[attributeIndex];
      if (node === undefined) {
        continue;
      }
      if (input.capabilities['sql']?.['checkConstraint'] !== true) {
        diagnostics.push({
          code: 'PSL_CHECK_UNSUPPORTED_TARGET',
          message: `Model "${model.name}" declares "@@check", but target "${input.targetId}" does not support check constraints (the adapter does not report the "checkConstraint" capability). Remove the check or author it against a target that supports check constraints.`,
          sourceId,
          span: modelAttribute.span,
        });
        continue;
      }
      const parsed = interpretModelAttribute({
        node,
        spec: checkModelSpec,
        model,
        sourceFile: input.sourceFile,
        sourceId,
        diagnostics,
      });
      if (parsed === undefined) {
        continue;
      }
      checkNodes.push({
        expression: parsed.expression,
        name: parsed.name,
        map: parsed.map,
      });
      continue;
    }
    const contributedModelAttribute = input.modelAttributesByName.get(modelAttribute.name);
    if (contributedModelAttribute !== undefined) {
      if (declaredContributedModelAttributes.has(modelAttribute.name)) {
        diagnostics.push(
          duplicateModelAttributeDiagnostic({
            name: modelAttribute.name,
            modelName: model.name,
            sourceId,
            span: modelAttribute.span,
          }),
        );
        continue;
      }
      declaredContributedModelAttributes.add(modelAttribute.name);
      const node = modelAttributeNodes[attributeIndex];
      if (node === undefined) {
        continue;
      }
      const specFactory = blindCast<
        ModelAttributeSpecFactory,
        'contributed model-attribute descriptors carry an ADR-231 attribute-spec factory by construction'
      >(contributedModelAttribute.spec);
      const parsed = interpretModelAttribute({
        node,
        spec: specFactory({
          symbols: input.symbolTable,
          model,
          controlMutationDefaults: input.defaultFunctionRegistry,
        }),
        model,
        sourceFile: input.sourceFile,
        sourceId,
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
        modelName: model.name,
        storageName: tableName,
        namespaceId: modelNamespaceId ?? input.defaultNamespaceId,
        sourceId,
        diagnostics: {
          push: (d) => {
            diagnostics.push(
              blindCast<ContractSourceDiagnostic, 'sink diagnostics are span-compatible'>(d),
            );
          },
        },
      });
      if (lowered === undefined) {
        continue;
      }
      const slot = modelAttributeEntities[contributedModelAttribute.attribute] ?? {};
      modelAttributeEntities[contributedModelAttribute.attribute] = slot;
      slot[lowered.key] = lowered.entity;
      continue;
    }
    const uncomposedNamespace = checkUncomposedNamespace(
      modelAttribute.name,
      input.composedExtensions,
      {
        familyId: input.familyId,
        targetId: input.targetId,
        authoringContributions: input.authoringContributions,
      },
    );
    if (uncomposedNamespace) {
      reportUncomposedNamespace({
        subjectLabel: `Attribute "@@${modelAttribute.name}"`,
        namespace: uncomposedNamespace,
        sourceId,
        span: modelAttribute.span,
        diagnostics,
      });
      continue;
    }
    diagnostics.push({
      code: 'PSL_UNSUPPORTED_MODEL_ATTRIBUTE',
      message: `Model "${model.name}" uses unsupported attribute "@@${modelAttribute.name}"`,
      sourceId,
      span: modelAttribute.span,
    });
  }

  const resultFkRelationMetadata: FkRelationMetadata[] = [];
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
          sourceId,
          span: relationAttribute.field.span,
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
          sourceId,
          span: relationAttribute.field.span,
          data: { space: fieldTypeContractSpaceId, suggestedPack: fieldTypeContractSpaceId },
        });
        continue;
      }

      const parsedRelation = interpretRelationAttribute({
        selfModel: model,
        field: relationAttribute.field,
        symbols: input.symbolTable,
        sourceFile: input.sourceFile,
        sourceId,
        diagnostics,
      });
      if (!parsedRelation) {
        continue;
      }
      if (!parsedRelation.fields || !parsedRelation.references) {
        diagnostics.push({
          code: 'PSL_INVALID_RELATION_ATTRIBUTE',
          message: `Relation field "${model.name}.${relationAttribute.field.name}" requires fields and references arguments`,
          sourceId,
          span: relationAttribute.relation.span,
        });
        continue;
      }

      const localColumns = mapFieldNamesToColumns({
        modelName: model.name,
        fieldNames: parsedRelation.fields,
        mapping,
        sourceId,
        diagnostics,
        span: relationAttribute.relation.span,
        entityLabel: `Relation field "${model.name}.${relationAttribute.field.name}"`,
      });
      if (!localColumns) {
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
          sourceId,
          span: relationAttribute.relation.span,
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
      const crossTargetNamespaceId = fieldTypeNamespaceId ?? '__unbound__';

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
          sourceId,
          span: relationAttribute.field.span,
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

      // Build the cross-space RelationNode directly (no local back-relation candidate).
      // `buildSqlContractFromDefinition` recognises `spaceId` on a RelationNode and routes it
      // through the cross-space domain-relation path (produces a non-navigable CrossReference).
      resultCrossSpaceRelations.push({
        fieldName: relationAttribute.field.name,
        toModel: fieldTypeName,
        toTable: crossTargetTableName,
        cardinality: 'N:1',
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

    if (!input.modelNames.has(fieldTypeName)) {
      diagnostics.push({
        code: 'PSL_INVALID_RELATION_TARGET',
        message: `Relation field "${model.name}.${relationAttribute.field.name}" references unknown model "${qualifiedTypeName}"`,
        sourceId,
        span: relationAttribute.field.span,
      });
      continue;
    }

    const normalizedQualifier =
      fieldTypeNamespaceId === undefined
        ? undefined
        : fieldTypeNamespaceId === 'unbound'
          ? '__unbound__'
          : fieldTypeNamespaceId;
    if (
      normalizedQualifier !== undefined &&
      !input.modelMappingsByCoordinate.has(modelCoordinateKey(normalizedQualifier, fieldTypeName))
    ) {
      diagnostics.push({
        code: 'PSL_INVALID_RELATION_TARGET',
        message: `Relation field "${model.name}.${relationAttribute.field.name}" references unknown model "${qualifiedTypeName}"`,
        sourceId,
        span: relationAttribute.field.span,
      });
      continue;
    }

    const parsedRelation = interpretRelationAttribute({
      selfModel: model,
      field: relationAttribute.field,
      symbols: input.symbolTable,
      sourceFile: input.sourceFile,
      sourceId,
      diagnostics,
    });
    if (!parsedRelation) {
      continue;
    }
    if (!parsedRelation.fields || !parsedRelation.references) {
      diagnostics.push({
        code: 'PSL_INVALID_RELATION_ATTRIBUTE',
        message: `Relation field "${model.name}.${relationAttribute.field.name}" requires fields and references arguments`,
        sourceId,
        span: relationAttribute.relation.span,
      });
      continue;
    }

    const targetMapping =
      normalizedQualifier !== undefined
        ? input.modelMappingsByCoordinate.get(
            modelCoordinateKey(normalizedQualifier, fieldTypeName),
          )
        : input.modelMappings.get(fieldTypeName);
    if (!targetMapping) {
      diagnostics.push({
        code: 'PSL_INVALID_RELATION_TARGET',
        message: `Relation field "${model.name}.${relationAttribute.field.name}" references unknown model "${qualifiedTypeName}"`,
        sourceId,
        span: relationAttribute.field.span,
      });
      continue;
    }

    const localColumns = mapFieldNamesToColumns({
      modelName: model.name,
      fieldNames: parsedRelation.fields,
      mapping,
      sourceId,
      diagnostics,
      span: relationAttribute.relation.span,
      entityLabel: `Relation field "${model.name}.${relationAttribute.field.name}"`,
    });
    if (!localColumns) {
      continue;
    }
    const referencedColumns = mapFieldNamesToColumns({
      modelName: targetMapping.model.name,
      fieldNames: parsedRelation.references,
      mapping: targetMapping,
      sourceId,
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
        sourceId,
        span: relationAttribute.relation.span,
      });
      continue;
    }

    const onDelete = parsedRelation.onDelete
      ? normalizeReferentialAction(parsedRelation.onDelete)
      : undefined;
    const onUpdate = parsedRelation.onUpdate
      ? normalizeReferentialAction(parsedRelation.onUpdate)
      : undefined;

    const targetNamespaceId =
      normalizedQualifier !== undefined
        ? normalizedQualifier
        : input.modelNamespaceIds.get(targetMapping.model.name);
    foreignKeyNodes.push({
      columns: localColumns,
      references: {
        model: targetMapping.model.name,
        table: targetMapping.tableName,
        columns: referencedColumns,
        ...ifDefined('namespaceId', targetNamespaceId),
      },
      ...ifDefined('name', parsedRelation.map),
      ...ifDefined('onDelete', onDelete),
      ...ifDefined('onUpdate', onUpdate),
      ...ifDefined('index', parsedRelation.index),
    });

    resultFkRelationMetadata.push({
      declaringModelName: model.name,
      declaringFieldName: relationAttribute.field.name,
      declaringTableName: tableName,
      ...ifDefined('declaringNamespaceId', input.modelNamespaceIds.get(model.name)),
      targetModelName: targetMapping.model.name,
      targetTableName: targetMapping.tableName,
      ...ifDefined('targetNamespaceId', targetNamespaceId),
      ...ifDefined('relationName', parsedRelation.name),
      localColumns,
      referencedColumns,
    });
  }

  return {
    modelNode: {
      modelName: model.name,
      tableName,
      fields: resolvedFields.map((resolvedField) => {
        const enumHandle = input.enumHandles?.get(resolvedField.field.typeName);
        return {
          fieldName: resolvedField.field.name,
          columnName: resolvedField.columnName,
          descriptor: resolvedField.descriptor,
          nullable: resolvedField.nullable,
          ...(resolvedField.many && resolvedField.valueObjectTypeName === undefined
            ? { many: true as const }
            : {}),
          ...ifDefined('default', resolvedField.defaultValue),
          ...ifDefined('executionDefaults', resolvedField.executionDefaults),
          ...ifDefined('noCheck', resolvedField.noCheck),
          ...ifDefined('enumTypeHandle', enumHandle),
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
    crossSpaceRelations: resultCrossSpaceRelations,
    backrelationCandidates: resultBackrelationCandidates,
    resolvedFields,
    modelAttributeEntities,
  };
}

interface BuildValueObjectsInput {
  readonly compositeTypes: readonly CompositeTypeSymbol[];
  readonly enumTypeDescriptors: ReadonlyMap<string, ColumnDescriptor>;
  readonly namedTypeDescriptors: ReadonlyMap<string, ColumnDescriptor>;
  readonly scalarColumnDescriptors: ReadonlyMap<string, ColumnDescriptor>;
  readonly composedExtensions: ReadonlySet<string>;
  readonly familyId: string;
  readonly targetId: string;
  readonly authoringContributions: AuthoringContributions | undefined;
  readonly diagnostics: ContractSourceDiagnostic[];
  readonly sourceId: string;
}

function buildValueObjects(input: BuildValueObjectsInput): Record<string, ContractValueObject> {
  const {
    compositeTypes,
    enumTypeDescriptors,
    namedTypeDescriptors,
    scalarColumnDescriptors,
    composedExtensions,
    familyId,
    targetId,
    authoringContributions,
    diagnostics,
    sourceId,
  } = input;
  const valueObjects: Record<string, ContractValueObject> = {};
  const compositeTypeNames = new Set(compositeTypes.map((ct) => ct.name));

  for (const compositeType of compositeTypes) {
    const fields: Record<string, ContractField> = {};
    for (const field of Object.values(compositeType.fields)) {
      if (compositeTypeNames.has(field.typeName)) {
        const result: ContractField = {
          type: { kind: 'valueObject', name: field.typeName },
          nullable: field.optional,
        };
        fields[field.name] = field.list ? { ...result, many: true } : result;
        continue;
      }
      const resolved = resolveFieldTypeDescriptor({
        field,
        enumTypeDescriptors,
        namedTypeDescriptors,
        scalarColumnDescriptors,
        authoringContributions,
        composedExtensions,
        familyId,
        targetId,
        diagnostics,
        sourceId,
        entityLabel: `Field "${compositeType.name}.${field.name}"`,
      });
      if (!resolved.ok) {
        if (!resolved.alreadyReported) {
          diagnostics.push({
            code: 'PSL_UNSUPPORTED_FIELD_TYPE',
            message: `Field "${compositeType.name}.${field.name}" type "${field.typeName}" is not supported`,
            sourceId,
            span: field.span,
          });
        }
        continue;
      }
      const scalarField: ContractField = {
        nullable: field.optional,
        type: { kind: 'scalar', codecId: resolved.descriptor.codecId },
      };
      fields[field.name] = field.list ? { ...scalarField, many: true } : scalarField;
    }
    valueObjects[compositeType.name] = { fields };
  }

  return valueObjects;
}

function patchModelDomainFields(
  models: Record<string, ContractModel>,
  modelResolvedFields: ReadonlyMap<string, readonly ResolvedField[]>,
): Record<string, ContractModel> {
  let patched = models;

  for (const [modelName, resolvedFields] of modelResolvedFields) {
    const model = patched[modelName];
    if (!model) continue;

    let needsPatch = false;
    const patchedFields: Record<string, ContractField> = { ...model.fields };

    for (const rf of resolvedFields) {
      if (rf.valueObjectTypeName) {
        needsPatch = true;
        patchedFields[rf.field.name] = {
          nullable: rf.field.optional,
          type: { kind: 'valueObject', name: rf.valueObjectTypeName },
          ...(rf.many ? { many: true as const } : {}),
        };
      } else if (rf.many && rf.scalarCodecId) {
        needsPatch = true;
        patchedFields[rf.field.name] = {
          nullable: rf.field.optional,
          type: { kind: 'scalar', codecId: rf.scalarCodecId },
          many: true as const,
        };
      }
    }

    if (needsPatch) {
      patched = { ...patched, [modelName]: { ...model, fields: patchedFields } };
    }
  }

  return patched;
}

type DiscriminatorDeclaration = {
  readonly fieldName: string;
  readonly span: ContractSourceDiagnosticSpan;
};

type BaseDeclaration = {
  readonly baseName: string;
  readonly value: string;
  readonly span: ContractSourceDiagnosticSpan;
};

function collectPolymorphismDeclarations(
  models: readonly ModelSymbol[],
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
    const discriminatorNode = findModelAttributeNode(model, 'discriminator');
    if (discriminatorNode !== undefined) {
      const parsed = interpretModelAttribute({
        node: discriminatorNode,
        spec: discriminatorModelSpec,
        model,
        sourceFile,
        sourceId,
        diagnostics,
      });
      if (parsed !== undefined) {
        const span = nodePslSpan(discriminatorNode.syntax, sourceFile);
        const discField = model.fields[parsed.field];
        if (discField && discField.typeName !== 'String') {
          diagnostics.push({
            code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
            message: `Discriminator field "${parsed.field}" on model "${model.name}" must be of type String, but is "${discField.typeName}"`,
            sourceId,
            span,
          });
        } else {
          discriminatorDeclarations.set(model.name, { fieldName: parsed.field, span });
        }
      }
    }

    const baseNode = findModelAttributeNode(model, 'base');
    if (baseNode !== undefined) {
      const parsed = interpretModelAttribute({
        node: baseNode,
        spec: baseModelSpec,
        model,
        sourceFile,
        sourceId,
        diagnostics,
      });
      if (parsed !== undefined) {
        baseDeclarations.set(model.name, {
          baseName: parsed.base,
          value: parsed.value,
          span: nodePslSpan(baseNode.syntax, sourceFile),
        });
      }
    }
  }

  return { discriminatorDeclarations, baseDeclarations };
}

function resolvePolymorphism(
  models: Record<string, ContractModel>,
  discriminatorDeclarations: Map<string, DiscriminatorDeclaration>,
  baseDeclarations: Map<string, BaseDeclaration>,
  modelNames: Set<string>,
  modelMappings: ReadonlyMap<string, ModelNameMapping>,
  modelNamespaceIds: ReadonlyMap<string, string>,
  defaultNamespaceId: string,
  syntheticPkFieldsByVariant: ReadonlyMap<string, readonly string[]>,
  stiBaseFieldsByBase: ReadonlyMap<string, readonly string[]>,
  sourceId: string,
  diagnostics: ContractSourceDiagnostic[],
): Record<string, ContractModel> {
  let patched = models;

  const coordinateFor = (modelName: string): string =>
    modelCoordinateKey(modelNamespaceIds.get(modelName) ?? defaultNamespaceId, modelName);

  // STI variant columns were materialised onto the base storage table so the
  // variants' `storage.fields` resolve. They are storage-only on the base — the
  // domain field belongs to the variant — so strip them from the base model's
  // domain + storage field maps (the table column, built upstream, stays).
  for (const [baseName, fieldNames] of stiBaseFieldsByBase) {
    const baseKey = coordinateFor(baseName);
    const baseModel = patched[baseKey];
    if (!baseModel || fieldNames.length === 0) continue;
    patched = {
      ...patched,
      [baseKey]: stripStorageOnlyDomainFields(baseModel, fieldNames),
    };
  }

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

    const model = patched[coordinateFor(modelName)];
    if (!model) continue;

    const variants: Record<string, { readonly value: string }> = {};
    const seenValues = new Map<string, string>();

    for (const [variantName, baseDecl] of baseDeclarations) {
      if (baseDecl.baseName !== modelName) continue;

      const existingVariant = seenValues.get(baseDecl.value);
      if (existingVariant) {
        diagnostics.push({
          code: 'PSL_DUPLICATE_DISCRIMINATOR_VALUE',
          message: `Discriminator value "${baseDecl.value}" is used by both "${existingVariant}" and "${variantName}" on base model "${modelName}"`,
          sourceId,
          span: baseDecl.span,
        });
        continue;
      }
      seenValues.set(baseDecl.value, variantName);
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
      [coordinateFor(modelName)]: { ...model, discriminator: { field: decl.fieldName }, variants },
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

    const variantModel = patched[coordinateFor(variantName)];
    if (!variantModel) continue;

    const baseMapping = modelMappings.get(baseDecl.baseName);
    const variantMapping = modelMappings.get(variantName);
    const hasExplicitMap =
      variantMapping?.model.attributes.some((attr) => attr.name === 'map') ?? false;
    const resolvedTable = hasExplicitMap ? variantMapping?.tableName : baseMapping?.tableName;

    const patchedVariant: ContractModel = {
      ...variantModel,
      base: crossRef(
        baseDecl.baseName,
        modelNamespaceIds.get(baseDecl.baseName) ?? defaultNamespaceId,
      ),
      ...(resolvedTable ? { storage: { ...variantModel.storage, table: resolvedTable } } : {}),
    };

    patched = {
      ...patched,
      [coordinateFor(variantName)]: stripStorageOnlyDomainFields(
        patchedVariant,
        syntheticPkFieldsByVariant.get(variantName) ?? [],
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
  stiVariantNames: ReadonlySet<string>,
): { modelNodes: ModelNode[]; syntheticPkFieldsByVariant: Map<string, readonly string[]> } {
  const nodeByModel = new Map(modelNodes.map((node) => [node.modelName, node]));
  const syntheticPkFieldsByVariant = new Map<string, readonly string[]>();

  const enriched = modelNodes.map((node): ModelNode => {
    const baseDecl = baseDeclarations.get(node.modelName);
    if (!baseDecl) return node;
    const baseNode = nodeByModel.get(baseDecl.baseName);
    if (!baseNode) return node;
    // Single-table inheritance (no own `@@map`) shares the base table; it gets
    // its columns materialised onto the base instead (see
    // {@link materializeStiVariantStorageColumns}), never a link column.
    if (stiVariantNames.has(node.modelName)) return node;
    const basePrimaryKey = baseNode.id;
    if (!basePrimaryKey || basePrimaryKey.columns.length === 0) return node;

    const existingColumns = new Set(node.fields.map((field) => field.columnName));
    const linkFields: FieldNode[] = [];
    for (const pkColumn of basePrimaryKey.columns) {
      if (existingColumns.has(pkColumn)) continue;
      const baseField = baseNode.fields.find(
        (field): field is FieldNode => 'descriptor' in field && field.columnName === pkColumn,
      );
      if (!baseField) continue;
      linkFields.push({
        fieldName: baseField.fieldName,
        columnName: pkColumn,
        descriptor: baseField.descriptor,
        nullable: false,
      });
    }
    if (linkFields.length === 0) return node;

    syntheticPkFieldsByVariant.set(
      node.modelName,
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
      // The link columns are the variant's own primary key, which already
      // carries a unique index — a separate FK backing index would be redundant.
      index: false,
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
  stiVariantNames: ReadonlySet<string>,
): { modelNodes: ModelNode[]; stiBaseFieldsByBase: Map<string, readonly string[]> } {
  if (stiVariantNames.size === 0) {
    return { modelNodes: [...modelNodes], stiBaseFieldsByBase: new Map() };
  }

  const nodeByModel = new Map(modelNodes.map((node) => [node.modelName, node]));
  type StiColumn = ModelNode['fields'][number];
  const stiColumnsByBase = new Map<string, StiColumn[]>();

  for (const variantName of stiVariantNames) {
    const variantNode = nodeByModel.get(variantName);
    const baseDecl = baseDeclarations.get(variantName);
    if (!variantNode || !baseDecl) continue;
    const baseNode = nodeByModel.get(baseDecl.baseName);
    if (!baseNode) continue;

    const baseColumns = new Set(baseNode.fields.map((field) => field.columnName));
    const claimed = stiColumnsByBase.get(baseDecl.baseName) ?? [];
    const claimedColumns = new Set(claimed.map((field) => field.columnName));

    for (const field of variantNode.fields) {
      if (baseColumns.has(field.columnName) || claimedColumns.has(field.columnName)) {
        continue;
      }
      claimedColumns.add(field.columnName);
      claimed.push({ ...field, nullable: true });
    }
    stiColumnsByBase.set(baseDecl.baseName, claimed);
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
    if (stiVariantNames.has(node.modelName)) {
      return { ...node, sharesBaseTable: true };
    }
    const stiColumns = stiColumnsByBase.get(node.modelName);
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

export function interpretPslDocumentToSqlContract(
  input: InterpretPslDocumentToSqlContractInput,
): Result<Contract, ContractSourceDiagnostics> {
  const sourceId = input.sourceId;
  if (!input.target) {
    return notOk({
      summary: 'PSL to SQL contract interpretation failed',
      diagnostics: [
        {
          code: 'PSL_TARGET_CONTEXT_REQUIRED',
          message: 'PSL interpretation requires an explicit target context from composition.',
          sourceId,
        },
      ],
    });
  }
  if (!input.scalarColumnDescriptors) {
    return notOk({
      summary: 'PSL to SQL contract interpretation failed',
      diagnostics: [
        {
          code: 'PSL_SCALAR_TYPE_CONTEXT_REQUIRED',
          message: 'PSL interpretation requires composed scalar type descriptors.',
          sourceId,
        },
      ],
    });
  }

  const { topLevel } = input.symbolTable;
  const sourceFile = input.sourceFile;
  const namespaceSymbols = Object.values(topLevel.namespaces);
  const diagnostics: ContractSourceDiagnostic[] = [...(input.seedDiagnostics ?? [])];
  validateNamespaceBlocksForSqlTarget({
    namespaces: namespaceSymbols,
    targetId: input.target.targetId,
    sourceId,
    sourceFile,
    diagnostics,
  });
  validateBlockModelAttributeRequirements({
    scopes: [topLevel, ...namespaceSymbols],
    pslBlockDescriptors: input.authoringContributions?.pslBlockDescriptors ?? {},
    sourceId,
    diagnostics,
  });
  const models: ModelSymbol[] = [];
  const modelEntries: ModelNamespaceEntry[] = [];
  const modelNamespaceIds = new Map<string, string>();
  const compositeTypes: CompositeTypeSymbol[] = [];

  const collectScope = (
    bucketName: string,
    scopeModels: Iterable<ModelSymbol>,
    scopeCompositeTypes: Iterable<CompositeTypeSymbol>,
  ): void => {
    const resolvedNamespaceId = resolveNamespaceIdForSqlTarget({
      bucketName,
      targetId: input.target.targetId,
    });
    for (const model of scopeModels) {
      models.push(model);
      modelEntries.push({ model, namespaceId: resolvedNamespaceId });
      if (resolvedNamespaceId !== undefined) {
        modelNamespaceIds.set(model.name, resolvedNamespaceId);
      }
    }
    for (const compositeType of scopeCompositeTypes) {
      compositeTypes.push(compositeType);
    }
  };

  collectScope(
    UNSPECIFIED_PSL_NAMESPACE_NAME,
    Object.values(topLevel.models),
    Object.values(topLevel.compositeTypes),
  );
  for (const namespace of namespaceSymbols) {
    collectScope(
      namespace.name,
      Object.values(namespace.models),
      Object.values(namespace.compositeTypes),
    );
  }
  const defaultNamespaceId = input.target.defaultNamespaceId;

  const modelNames = new Set(models.map((model) => model.name));
  const compositeTypeNames = new Set(compositeTypes.map((ct) => ct.name));
  const composedExtensions = new Set(input.composedExtensions ?? []);
  const composedExtensionContracts: ReadonlyMap<string, Contract> =
    input.composedExtensionContracts;
  const defaultFunctionRegistry: ControlMutationDefaultRegistry =
    input.controlMutationDefaults?.defaultFunctionRegistry ?? new Map();
  const generatorDescriptors = input.controlMutationDefaults?.generatorDescriptors ?? [];
  const generatorDescriptorById = new Map<string, MutationDefaultGeneratorDescriptor>();
  for (const descriptor of generatorDescriptors) {
    generatorDescriptorById.set(descriptor.id, descriptor);
  }

  const isEnumBlock = (block: BlockSymbol): boolean => block.keyword === 'enum';
  const legitimateBlockKeywords = composedBlockKeywords(input.authoringContributions);
  const reportUnsupportedTopLevelBlock = (block: BlockSymbol): void => {
    diagnostics.push({
      code: 'PSL_UNSUPPORTED_TOP_LEVEL_BLOCK',
      message: `Unsupported top-level block "${block.keyword}"`,
      sourceId,
      span: keywordPslSpan(block.node.syntax, block.keyword, sourceFile),
    });
  };

  const topLevelEnums: PslExtensionBlock[] = [];
  // Registered non-enum top-level blocks lower through the same generic
  // extension pass as namespace blocks (see the top-level
  // `lowerExtensionBlocksForNamespace` call below); collected here so
  // keyword validation happens in one place.
  const topLevelExtensionBlocks: Record<string, BlockSymbol> = {};
  for (const [blockName, block] of Object.entries(topLevel.blocks)) {
    if (!legitimateBlockKeywords.has(block.keyword)) {
      reportUnsupportedTopLevelBlock(block);
      continue;
    }
    if (isEnumBlock(block)) {
      topLevelEnums.push(block.block);
    } else {
      topLevelExtensionBlocks[blockName] = block;
    }
  }
  for (const namespace of namespaceSymbols) {
    for (const block of Object.values(namespace.blocks)) {
      if (isEnumBlock(block)) {
        diagnostics.push({
          code: 'PSL_ENUM_NAMESPACE_NOT_SUPPORTED',
          message: `enum "${block.name}" inside namespace "${namespace.name}" is not supported; declare enum at the top level`,
          sourceId,
          span: nodePslSpan(block.node.syntax, sourceFile),
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
    sourceId,
    authoringContributions: input.authoringContributions,
    entityContext: {
      family: input.target.familyId,
      target: input.target.targetId,
      ...ifDefined('codecLookup', input.codecLookup),
      sourceId,
      diagnostics: {
        push: (d) => {
          diagnostics.push(
            blindCast<ContractSourceDiagnostic, 'sink diagnostics are span-compatible'>(d),
          );
        },
      },
      ...ifDefined('enumInferenceCodecs', input.enumInferenceCodecs),
    },
    diagnostics,
  });

  const allEnumTypeDescriptors = new Map(enumResult.enumTypeDescriptors);

  const validEnumHandles: Record<string, EnumTypeHandle> = { ...enumResult.enumHandles };

  const enumHandlesByName = new Map(Object.entries(validEnumHandles));

  // Generic extension-block lowering pass: per lexical scope (each named
  // namespace, plus the document top level), lower all parsed extension
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
  const modelAttributesByName = buildModelAttributesByName(input.authoringContributions);
  // Warnings pushed by entity factories run ahead of
  // `buildSqlContractFromDefinition`; handed to the build via the definition
  // so its one per-build flush covers the whole build.
  const authoringWarnings: AuthoringWarning[] = [];
  const extensionEntityContext: AuthoringEntityContext = {
    family: input.target.familyId,
    target: input.target.targetId,
    ...ifDefined('enumInferenceCodecs', input.enumInferenceCodecs),
    ...ifDefined('codecLookup', input.codecLookup),
    sourceId,
    diagnostics: {
      push: (d) => {
        diagnostics.push(
          blindCast<ContractSourceDiagnostic, 'sink diagnostics are span-compatible'>(d),
        );
      },
    },
    warnings: authoringWarnings,
  };
  // Diagnostics-free resolution of every model's declared storage name,
  // feeding the extension-block pass's model-ref conversion (a block's
  // declared `refKind: 'model'` params resolve to table names before the
  // factory runs). The authoritative resolution (which reports a malformed
  // `@@map`) still runs at its usual point in the pass ordering, via
  // `modelMappingsByCoordinate` further down; this call discards its own
  // diagnostics so nothing is reported twice.
  const earlyModelMappingsByCoordinate = buildModelMappings(
    modelEntries,
    defaultNamespaceId,
    [],
    sourceId,
    sourceFile,
  );
  const composedPslBlockDescriptors = input.authoringContributions?.pslBlockDescriptors ?? {};
  const namespaceExtensionEntities = new Map<
    string,
    Readonly<Record<string, Readonly<Record<string, unknown>>>>
  >();
  const mergeNamespaceExtensionEntities = (
    nsId: string,
    entities: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
  ): void => {
    if (Object.keys(entities).length === 0) return;
    const existing = namespaceExtensionEntities.get(nsId);
    if (existing === undefined) {
      namespaceExtensionEntities.set(nsId, entities);
      return;
    }
    // A top-level block and a `namespace public { … }` block both land in
    // the default bucket — merge per entries slot rather than overwrite. Two
    // reopened namespace spellings declaring the same entity name under the
    // same entries kind is a genuine authoring collision (last-write-wins
    // would silently drop one), so flag it rather than merge over it.
    const merged: Record<string, Readonly<Record<string, unknown>>> = { ...existing };
    for (const [entriesKey, slot] of Object.entries(entities)) {
      const existingSlot = existing[entriesKey];
      if (existingSlot !== undefined) {
        for (const name of Object.keys(slot)) {
          if (Object.hasOwn(existingSlot, name)) {
            diagnostics.push({
              code: 'PSL_DUPLICATE_EXTENSION_ENTITY',
              message: `entries slot "${entriesKey}" in namespace "${nsId}": entity "${name}" is declared more than once in the same namespace.`,
              sourceId,
            });
          }
        }
      }
      merged[entriesKey] = { ...existingSlot, ...slot };
    }
    namespaceExtensionEntities.set(nsId, merged);
  };
  for (const ns of namespaceSymbols) {
    if (ns.name === UNSPECIFIED_PSL_NAMESPACE_NAME) continue;
    const nsId = resolveNamespaceIdForSqlTarget({
      bucketName: ns.name,
      targetId: input.target.targetId,
    });
    if (nsId === undefined) continue;
    mergeNamespaceExtensionEntities(
      nsId,
      lowerExtensionBlocksForNamespace(
        ns.blocks,
        nsId,
        entityTypesByDiscriminator,
        extensionEntityContext,
        composedPslBlockDescriptors,
        (modelName: string) =>
          earlyModelMappingsByCoordinate.get(modelCoordinateKey(nsId, modelName))?.tableName,
      ),
    );
  }

  // Top-level extension blocks lower into the default namespace bucket, the
  // same resolution top-level models get.
  if (Object.keys(topLevelExtensionBlocks).length > 0) {
    const topLevelNsId =
      resolveNamespaceIdForSqlTarget({
        bucketName: UNSPECIFIED_PSL_NAMESPACE_NAME,
        targetId: input.target.targetId,
      }) ?? defaultNamespaceId;
    mergeNamespaceExtensionEntities(
      topLevelNsId,
      lowerExtensionBlocksForNamespace(
        topLevelExtensionBlocks,
        topLevelNsId,
        entityTypesByDiscriminator,
        extensionEntityContext,
        composedPslBlockDescriptors,
        (modelName: string) =>
          earlyModelMappingsByCoordinate.get(modelCoordinateKey(topLevelNsId, modelName))
            ?.tableName,
      ),
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
        diagnostics.push({
          code: 'PSL_VALUE_SET_NAME_COLLISION',
          message: `namespace "${defaultNamespaceId}": name "${name}" is declared both as a domain enum and as an extension entity that derives a value-set; rename one`,
          sourceId,
        });
      }
    }
  }

  // No checkpoint here: this pass runs early so `namespaceExtensionEntities` is
  // ready for field resolution. The checkpoint after field resolution catches
  // this pass's failures too.

  // Resolve scalar-refinement bindings ahead of alias/constructor bindings,
  // preserving the emission order the retired scalar/alias symbol-table split
  // induced — emitted artifacts stay byte-identical across that refactor.
  const isScalarRefinement = (symbol: NamedTypeSymbol): boolean =>
    !symbol.isConstructor &&
    symbol.baseType !== undefined &&
    input.scalarColumnDescriptors.has(symbol.baseType);
  const allNamedTypes = Object.values(topLevel.namedTypes);
  const namedTypeSymbols: readonly NamedTypeSymbol[] = [
    ...allNamedTypes.filter(isScalarRefinement),
    ...allNamedTypes.filter((symbol) => !isScalarRefinement(symbol)),
  ];

  const namedTypeResult = resolveNamedTypeDeclarations({
    declarations: namedTypeSymbols,
    sourceId,
    enumTypeDescriptors: allEnumTypeDescriptors,
    scalarColumnDescriptors: input.scalarColumnDescriptors,
    composedExtensions,
    familyId: input.target.familyId,
    targetId: input.target.targetId,
    authoringContributions: input.authoringContributions,
    diagnostics,
  });

  const storageTypes = { ...namedTypeResult.storageTypes };

  const modelMappingsByCoordinate = buildModelMappings(
    modelEntries,
    defaultNamespaceId,
    diagnostics,
    sourceId,
    sourceFile,
  );
  // Bare-name view for unqualified relation targets and polymorphism, where
  // resolution is by bare model name. When a bare name is shared across
  // namespaces this collapses to the last entry; qualified relation targets
  // and per-model lowering use the coordinate-keyed map above instead.
  const modelMappings = new Map<string, ModelNameMapping>();
  for (const mapping of modelMappingsByCoordinate.values()) {
    modelMappings.set(mapping.model.name, mapping);
  }
  const modelNodes: ModelNode[] = [];
  const fkRelationMetadata: FkRelationMetadata[] = [];
  const backrelationCandidates: ModelBackrelationCandidate[] = [];
  const modelResolvedFields = new Map<string, readonly ResolvedField[]>();
  // Cross-space relation nodes keyed by declaring model name — merged into
  // modelRelations after local back-relation matching so they bypass that step.
  const crossSpaceRelationsByModel = new Map<string, RelationNode[]>();
  // Entities lowered by contributed model attributes, keyed by namespace id
  // then attribute name then entity key — merged into `entries` alongside
  // `namespaceExtensionEntities` once every model has been processed.
  const modelAttributeEntitiesByNamespace = new Map<
    string,
    Record<string, Record<string, unknown>>
  >();

  for (const { model, namespaceId } of modelEntries) {
    const coordinate = modelCoordinateKey(namespaceId ?? defaultNamespaceId, model.name);
    const mapping = modelMappingsByCoordinate.get(coordinate);
    if (!mapping) {
      continue;
    }
    const result = buildModelNodeFromPsl({
      model,
      mapping,
      modelMappings,
      modelMappingsByCoordinate,
      modelNames,
      compositeTypeNames,
      enumTypeDescriptors: allEnumTypeDescriptors,
      namedTypeDescriptors: namedTypeResult.namedTypeDescriptors,
      composedExtensions,
      composedExtensionContracts,
      familyId: input.target.familyId,
      targetId: input.target.targetId,
      authoringContributions: input.authoringContributions,
      defaultFunctionRegistry,
      generatorDescriptorById,
      scalarColumnDescriptors: input.scalarColumnDescriptors,
      sourceId,
      sourceFile,
      symbolTable: input.symbolTable,
      diagnostics,
      modelNamespaceIds,
      ...(enumHandlesByName.size > 0 ? { enumHandles: enumHandlesByName } : {}),
      capabilities: input.capabilities,
      ...(namespaceExtensionEntities.size > 0 ? { namespaceExtensionEntities } : {}),
      ...ifDefined('codecLookup', input.codecLookup),
      modelAttributesByName,
      defaultNamespaceId,
    });
    modelNodes.push(
      namespaceId !== undefined ? { ...result.modelNode, namespaceId } : result.modelNode,
    );
    fkRelationMetadata.push(...result.fkRelationMetadata);
    backrelationCandidates.push(...result.backrelationCandidates);
    modelResolvedFields.set(coordinate, result.resolvedFields);
    if (result.crossSpaceRelations.length > 0) {
      const existing = crossSpaceRelationsByModel.get(model.name) ?? [];
      crossSpaceRelationsByModel.set(model.name, [...existing, ...result.crossSpaceRelations]);
    }
    if (Object.keys(result.modelAttributeEntities).length > 0) {
      const nsKey = namespaceId ?? defaultNamespaceId;
      const existingByAttribute = modelAttributeEntitiesByNamespace.get(nsKey) ?? {};
      for (const [attribute, keyed] of Object.entries(result.modelAttributeEntities)) {
        existingByAttribute[attribute] = { ...(existingByAttribute[attribute] ?? {}), ...keyed };
      }
      modelAttributeEntitiesByNamespace.set(nsKey, existingByAttribute);
    }
  }

  const { modelRelations, fkRelationsByPair, fkRelationsByDeclaringModel } = indexFkRelations({
    fkRelationMetadata,
  });
  const modelIdColumns = new Map<string, readonly string[]>();
  const modelUniqueColumnSets = new Map<string, readonly (readonly string[])[]>();
  for (const modelNode of modelNodes) {
    if (modelNode.id) {
      modelIdColumns.set(modelNode.modelName, modelNode.id.columns);
    }
    const uniqueColumnSets: (readonly string[])[] = [];
    if (modelNode.id) {
      uniqueColumnSets.push(modelNode.id.columns);
    }
    for (const unique of modelNode.uniques ?? []) {
      uniqueColumnSets.push(unique.columns);
    }
    modelUniqueColumnSets.set(modelNode.modelName, uniqueColumnSets);
  }
  applyBackrelationCandidates({
    backrelationCandidates,
    fkRelationsByPair,
    fkRelationsByDeclaringModel,
    modelIdColumns,
    modelUniqueColumnSets,
    modelRelations,
    diagnostics,
    sourceId,
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

  const { discriminatorDeclarations, baseDeclarations } = collectPolymorphismDeclarations(
    models,
    sourceFile,
    sourceId,
    diagnostics,
  );

  // A variant with `@@base` but no own `@@map` is single-table inheritance:
  // it shares the base table. (`@@map` ⇒ multi-table inheritance.) This is the
  // authoritative STI/MTI signal — the variant's resolved table name is not,
  // because a no-`@@map` STI variant still gets a `lowerFirst(name)` default
  // table name that differs from the base before `resolvePolymorphism` rewrites
  // it onto the base table.
  const stiVariantNames = new Set<string>();
  for (const variantName of baseDeclarations.keys()) {
    const variantMapping = modelMappings.get(variantName);
    const hasExplicitMap =
      variantMapping?.model.attributes.some((attr) => attr.name === 'map') ?? false;
    if (!hasExplicitMap) {
      stiVariantNames.add(variantName);
    }
  }

  // An STI variant shares its base model's storage table (see
  // `materializeStiVariantStorageColumns` below) and never gets a table of
  // its own, so a check declared on it has nowhere to attach — silently
  // dropping it at build time would defeat the whole point of `@@check`.
  // Catch it here, while the PSL source still has the `@@check` attribute's
  // span and the base model's name in hand.
  for (const variantName of stiVariantNames) {
    const variantMapping = modelMappings.get(variantName);
    if (variantMapping === undefined) continue;
    const baseDecl = baseDeclarations.get(variantName);
    invariant(
      baseDecl !== undefined,
      `stiVariantNames is derived from baseDeclarations.keys(), so "${variantName}" must have a base declaration`,
    );
    for (const attribute of variantMapping.model.node.attributes()) {
      if (attribute.name()?.isSimpleName('check') !== true) continue;
      diagnostics.push({
        code: PSL_CHECK_ON_STI_VARIANT,
        message: `Model "${variantName}" declares "@@check", but it shares its base model "${baseDecl.baseName}"'s storage table (single-table inheritance via @@base) and has no table of its own to declare a check constraint on. Declare the check on "${baseDecl.baseName}" instead.`,
        sourceId,
        span: nodePslSpan(attribute.syntax, sourceFile),
      });
    }
  }

  const { modelNodes: mtiLinkedModelNodes, syntheticPkFieldsByVariant } =
    materializeMtiVariantStorageLinks(modelNodes, baseDeclarations, stiVariantNames);
  const { modelNodes: stiColumnModelNodes, stiBaseFieldsByBase } =
    materializeStiVariantStorageColumns(mtiLinkedModelNodes, baseDeclarations, stiVariantNames);

  const valueObjects = buildValueObjects({
    compositeTypes,
    enumTypeDescriptors: allEnumTypeDescriptors,
    namedTypeDescriptors: namedTypeResult.namedTypeDescriptors,
    scalarColumnDescriptors: input.scalarColumnDescriptors,
    composedExtensions,
    familyId: input.target.familyId,
    targetId: input.target.targetId,
    authoringContributions: input.authoringContributions,
    diagnostics,
    sourceId,
  });

  if (diagnostics.length > 0) {
    return notOk({
      summary: 'PSL to SQL contract interpretation failed',
      diagnostics,
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

  const contract = buildSqlContractFromDefinition(
    {
      target: input.target,
      warnings: authoringWarnings.length > 0 ? authoringWarnings : undefined,
      ...ifDefined(
        'extensions',
        buildComposedExtensionPackRefs(
          input.target,
          [...composedExtensions].sort(compareStrings),
          input.composedExtensionPackRefs,
        ),
      ),
      ...(Object.keys(storageTypes).length > 0 ? { storageTypes } : {}),
      ...(Object.keys(validEnumHandles).length > 0 ? { enums: validEnumHandles } : {}),
      // A namespace that carries extension entities but no models (e.g.
      // `namespace unbound { role anon {} }`) would otherwise never enter
      // `SqlStorage.namespaces` — declare every entity-carrying coordinate;
      // model-derived coordinates dedupe downstream.
      ...(namespaceExtensionEntities.size > 0
        ? { namespaces: [...namespaceExtensionEntities.keys()] }
        : {}),
      createNamespace: createNamespaceWithExtensions,
      models: stiColumnModelNodes.map((model) => ({
        ...model,
        ...(modelRelations.has(model.modelName)
          ? {
              relations: [...(modelRelations.get(model.modelName) ?? [])].sort((left, right) =>
                compareStrings(left.fieldName, right.fieldName),
              ),
            }
          : {}),
      })),
    },
    input.codecLookup,
  );

  // Include namespace in patch keys so same bare model names across namespaces
  // stay distinct; same-coordinate duplicates were already collapsed first-wins.
  const modelsForPatch: Record<string, ContractModel> = {};
  for (const [namespaceId, namespaceSlice] of Object.entries(contract.domain.namespaces)) {
    for (const [modelName, model] of Object.entries(namespaceSlice.models)) {
      const coordinate = modelCoordinateKey(namespaceId, modelName);
      invariant(
        !Object.hasOwn(modelsForPatch, coordinate),
        `symbol table guarantees coordinate uniqueness; duplicate model "${namespaceId}.${modelName}" reached interpretation`,
      );
      modelsForPatch[coordinate] = model;
    }
  }
  let patchedModels = patchModelDomainFields(modelsForPatch, modelResolvedFields);

  const polyDiagnostics: ContractSourceDiagnostic[] = [];
  patchedModels = resolvePolymorphism(
    patchedModels,
    discriminatorDeclarations,
    baseDeclarations,
    modelNames,
    modelMappings,
    modelNamespaceIds,
    input.target.defaultNamespaceId,
    syntheticPkFieldsByVariant,
    stiBaseFieldsByBase,
    sourceId,
    polyDiagnostics,
  );

  if (polyDiagnostics.length > 0) {
    return notOk({
      summary: 'PSL to SQL contract interpretation failed',
      diagnostics: polyDiagnostics,
    });
  }

  const variantModelNames = new Set(baseDeclarations.keys());
  const filteredRoots = Object.fromEntries(
    Object.entries(contract.roots).filter(
      ([, crossReference]) => !variantModelNames.has(crossReference.model),
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
                patchedModels[modelCoordinateKey(namespaceId, modelName)] ?? model,
              ]),
            ),
            ...ifDefined('enum', namespaceSlice.enum),
            ...ifDefined('valueObjects', namespaceSlice.valueObjects),
            ...(namespaceId === input.target.defaultNamespaceId &&
            Object.keys(valueObjects).length > 0
              ? { valueObjects }
              : {}),
          },
        ]),
      ),
    },
  };

  return ok(patchedContract);
}
