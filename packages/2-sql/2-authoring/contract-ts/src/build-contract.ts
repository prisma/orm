import {
  computeExecutionHash,
  computeProfileHash,
  computeStorageHash,
} from '@internal/contract/hashing';
import {
  asNamespaceId,
  type ColumnDefault,
  type Contract,
  type ContractEnum,
  type ContractField,
  type ContractModel,
  type ContractRelation,
  type ContractRelationThrough,
  type ContractValueObject,
  type CrossReference,
  coreHash,
  crossRef,
  type ExecutionMutationDefault,
  effectiveControlPolicy,
  type JsonValue,
  type StorageHashBase,
  type ValueSetRef,
} from '@internal/contract/types';
import {
  type CapabilityMatrix,
  type EnumTypeHandle,
  mergeCapabilityMatrices,
  resolveToOneRelationNullable,
} from '@internal/contract-authoring';
import type {
  AuthoringContributions,
  AuthoringEntityTypeDescriptor,
  AuthoringEntityTypeNamespace,
  AuthoringWarning,
} from '@internal/framework-components/authoring';
import {
  flushAuthoringWarnings,
  isAuthoringEntityTypeDescriptor,
} from '@internal/framework-components/authoring';
import {
  type Codec,
  type CodecLookup,
  type ColumnTypeDescriptor,
  materializeCodec,
} from '@internal/framework-components/codec';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { lowerAuthoredCheck } from '@internal/sql-contract/authored-check-naming';
import { sqlContractCanonicalizationHooks } from '@internal/sql-contract/canonicalization-hooks';
import { tableEntityKind, valueSetEntityKind } from '@internal/sql-contract/entity-kinds';
import {
  type ForeignKeyAuthoringInput,
  materializeForeignKeysAndIndexes,
} from '@internal/sql-contract/foreign-key-materialization';
import { type AuthoredIndexInput, lowerAuthoredIndex } from '@internal/sql-contract/index-naming';
import { validateIndexTypes } from '@internal/sql-contract/index-type-validation';
import {
  createIndexTypeRegistry,
  type IndexTypeMap,
  type IndexTypeRegistration,
} from '@internal/sql-contract/index-types';
import {
  applyFkDefaults,
  CheckConstraint,
  Index,
  type SqlNamespaceInput,
  SqlStorage,
  type SqlStorageInput,
  type StorageColumn,
  type StorageTableInput,
  type StorageTypeInstance,
  type StorageValueSetInput,
  toStorageTypeInstance,
} from '@internal/sql-contract/types';
import { validateStorageSemantics } from '@internal/sql-contract/validators';
import { deriveValueSetFromEntity } from '@internal/sql-contract/value-set-derivation-hook';
import {
  type CheckKind,
  composeCheckWirePrefix,
  computeCheckContentHash,
  derivedCheckPrefixes,
} from '@internal/sql-schema-ir/naming';
import { invariant } from '@internal/utils/assertions';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import type {
  AuthoredColumnDefault,
  ContractDefinition,
  FieldNode,
  ModelNode,
  RelationNode,
  ValueObjectFieldNode,
} from './contract-definition';
import { contractError } from './contract-errors';
import { toOneNullabilityContradictionMessage } from './to-one-nullability-message';

type DomainFieldRef =
  | { readonly kind: 'scalar'; readonly many?: boolean }
  | { readonly kind: 'valueObject'; readonly name: string; readonly many?: boolean };

/**
 * The codec that encodes one column's default. Built with the column's own `typeParams`, because a
 * parameterized codec answers for its params when it encodes — `pg/vector@1` checks the length its
 * column declares — and the lookup's representative instance carries none. Only a column has params;
 * every other encode site takes the representative instance.
 */
function columnCodec(
  codecId: string,
  typeParams: Record<string, unknown> | undefined,
  codecLookup?: CodecLookup,
): Codec | undefined {
  const descriptor = codecLookup?.descriptorFor?.(codecId);
  if (descriptor === undefined) return codecLookup?.get(codecId);
  return materializeCodec(
    descriptor,
    {
      codecId,
      ...ifDefined(
        'typeParams',
        typeParams === undefined
          ? undefined
          : blindCast<JsonValue, 'typeParams are validated by the codec paramsSchema'>(typeParams),
      ),
    },
    { name: codecId },
  );
}

function encodeViaCodec(value: unknown, codec: Codec | undefined): JsonValue {
  if (codec) {
    return codec.encodeJson(value);
  }
  return blindCast<
    JsonValue,
    'no codec lookup at build time: literal/enum member value is already JSON-safe'
  >(value);
}

function encodeColumnDefault(
  defaultInput: AuthoredColumnDefault,
  codec: Codec | undefined,
  many = false,
): ColumnDefault {
  if (defaultInput.kind === 'function') {
    return { kind: 'function', expression: defaultInput.expression };
  }
  if ('canonical' in defaultInput && defaultInput.canonical === true) {
    return {
      kind: 'literal',
      value: blindCast<
        ColumnDefault extends { kind: 'literal'; value: infer V } ? V : never,
        'a text contract source stores the canonical form its data type produced'
      >(defaultInput.value),
    };
  }
  if (many) {
    if (!Array.isArray(defaultInput.value)) {
      throw new InternalError(
        `Literal default on a list column must be an array; received ${typeof defaultInput.value}. ` +
          'A scalar default on a list field must be rejected at the authoring surface.',
      );
    }
    return {
      kind: 'literal',
      value: defaultInput.value.map((element) => encodeViaCodec(element, codec)),
    };
  }
  return {
    kind: 'literal',
    value: encodeViaCodec(defaultInput.value, codec),
  };
}

function assertStorageSemantics(
  definition: ContractDefinition,
  contract: Contract<SqlStorage>,
): void {
  const semanticErrors = validateStorageSemantics(contract.storage);
  if (semanticErrors.length > 0) {
    throw contractError(
      'CONTRACT.VALIDATION_FAILED',
      `Contract semantic validation failed: ${semanticErrors.join('; ')}`,
      { meta: { errors: semanticErrors } },
    );
  }

  const indexTypeRegistry = createIndexTypeRegistry();
  const packsToRegister: ReadonlyArray<{ readonly id?: string; readonly indexTypes?: unknown }> = [
    definition.target,
    ...Object.values(definition.extensions ?? {}),
  ];
  for (const pack of packsToRegister) {
    const registration = pack.indexTypes;
    if (registration === undefined) continue;
    if (
      typeof registration !== 'object' ||
      registration === null ||
      !Array.isArray((registration as { entries?: unknown }).entries)
    ) {
      throw contractError(
        'CONTRACT.PACK_CONTRIBUTION_INVALID',
        `Pack "${pack.id ?? '<unknown>'}" declares "indexTypes" but its value is not an IndexTypeRegistration (expected an object with an "entries" array; got ${typeof registration}).`,
        { meta: { packId: pack.id, contribution: 'indexTypes', reason: 'invalid-shape' } },
      );
    }
    for (const entry of (registration as IndexTypeRegistration<IndexTypeMap>).entries) {
      indexTypeRegistry.register(entry);
    }
  }
  validateIndexTypes(contract, indexTypeRegistry);
}

function assertKnownTargetModel(
  modelsByName: ReadonlyMap<string, ModelNode>,
  modelsByCoordinate: ReadonlyMap<string, ModelNode>,
  sourceModelName: string,
  targetModelName: string,
  targetNamespaceId: string | undefined,
  context: string,
): ModelNode {
  const targetModel =
    targetNamespaceId !== undefined && targetNamespaceId.length > 0
      ? modelsByCoordinate.get(`${targetNamespaceId}:${targetModelName}`)
      : modelsByName.get(targetModelName);
  if (!targetModel) {
    const qualified =
      targetNamespaceId !== undefined && targetNamespaceId.length > 0
        ? `${targetNamespaceId}.${targetModelName}`
        : targetModelName;
    throw contractError(
      'CONTRACT.MODEL_UNKNOWN',
      `${context} on model "${sourceModelName}" references unknown model "${qualified}"`,
      { meta: { sourceModel: sourceModelName, targetModel: qualified, context } },
    );
  }
  return targetModel;
}

function assertTargetTableMatches(
  sourceModelName: string,
  targetModel: ModelNode,
  referencedTableName: string,
  context: string,
): void {
  if (targetModel.tableName !== referencedTableName) {
    throw contractError(
      'CONTRACT.TABLE_MISMATCH',
      `${context} on model "${sourceModelName}" references table "${referencedTableName}" but model "${targetModel.modelName}" maps to "${targetModel.tableName}"`,
      {
        meta: {
          sourceModel: sourceModelName,
          referencedTable: referencedTableName,
          mappedTable: targetModel.tableName,
          context,
        },
      },
    );
  }
}

function isValueObjectField(
  field: FieldNode | ValueObjectFieldNode,
): field is ValueObjectFieldNode {
  return 'valueObjectName' in field;
}

/**
 * Resolves a deferred entity-ref column descriptor (e.g. a `pg.enum(handle)`
 * column) against the field's now-known owning namespace: attaches the
 * storage `valueSet` ref the collected entity's derived value-set is stored
 * under. `nativeType` / `typeParams.typeName` stay bare here — schema
 * qualification (e.g. `auth.aal_level`) is a target concern applied in the
 * next step, `qualifyColumnDescriptor`. A descriptor with no `entityRef` (the
 * ordinary case) passes through unchanged.
 */
function resolveEntityRefDescriptor(
  descriptor: ColumnTypeDescriptor,
  namespaceId: string,
): ColumnTypeDescriptor {
  const entityRef = descriptor.entityRef;
  if (entityRef === undefined) return descriptor;

  return {
    ...descriptor,
    valueSet: {
      plane: 'storage',
      entityKind: 'valueSet',
      namespaceId,
      entityName: entityRef.entityName,
    },
  };
}

/**
 * A target's contract-construction-time column-type qualifier, contributed
 * through `target.authoring.qualifyColumnType`. Given a column's bare type
 * info and its owning `namespaceId`, it returns the type info the target's
 * schema semantics require (e.g. Postgres schema-qualifies a native-enum
 * column's type name to `auth.aal_level`). The dispatch keys off the codec
 * id, so every codec — including ones needing no change — is passed through
 * and the caller stays codec-blind. Targets without the hook leave every
 * column bare.
 */
type ColumnTypeQualifier = (
  input: {
    readonly codecId: string;
    readonly nativeType: string;
    readonly typeParams?: Record<string, unknown>;
  },
  namespaceId: string,
) => { readonly nativeType: string; readonly typeParams?: Record<string, unknown> };

/**
 * Structural check for a target that contributes a `qualifyColumnType` hook
 * on its authoring contributions. Duck-typed (mirroring
 * `contract-psl`'s `hasColumnFromEntityHook`) so the SQL family stays blind
 * to the target's qualification logic and no framework/family interface has
 * to name the hook.
 */
function hasColumnTypeQualifier(
  authoring: AuthoringContributions,
): authoring is AuthoringContributions & { readonly qualifyColumnType: ColumnTypeQualifier } {
  return 'qualifyColumnType' in authoring && typeof authoring.qualifyColumnType === 'function';
}

/**
 * A target's contract-construction-time check renderer, contributed through
 * `target.authoring.renderCheckExpressions`. Given one column's shape it
 * returns the checks that column needs, each as a kind, the column it
 * constrains, and an opaque predicate body (no surrounding `CHECK (…)`). The
 * target owns the SQL — quoting, escaping, predicate choice — and nothing
 * else: naming is composed here, so the family never depends on a property of
 * text it cannot read. `memberValues` is
 * supplied only for a domain enum authored through an `enumType()` handle, so
 * a target cannot accidentally write a membership check for a column whose
 * native type already enforces its member set. Targets without the hook write
 * no checks.
 */
type CheckExpressionRenderer = (input: {
  readonly tableName: string;
  readonly columnName: string;
  readonly many: boolean;
  readonly memberValues: readonly (string | number)[] | undefined;
}) => ReadonlyArray<{
  readonly kind: 'membership' | 'elementNotNull';
  readonly columnName: string;
  readonly expression: string;
}>;

/**
 * Structural check for a target that contributes a `renderCheckExpressions`
 * hook, duck-typed for the same reason {@link hasColumnTypeQualifier} is: the
 * SQL family stays blind to the target's predicate syntax.
 */
function hasCheckExpressionRenderer(
  authoring: AuthoringContributions,
): authoring is AuthoringContributions & {
  readonly renderCheckExpressions: CheckExpressionRenderer;
} {
  return (
    'renderCheckExpressions' in authoring && typeof authoring.renderCheckExpressions === 'function'
  );
}

function resolveCheckExpressionRenderer(
  target: ContractDefinition['target'],
): CheckExpressionRenderer | undefined {
  const authoring = target.authoring;
  if (authoring === undefined) return undefined;
  return hasCheckExpressionRenderer(authoring) ? authoring.renderCheckExpressions : undefined;
}

/**
 * The member values a membership check must enforce, encoded exactly as the
 * column stores them. Membership predicates support strings and finite numbers.
 */
function checkMemberValues(
  handle: EnumTypeHandle,
  codecLookup: CodecLookup | undefined,
): readonly (string | number)[] {
  const encoded = handle.values.map((value) =>
    encodeViaCodec(value, codecLookup?.get(handle.codecId)),
  );
  const values: (string | number)[] = [];
  for (const value of encoded) {
    if (typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value))) {
      throw contractError(
        'CONTRACT.ENUM_INVALID',
        `enumType("${handle.enumName}"): CHECK constraint members must encode to strings or finite numbers.`,
        { meta: { enumName: handle.enumName, reason: 'unsupported-member-value' } },
      );
    }
    if (typeof value !== typeof encoded[0]) {
      throw contractError(
        'CONTRACT.ENUM_INVALID',
        `enumType("${handle.enumName}"): CHECK constraint members must encode to the same primitive type; mixed strings and numbers are not supported.`,
        { meta: { enumName: handle.enumName, reason: 'mixed-member-types' } },
      );
    }
    values.push(value);
  }
  return values;
}

/**
 * Resolves a field's authored `noCheck` kinds against its column shape:
 * the bare form (`[]`) becomes every kind the shape derives, and a named
 * kind that can never apply to the shape is an authoring error
 * (`CONTRACT.CHECK_OPTOUT_INVALID`). Returns the concrete kinds in
 * canonical ascending order — the only form the contract persists.
 */
function resolveNoCheckKinds(input: {
  readonly modelName: string;
  readonly fieldName: string;
  readonly kinds: readonly CheckKind[];
  readonly many: boolean;
  readonly isDomainEnum: boolean;
}): readonly CheckKind[] {
  const derivable: CheckKind[] = [];
  if (input.many) derivable.push('elementNotNull');
  if (input.isDomainEnum) derivable.push('membership');
  const subject = `Field "${input.modelName}.${input.fieldName}"`;
  const meta = { modelName: input.modelName, fieldName: input.fieldName };

  if (input.kinds.length === 0) {
    if (derivable.length === 0) {
      throw contractError(
        'CONTRACT.CHECK_OPTOUT_INVALID',
        `${subject}: noCheck() waives nothing — this column's shape derives no generated checks.`,
        { meta: { ...meta, reason: 'no-derivable-checks' } },
      );
    }
    return derivable;
  }

  const seen = new Set<CheckKind>();
  for (const kind of input.kinds) {
    if (seen.has(kind)) {
      throw contractError(
        'CONTRACT.CHECK_OPTOUT_INVALID',
        `${subject}: noCheck("${kind}") names the same kind twice.`,
        { meta: { ...meta, kind, reason: 'duplicate-kind' } },
      );
    }
    seen.add(kind);
    if (!derivable.includes(kind)) {
      const explanation =
        kind === 'membership'
          ? 'membership checks are derived only from enumType() value sets'
          : 'element-non-null checks are derived only for list columns';
      throw contractError(
        'CONTRACT.CHECK_OPTOUT_INVALID',
        `${subject}: noCheck("${kind}") does not apply — ${explanation}.`,
        { meta: { ...meta, kind, reason: 'inapplicable-kind' } },
      );
    }
  }
  return [...input.kinds].sort();
}

/**
 * Names the target's rendered checks and lowers them into contract entities.
 *
 * Naming is composed family-side ({@link composeCheckWirePrefix}) rather than
 * by the target, and suffixed with the predicate's content hash. Composing
 * family-side is what makes the truncation safe — two prefixes that truncate
 * alike still differ in their hashes, and the family can see that the
 * (table, column, kind) triple they were built from is unique per table,
 * rather than having to assume something about SQL text it declares itself
 * unable to read.
 */
function lowerRenderedChecks(
  tableName: string,
  candidates: ReadonlyArray<{
    readonly kind: 'membership' | 'elementNotNull';
    readonly columnName: string;
    readonly expression: string;
  }>,
): CheckConstraint[] {
  return candidates.map(
    (candidate) =>
      new CheckConstraint({
        naming: {
          kind: 'wire',
          prefix: composeCheckWirePrefix(tableName, candidate.columnName, candidate.kind),
          hash: computeCheckContentHash(candidate.expression),
        },
        expression: candidate.expression,
      }),
  );
}

function resolveColumnTypeQualifier(
  target: ContractDefinition['target'],
): ColumnTypeQualifier | undefined {
  const authoring = target.authoring;
  if (authoring === undefined) return undefined;
  return hasColumnTypeQualifier(authoring) ? authoring.qualifyColumnType : undefined;
}

/**
 * Applies the target's `qualifyColumnType` hook to a scalar column descriptor
 * at construction, so the storage column and the domain field (which derives
 * its `type.typeParams` from the storage column) are both built already
 * qualified in a single pass. A descriptor whose codec the target leaves
 * unchanged passes through untouched.
 */
function qualifyColumnDescriptor(
  descriptor: ColumnTypeDescriptor,
  namespaceId: string,
  qualify: ColumnTypeQualifier | undefined,
): ColumnTypeDescriptor {
  if (qualify === undefined) return descriptor;
  const qualified = qualify(
    {
      codecId: descriptor.codecId,
      nativeType: descriptor.nativeType,
      ...ifDefined('typeParams', descriptor.typeParams),
    },
    namespaceId,
  );
  if (
    qualified.nativeType === descriptor.nativeType &&
    qualified.typeParams === descriptor.typeParams
  ) {
    return descriptor;
  }
  return {
    ...descriptor,
    nativeType: qualified.nativeType,
    ...ifDefined('typeParams', qualified.typeParams),
  };
}

type CollectedColumnEntities = Record<string, Record<string, Record<string, unknown>>>;

/**
 * Records a deferred column's entity-ref into the namespace-scoped collection
 * accumulator (`namespaceId → entityKind → entityName`) — folded into the same
 * namespace assembly `deriveEntityValueSets`/`entries.<kind>` step as the
 * entities-channel attachments, so a column-collected entity gets its
 * value-set the same way an entities-channel one does.
 *
 * The same handle reused by many columns in one namespace is normal (a native
 * enum type backs any number of columns) and records the identical entity once.
 * Two *different* entity instances sharing a name+kind in one namespace is a
 * name collision — the emitted `entries.valueSet.<name>` could only reflect one
 * of them, silently mismatching the other column's type/cast. PSL hard-errors
 * on the equivalent (`PSL_DUPLICATE_DECLARATION`); the TS path rejects it too.
 */
function collectEntityFromColumn(
  collected: CollectedColumnEntities,
  namespaceId: string,
  entityRef: NonNullable<ColumnTypeDescriptor['entityRef']>,
): void {
  const forNs = collected[namespaceId] ?? {};
  const forKind = forNs[entityRef.entityKind] ?? {};
  const existing = forKind[entityRef.entityName];
  if (existing !== undefined && existing !== entityRef.entity) {
    throw contractError(
      'CONTRACT.NAME_DUPLICATE',
      `buildSqlContractFromDefinition: two different "${entityRef.entityKind}" entities named "${entityRef.entityName}" in namespace "${namespaceId}" — pack-entity names must be unique per namespace.`,
      { meta: { kind: entityRef.entityKind, name: entityRef.entityName, namespaceId } },
    );
  }
  forKind[entityRef.entityName] = entityRef.entity;
  forNs[entityRef.entityKind] = forKind;
  collected[namespaceId] = forNs;
}

/**
 * Merges a namespace's entities-channel attachments (lowered from the
 * `entities` handle list, carried on `ContractDefinition.attachedEntities`)
 * with the entities collected from that namespace's deferred entity-ref
 * columns. A column-collected entity that shadows a *different* attached
 * entity of the same kind+name (or vice-versa) is the same name-collision bug
 * `collectEntityFromColumn` guards against across columns, so it is rejected
 * the same way — by entity identity, so the same handle attached and used by
 * a column does not throw.
 */
function mergeColumnAndAttachedEntities(
  namespaceId: string,
  attached: Readonly<Record<string, Readonly<Record<string, unknown>>>> | undefined,
  columnCollected: Readonly<Record<string, Readonly<Record<string, unknown>>>> | undefined,
): Readonly<Record<string, Readonly<Record<string, unknown>>>> | undefined {
  if (attached === undefined) return columnCollected;
  if (columnCollected === undefined) return attached;
  const kinds = new Set([...Object.keys(attached), ...Object.keys(columnCollected)]);
  const result: Record<string, Readonly<Record<string, unknown>>> = {};
  for (const kind of kinds) {
    const attachedForKind = attached[kind];
    const columnForKind = columnCollected[kind];
    for (const [name, entity] of Object.entries(columnForKind ?? {})) {
      const existing = attachedForKind?.[name];
      if (existing !== undefined && existing !== entity) {
        throw contractError(
          'CONTRACT.NAME_DUPLICATE',
          `buildSqlContractFromDefinition: two different "${kind}" entities named "${name}" in namespace "${namespaceId}" — a column-referenced entity conflicts with an attached one; pack-entity names must be unique per namespace.`,
          { meta: { kind, name, namespaceId } },
        );
      }
    }
    result[kind] = { ...attachedForKind, ...columnForKind };
  }
  return result;
}

const JSONB_CODEC_ID = 'pg/jsonb@1';
const JSONB_NATIVE_TYPE = 'jsonb';

function resolveModelNamespaceId(
  model: ModelNode,
  modelNameToNamespaceId: ReadonlyMap<string, string>,
  defaultNamespaceId: string,
): string {
  if (model.namespaceId !== undefined && model.namespaceId.length > 0) {
    return model.namespaceId;
  }
  return modelNameToNamespaceId.get(model.modelName) ?? defaultNamespaceId;
}

function toOneRelationNullable(semanticModel: ModelNode, relation: RelationNode): boolean {
  const location = `Relation "${semanticModel.modelName}.${relation.fieldName}"`;
  if (relation.nullable === undefined) {
    throw contractError(
      'CONTRACT.RELATION_INVALID',
      `${location} with cardinality "${relation.cardinality}" must state whether it is nullable`,
      {
        meta: {
          modelName: semanticModel.modelName,
          relationName: relation.fieldName,
          reason: 'to-one-nullability-missing',
        },
      },
    );
  }
  const localColumns = relation.on.parentColumns;
  const { contradiction } = resolveToOneRelationNullable({
    declaredNullable: relation.nullable,
    localFieldNullability: semanticModel.fields
      .filter((field) => localColumns.includes(field.columnName))
      .map((field) => field.nullable),
    ownsReference: relation.cardinality === 'N:1',
  });
  if (contradiction !== undefined) {
    throw contractError(
      'CONTRACT.RELATION_INVALID',
      relation.cardinality === 'N:1'
        ? toOneNullabilityContradictionMessage(location, contradiction)
        : `${location} is required but does not own the foreign key, so nothing in storage guarantees the related row exists`,
      {
        meta: {
          modelName: semanticModel.modelName,
          relationName: relation.fieldName,
          reason: 'to-one-nullability-mismatch',
        },
      },
    );
  }
  return relation.nullable;
}

function buildThroughDescriptor(
  through: NonNullable<RelationNode['through']>,
  tableNamespaceByName: ReadonlyMap<string, string>,
  targetModel: ModelNode,
  modelName: string,
  fieldName: string,
  defaultNamespaceId: string,
): ContractRelationThrough {
  if (!tableNamespaceByName.has(through.table)) {
    throw contractError(
      'CONTRACT.MODEL_UNKNOWN',
      `buildSqlContractFromDefinition: junction table "${through.table}" for relation "${modelName}.${fieldName}" is not a declared model.`,
      { meta: { sourceModel: modelName, relationName: fieldName, junctionTable: through.table } },
    );
  }
  // Junction table names are unique per namespace, not globally. Prefer the
  // junction's own declared namespace (carried on the through node); fall back to
  // the target's default namespace. Resolving by bare table name would pick the
  // wrong namespace when the same junction table name exists in two namespaces.
  const namespaceId = through.namespaceId ?? defaultNamespaceId;

  return {
    table: through.table,
    namespaceId,
    parentColumns: through.parentColumns,
    childColumns: through.childColumns,
    targetColumns: targetColumnsForJunction(targetModel, fieldName),
  };
}

function targetColumnsForJunction(targetModel: ModelNode, fieldName: string): readonly string[] {
  const primaryKeyColumns = targetModel.id?.columns;
  if (primaryKeyColumns && primaryKeyColumns.length > 0) {
    return primaryKeyColumns;
  }
  const firstUnique = targetModel.uniques?.find((u) => u.columns.length > 0);
  if (firstUnique) {
    return firstUnique.columns;
  }
  throw contractError(
    'CONTRACT.IDENTITY_INVALID',
    `M:N target model "${targetModel.modelName}" (relation field "${fieldName}") has no primary id or unique key to derive junction targetColumns.`,
    { meta: { modelName: targetModel.modelName, reason: 'no-key-for-junction-target-columns' } },
  );
}

function buildStorageColumn(
  field: FieldNode | ValueObjectFieldNode,
  storageValueSetRef: ValueSetRef | undefined,
  codecLookup?: CodecLookup,
): StorageColumn {
  if (isValueObjectField(field)) {
    const encodedDefault =
      field.default !== undefined
        ? encodeColumnDefault(field.default, codecLookup?.get(JSONB_CODEC_ID))
        : undefined;

    return {
      nativeType: JSONB_NATIVE_TYPE,
      codecId: JSONB_CODEC_ID,
      nullable: field.nullable,
      ...ifDefined('default', encodedDefault),
    };
  }

  const codecId = field.descriptor.codecId;
  const encodedDefault =
    field.default !== undefined
      ? encodeColumnDefault(
          field.default,
          columnCodec(codecId, field.descriptor.typeParams, codecLookup),
          field.many === true,
        )
      : undefined;

  // `storageValueSetRef` (derived from an `enumTypeHandle`) takes precedence
  // when present — the established domain-enum path. `field.descriptor.valueSet`
  // is the fallback: set by an entity-ref type constructor (e.g. `pg.enum(Ref)`)
  // that resolved the field's type against a value-set-deriving entity with no
  // domain enum involved. A field carries at most one of the two in practice.
  const valueSet = storageValueSetRef ?? field.descriptor.valueSet;

  return {
    nativeType: field.descriptor.nativeType,
    codecId,
    nullable: field.nullable,
    ...(field.many ? { many: true as const } : {}),
    ...(field.noCheck !== undefined ? { noCheck: [...field.noCheck].sort() } : {}),
    ...ifDefined('typeParams', field.descriptor.typeParams),
    ...ifDefined('default', encodedDefault),
    ...ifDefined('typeRef', field.descriptor.typeRef),
    ...ifDefined('valueSet', valueSet),
  };
}

function buildDomainField(
  field: FieldNode | ValueObjectFieldNode,
  column: StorageColumn,
  domainValueSetRef: ValueSetRef | undefined,
): ContractField {
  if (isValueObjectField(field)) {
    return {
      type: { kind: 'valueObject', name: field.valueObjectName },
      nullable: field.nullable,
      ...(field.many ? { many: true } : {}),
    };
  }

  return {
    type: {
      kind: 'scalar',
      codecId: column.codecId,
      ...ifDefined('typeParams', column.typeParams),
    },
    nullable: column.nullable,
    ...(field.many ? { many: true } : {}),
    ...ifDefined('valueSet', domainValueSetRef),
  };
}

function collectStorageNamespaceCoordinateIds(definition: ContractDefinition): Set<string> {
  const ids = new Set<string>();
  ids.add(definition.target.defaultNamespaceId);
  for (const id of definition.namespaces ?? []) {
    if (id.length > 0) {
      ids.add(id);
    }
  }
  for (const model of definition.models) {
    if (model.namespaceId !== undefined && model.namespaceId.length > 0) {
      ids.add(model.namespaceId);
    }
  }
  for (const id of Object.keys(definition.attachedEntities ?? {})) {
    if (id.length > 0) {
      ids.add(id);
    }
  }
  return ids;
}

/**
 * Entry kinds the framework assembler itself manages (`table` from models,
 * `valueSet` from `enums` and attached-entity value-set derivation). A
 * pack-attached entity claiming one of these would silently clobber or be
 * clobbered by the managed slot, so it is rejected outright.
 */
const MANAGED_ENTRY_KINDS = new Set([tableEntityKind.kind, valueSetEntityKind.kind]);

function assertNoManagedEntityKinds(
  namespaceId: string,
  entitiesForNs: Readonly<Record<string, unknown>> | undefined,
): void {
  if (entitiesForNs === undefined) return;
  for (const kind of Object.keys(entitiesForNs)) {
    if (MANAGED_ENTRY_KINDS.has(kind)) {
      throw contractError(
        'CONTRACT.ENTITY_KIND_INVALID',
        `buildSqlContractFromDefinition: attached entity in namespace "${namespaceId}" declares entry kind "${kind}", which is managed by the framework (table/valueSet) and cannot be attached.`,
        { meta: { entityKind: kind, namespaceId } },
      );
    }
  }
}

/**
 * Walks the flat `entityTypes` namespace tree contributed by the target pack
 * and every extension pack, indexing descriptors by their `discriminator` —
 * the same string a pack entity's entries-map key (`entries.<kind>`) uses.
 * Mirrors `contract-psl`'s `buildEntityTypesByDiscriminator`, recomposed here
 * from the packs `ContractDefinition` already carries (`target` +
 * `extensions`) since the TS assembler has no single pre-merged
 * `AuthoringContributions` input to read the way the PSL interpreter does.
 */
function collectEntityTypeDescriptorsByDiscriminator(
  definition: ContractDefinition,
): ReadonlyMap<string, AuthoringEntityTypeDescriptor> {
  const result = new Map<string, AuthoringEntityTypeDescriptor>();
  const walk = (namespace: AuthoringEntityTypeNamespace): void => {
    for (const value of Object.values(namespace)) {
      if (isAuthoringEntityTypeDescriptor(value)) {
        result.set(value.discriminator, value);
      } else {
        walk(value);
      }
    }
  };
  const components = [definition.target, ...Object.values(definition.extensions ?? {})];
  for (const component of components) {
    const entityTypes = component.authoring?.entityTypes;
    if (entityTypes !== undefined) {
      walk(entityTypes);
    }
  }
  return result;
}

/**
 * Derives value-sets for every pack entity declared in one namespace,
 * reusing the same `SqlValueSetDerivingEntityTypeOutput.deriveValueSet` hook
 * `contract-psl`'s `lowerExtensionBlocksForNamespace` folds into
 * `entries.valueSet` on the PSL path — so a TS-attached entity (e.g. a
 * native enum) gets its value-set the same way. Entity kinds with no
 * registered descriptor, or whose descriptor output doesn't derive a
 * value-set, contribute nothing.
 */
function deriveEntityValueSets(
  entitiesForNs: Readonly<Record<string, Readonly<Record<string, unknown>>>> | undefined,
  entityTypesByDiscriminator: ReadonlyMap<string, AuthoringEntityTypeDescriptor>,
): Record<string, StorageValueSetInput> | undefined {
  if (entitiesForNs === undefined) return undefined;
  let result: Record<string, StorageValueSetInput> | undefined;
  for (const [kind, entitiesByName] of Object.entries(entitiesForNs)) {
    const descriptor = entityTypesByDiscriminator.get(kind);
    if (descriptor === undefined) continue;
    for (const [name, entity] of Object.entries(entitiesByName)) {
      const derivedValueSet = deriveValueSetFromEntity(descriptor.output, entity);
      if (derivedValueSet === undefined) continue;
      result ??= {};
      result[name] = derivedValueSet;
    }
  }
  return result;
}

/**
 * Merges a namespace's `enumType()`-derived value-sets with its pack-entity-
 * derived value-sets. Both land in the same `entries.valueSet[name]` slot —
 * which drives value-set → codec typing and the domain-enum CHECK — so a
 * same-named entry in both would let one silently overwrite the other and
 * corrupt whichever column resolves against it. The same collision class the
 * `mergeColumnAndAttachedEntities` guard rejects; the PSL path already hard-errors
 * on the equivalent (`interpretPslDocumentToSqlContract`). Reject it here too.
 */
function mergeNamespaceValueSets(
  namespaceId: string,
  enumValueSets: Record<string, StorageValueSetInput> | undefined,
  packValueSets: Record<string, StorageValueSetInput> | undefined,
): Record<string, StorageValueSetInput> {
  if (enumValueSets !== undefined && packValueSets !== undefined) {
    for (const name of Object.keys(packValueSets)) {
      if (Object.hasOwn(enumValueSets, name)) {
        throw contractError(
          'CONTRACT.NAME_DUPLICATE',
          `buildSqlContractFromDefinition: value-set "${name}" in namespace "${namespaceId}" is derived from both an enum and a pack entity — names must be unique per namespace.`,
          { meta: { kind: 'valueSet', name, namespaceId } },
        );
      }
    }
  }
  return { ...enumValueSets, ...packValueSets };
}

function ensureUnboundNamespaceSlot(
  namespaces: SqlStorageInput['namespaces'],
  createNamespace: ContractDefinition['createNamespace'],
): SqlStorageInput['namespaces'] {
  if (Object.hasOwn(namespaces, UNBOUND_NAMESPACE_ID)) {
    return namespaces;
  }
  const unboundInput: SqlNamespaceInput = {
    id: UNBOUND_NAMESPACE_ID,
    entries: { table: {} },
  };
  const unbound = createNamespace(unboundInput);
  return {
    [UNBOUND_NAMESPACE_ID]: unbound,
    ...namespaces,
  };
}

const DERIVABLE_CHECK_KINDS: readonly CheckKind[] = ['membership', 'elementNotNull'];

/**
 * Which of `columnNames` could have produced `prefix` for some
 * {@link CheckKind} — the reverse of {@link derivedCheckPrefixes}, used only
 * to name the collision in `CONTRACT.CHECK_NAME_RESERVED`'s message. Callers
 * already know `prefix` is a member of `derivedCheckPrefixes(tableName,
 * columnNames)`, so the result is never empty.
 */
function columnsProducingCheckPrefix(
  tableName: string,
  columnNames: readonly string[],
  prefix: string,
): readonly string[] {
  return columnNames.filter((columnName) =>
    DERIVABLE_CHECK_KINDS.some(
      (kind) => composeCheckWirePrefix(tableName, columnName, kind) === prefix,
    ),
  );
}

export function buildSqlContractFromDefinition(
  definition: ContractDefinition,
  codecLookup?: CodecLookup,
): Contract<SqlStorage> {
  const target = definition.target.targetId;
  const defaultNamespaceId = definition.target.defaultNamespaceId;
  const qualifyColumnType = resolveColumnTypeQualifier(definition.target);
  const renderCheckExpressions = resolveCheckExpressionRenderer(definition.target);
  const targetFamily = 'sql';
  const resolveNamespaceId = (m: ModelNode): string =>
    m.namespaceId !== undefined && m.namespaceId.length > 0 ? m.namespaceId : defaultNamespaceId;
  const modelsByName = new Map(definition.models.map((m) => [m.modelName, m]));
  const tableNamespaceByName = new Map(
    definition.models.map((m) => [
      m.tableName,
      m.namespaceId !== undefined && m.namespaceId.length > 0 ? m.namespaceId : defaultNamespaceId,
    ]),
  );
  const modelsByCoordinate = new Map(
    definition.models.map((m) => [`${resolveNamespaceId(m)}:${m.modelName}`, m]),
  );

  const tablesByNamespace: Record<string, Record<string, StorageTableInput>> = {};
  // Warnings collect across the whole build (seeded with the definition
  // producer's) and flush once, threshold-batched by code.
  const authoringWarnings: AuthoringWarning[] = [...(definition.warnings ?? [])];
  const modelNameToNamespaceId = new Map<string, string>();
  const executionDefaults: ExecutionMutationDefault[] = [];
  const modelsByNamespace: Record<string, Record<string, ContractModel>> = {};
  const collectedColumnEntities: CollectedColumnEntities = {};
  const rootEntries: Array<{
    readonly tableName: string;
    readonly namespaceId: string;
    readonly ref: CrossReference;
  }> = [];

  for (const semanticModel of definition.models) {
    const tableName = semanticModel.tableName;
    const namespaceId =
      semanticModel.namespaceId !== undefined && semanticModel.namespaceId.length > 0
        ? semanticModel.namespaceId
        : defaultNamespaceId;
    modelNameToNamespaceId.set(semanticModel.modelName, namespaceId);
    // STI variants share the base table; the base model already owns this
    // table name and its root, so the variant contributes neither.
    if (!semanticModel.sharesBaseTable) {
      rootEntries.push({
        tableName,
        namespaceId,
        ref: crossRef(semanticModel.modelName, namespaceId),
      });
    }

    // --- Build storage table ---

    const columns: Record<string, StorageColumn> = {};
    const fieldToColumn: Record<string, string> = {};
    const domainFields: Record<string, ContractField> = {};
    const domainFieldRefs: Record<string, DomainFieldRef> = {};
    const checksForTable: CheckConstraint[] = [];
    // Enforcement is derived only for tables Prisma 8 owns: the contract
    // describes an external schema, it does not prescribe enforcement for it.
    // This reads the policy the source declares; a policy applied by a contract
    // specifier lands after the build and is handled by
    // `stripDerivedChecksFromNonManagedTables`.
    const derivesChecks =
      effectiveControlPolicy(semanticModel.control, definition.defaultControlPolicy) === 'managed';

    for (const field of semanticModel.fields) {
      const executionDefaultPhases =
        field.executionDefaults?.onCreate || field.executionDefaults?.onUpdate
          ? field.executionDefaults
          : undefined;
      if (executionDefaultPhases) {
        if (field.default !== undefined) {
          throw contractError(
            'CONTRACT.DEFAULT_INVALID',
            `Field "${semanticModel.modelName}.${field.fieldName}" cannot define both default and executionDefaults.`,
            {
              meta: {
                modelName: semanticModel.modelName,
                fieldName: field.fieldName,
                reason: 'default-and-executionDefaults',
              },
            },
          );
        }
        if (field.nullable) {
          throw contractError(
            'CONTRACT.DEFAULT_INVALID',
            `Field "${semanticModel.modelName}.${field.fieldName}" cannot be nullable when executionDefaults are present.`,
            {
              meta: {
                modelName: semanticModel.modelName,
                fieldName: field.fieldName,
                reason: 'nullable-with-executionDefaults',
              },
            },
          );
        }
      }

      const enumHandle = !isValueObjectField(field) ? field.enumTypeHandle : undefined;
      // Authored enums are always registered under the contract's defaultNamespaceId
      // (see the enum registration loop below), so refs must point there regardless
      // of which namespace the consuming model lives in.
      const storageValueSetRef: ValueSetRef | undefined =
        enumHandle !== undefined
          ? {
              plane: 'storage',
              entityKind: 'valueSet',
              namespaceId: defaultNamespaceId,
              entityName: enumHandle.enumName,
            }
          : undefined;
      const domainValueSetRef: ValueSetRef | undefined =
        enumHandle !== undefined
          ? {
              plane: 'domain',
              entityKind: 'enum',
              namespaceId: defaultNamespaceId,
              entityName: enumHandle.enumName,
            }
          : undefined;

      // A field authored through a deferred entity-ref column helper (e.g.
      // `pg.enum(handle)`) carries `descriptor.entityRef`: the referenced
      // entity is collected into `collectedColumnEntities` (folded into the
      // same `entries.<kind>` + `entries.valueSet` assembly an entities-channel
      // attachment goes through) and the descriptor is resolved
      // against this field's now-known `namespaceId` — the builder call that
      // produced it ran before the enclosing model associated one. The
      // descriptor is then handed to the target's `qualifyColumnType` hook,
      // which schema-qualifies a native-enum column's type name for its
      // namespace. Keying off the codec id (inside the hook) catches both the
      // TS `pg.enum(handle)` path (via `entityRef`) and the PSL `pg.enum(Ref)`
      // path (resolved inline in the interpreter, no `entityRef`). Because the
      // storage column is built from this qualified descriptor and the domain
      // field derives its `type.typeParams` from that column, both come out
      // qualified in this single pass.
      let resolvedField: FieldNode | ValueObjectFieldNode = field;
      if (!isValueObjectField(field)) {
        let descriptor = field.descriptor;
        const entityRef = descriptor.entityRef;
        if (entityRef !== undefined) {
          collectEntityFromColumn(collectedColumnEntities, namespaceId, entityRef);
          descriptor = resolveEntityRefDescriptor(descriptor, namespaceId);
        }
        descriptor = qualifyColumnDescriptor(descriptor, namespaceId, qualifyColumnType);
        if (descriptor !== field.descriptor) {
          resolvedField = { ...field, descriptor };
        }
      }

      if (!isValueObjectField(resolvedField) && resolvedField.noCheck !== undefined) {
        const { noCheck: authoredNoCheck, ...withoutNoCheck } = resolvedField;
        // A non-`managed` table derives no checks, so an opt-out there is a
        // tolerated no-op (never persisted): policy may also be stamped
        // post-build by a specifier, and erroring here would make
        // pack-stamped contracts order-dependent.
        resolvedField = derivesChecks
          ? {
              ...withoutNoCheck,
              noCheck: resolveNoCheckKinds({
                modelName: semanticModel.modelName,
                fieldName: field.fieldName,
                kinds: authoredNoCheck,
                many: resolvedField.many === true,
                isDomainEnum: enumHandle !== undefined,
              }),
            }
          : withoutNoCheck;
      }

      const column = buildStorageColumn(resolvedField, storageValueSetRef, codecLookup);
      columns[field.columnName] = column;
      fieldToColumn[field.fieldName] = field.columnName;

      // Member values reach the renderer only on the `enumType()` handle
      // path: that column is a plain scalar (`text`, `int4`, …) with no
      // native type of its own to enforce membership. A value set resolved by
      // an entity-ref type constructor (`field.descriptor.valueSet`, e.g.
      // `pg.enum(Ref)`) binds the column to a codec/native-type pairing that
      // IS the storage-level enforcement — including array columns, since the
      // target enforces membership on every element of a native-typed array.
      if (renderCheckExpressions !== undefined && derivesChecks) {
        const waivedKinds = !isValueObjectField(resolvedField) ? resolvedField.noCheck : undefined;
        checksForTable.push(
          ...lowerRenderedChecks(
            tableName,
            renderCheckExpressions({
              tableName,
              columnName: field.columnName,
              many: column.many === true,
              memberValues:
                enumHandle !== undefined ? checkMemberValues(enumHandle, codecLookup) : undefined,
            }).filter((candidate) => !(waivedKinds?.includes(candidate.kind) ?? false)),
          ),
        );
      }

      domainFields[field.fieldName] = buildDomainField(field, column, domainValueSetRef);

      if (isValueObjectField(field)) {
        domainFieldRefs[field.fieldName] = {
          kind: 'valueObject',
          name: field.valueObjectName,
          ...(field.many ? { many: true } : {}),
        };
      } else if (field.many) {
        domainFieldRefs[field.fieldName] = { kind: 'scalar', many: true };
      }

      if (executionDefaultPhases) {
        executionDefaults.push({
          ref: { namespace: namespaceId, table: tableName, column: field.columnName },
          ...ifDefined('onCreate', executionDefaultPhases.onCreate),
          ...ifDefined('onUpdate', executionDefaultPhases.onUpdate),
        });
      }
    }

    const authoringForeignKeys: readonly ForeignKeyAuthoringInput[] = (
      semanticModel.foreignKeys ?? []
    ).map((fk) => {
      if (fk.references.spaceId !== undefined) {
        // Cross-space FK: the target lives in a different contract space.
        // Skip local model lookup and carry the spaceId coordinate through.
        const targetNamespaceId = fk.references.namespaceId ?? defaultNamespaceId;
        return {
          source: { namespaceId: asNamespaceId(namespaceId), tableName, columns: fk.columns },
          target: {
            namespaceId: asNamespaceId(targetNamespaceId),
            tableName: fk.references.table,
            columns: fk.references.columns,
            spaceId: fk.references.spaceId,
          },
          ...applyFkDefaults(
            {
              ...ifDefined('constraint', fk.constraint),
              ...ifDefined('index', fk.index),
            },
            definition.foreignKeyDefaults,
          ),
          ...ifDefined('name', fk.name),
          ...ifDefined('onDelete', fk.onDelete),
          ...ifDefined('onUpdate', fk.onUpdate),
        };
      }

      const targetModel = assertKnownTargetModel(
        modelsByName,
        modelsByCoordinate,
        semanticModel.modelName,
        fk.references.model,
        fk.references.namespaceId,
        'Foreign key',
      );
      assertTargetTableMatches(
        semanticModel.modelName,
        targetModel,
        fk.references.table,
        'Foreign key',
      );
      const targetNamespaceId =
        fk.references.namespaceId ??
        (targetModel.namespaceId !== undefined && targetModel.namespaceId.length > 0
          ? targetModel.namespaceId
          : defaultNamespaceId);
      return {
        source: { namespaceId: asNamespaceId(namespaceId), tableName, columns: fk.columns },
        target: {
          namespaceId: asNamespaceId(targetNamespaceId),
          tableName: fk.references.table,
          columns: fk.references.columns,
        },
        ...applyFkDefaults(
          {
            ...ifDefined('constraint', fk.constraint),
            ...ifDefined('index', fk.index),
          },
          definition.foreignKeyDefaults,
        ),
        ...ifDefined('name', fk.name),
        ...ifDefined('onDelete', fk.onDelete),
        ...ifDefined('onUpdate', fk.onUpdate),
      };
    });

    // STI variants share the base table: their columns are already
    // materialised onto the base `ModelNode`, so the variant builds a domain
    // model (below) but no storage table of its own — which leaves an
    // authored check nowhere to attach. Refuse it here as a backstop; the
    // PSL surface refuses it earlier, at interpretation, with a
    // span-anchored diagnostic that names the base model.
    if (semanticModel.sharesBaseTable && semanticModel.checks && semanticModel.checks.length > 0) {
      throw contractError(
        'CONTRACT.CHECK_ON_STI_VARIANT',
        `Model "${semanticModel.modelName}" declares a check constraint but shares its base model's storage table (single-table inheritance) and has no table of its own to declare it on. Declare the check on the base model instead.`,
        { meta: { tableName, modelName: semanticModel.modelName } },
      );
    }
    if (!semanticModel.sharesBaseTable) {
      const uniques = (semanticModel.uniques ?? []).map((u) => ({
        columns: u.columns,
        ...ifDefined('name', u.name),
      }));
      const declaredIndexes = (semanticModel.indexes ?? []).map((i) =>
        lowerAuthoredIndex(
          tableName,
          blindCast<
            AuthoredIndexInput,
            'the definition tree already carries both unions; the spread loses the correlation, and lowerAuthoredIndex re-checks at runtime'
          >({
            ...ifDefined('columns', i.columns),
            ...ifDefined('expression', i.expression),
            where: i.where,
            unique: i.unique,
            map: i.map,
            name: i.name,
            type: i.type,
            options: i.options,
          }),
          authoringWarnings,
        ),
      );
      // Authored checks are lowered and merged into `checksForTable`
      // unconditionally — outside the `derivesChecks` guard above. A derived
      // check is a Prisma 8 prescription, scoped to tables it manages; an
      // authored check is the author's own statement about a constraint they
      // know exists, and is emitted whatever the table's control policy.
      if (semanticModel.checks !== undefined && semanticModel.checks.length > 0) {
        const tableColumnNames = Object.keys(columns);
        const reservedCheckPrefixes = derivedCheckPrefixes(tableName, tableColumnNames);
        for (const authoredCheck of semanticModel.checks) {
          const lowered = lowerAuthoredCheck(tableName, authoredCheck, authoringWarnings);
          if (lowered.naming.kind === 'wire' && reservedCheckPrefixes.has(lowered.naming.prefix)) {
            const collidingColumns = columnsProducingCheckPrefix(
              tableName,
              tableColumnNames,
              lowered.naming.prefix,
            );
            const columnList = collidingColumns.map((name) => `"${name}"`).join(', ');
            throw contractError(
              'CONTRACT.CHECK_NAME_RESERVED',
              `Check "${lowered.naming.prefix}" on table "${tableName}": this name's prefix matches the shape a derived enforcement check would use for column${collidingColumns.length === 1 ? '' : 's'} ${columnList} of this table, so it can't be told apart from one. Choose a different name.`,
              { meta: { tableName, prefix: lowered.naming.prefix, collidingColumns } },
            );
          }
          checksForTable.push(new CheckConstraint(lowered));
        }
      }
      const primaryKey = semanticModel.id
        ? { columns: semanticModel.id.columns, ...ifDefined('name', semanticModel.id.name) }
        : undefined;
      // FK1: lower each FK's `constraint`/`index` authoring intent into
      // discrete persisted entities here — the one place a table's full
      // constraint context (its own declared indexes/uniques/primary key)
      // is available. A `constraint: false` FK contributes no
      // `foreignKeys[]` entry; an `index: true` FK not already backed by a
      // declared index/unique/primary-key contributes a named `indexes[]`
      // entry. This authoring pipeline is shared by both the TS DSL and the
      // PSL interpreter (which calls `buildSqlContractFromDefinition`
      // directly), so both authoring surfaces materialize identically.
      const { foreignKeys, indexes } = materializeForeignKeysAndIndexes(
        tableName,
        authoringForeignKeys,
        declaredIndexes,
        uniques,
        primaryKey,
      );

      const tableInput: StorageTableInput = {
        columns,
        ...ifDefined('control', semanticModel.control),
        uniques,
        // Constructed here rather than left as input: the `table` entity
        // kind's hydration tells an authored index from a stored one by
        // whether it is already an Index.
        indexes: indexes.map((i) => new Index(i)),
        foreignKeys,
        ...(primaryKey ? { primaryKey } : {}),
        ...(checksForTable.length > 0 ? { checks: checksForTable } : {}),
      };

      let nsTables = tablesByNamespace[namespaceId];
      if (nsTables === undefined) {
        nsTables = {};
        tablesByNamespace[namespaceId] = nsTables;
      }
      if (nsTables[tableName] !== undefined) {
        throw contractError(
          'CONTRACT.NAME_DUPLICATE',
          `buildSqlContractFromDefinition: duplicate table "${tableName}" in namespace "${namespaceId}".`,
          { meta: { kind: 'table', name: tableName, namespaceId } },
        );
      }
      nsTables[tableName] = tableInput;
    }

    // --- Build contract model ---

    const storageFields: Record<string, { readonly column: string }> = {};
    for (const [fieldName, columnName] of Object.entries(fieldToColumn)) {
      storageFields[fieldName] = { column: columnName };
    }

    const columnToField = new Map(
      Object.entries(fieldToColumn).map(([field, col]) => [col, field]),
    );
    const modelRelations: Record<string, ContractRelation> = {};
    for (const relation of semanticModel.relations ?? []) {
      // Cross-space relations have `spaceId` set — the target model lives in
      // a different contract space, so skip local model lookup and validation.
      if (relation.spaceId !== undefined) {
        const targetNamespaceId = relation.namespaceId ?? defaultNamespaceId;
        modelRelations[relation.fieldName] = {
          to: crossRef(relation.toModel, targetNamespaceId, relation.spaceId),
          // Cross-space belongsTo relations are always N:1 (the FK-owning side).
          cardinality: 'N:1',
          nullable: toOneRelationNullable(semanticModel, relation),
          on: {
            localFields: relation.on.parentColumns.map((col) => columnToField.get(col) ?? col),
            // For cross-space targets the lowering carries field names directly
            // (no fieldToColumn map available for the remote model).
            targetFields: relation.on.childColumns,
          },
        };
        continue;
      }

      const targetModel = assertKnownTargetModel(
        modelsByName,
        modelsByCoordinate,
        semanticModel.modelName,
        relation.toModel,
        relation.toNamespaceId,
        'Relation',
      );
      invariant(
        relation.toTable !== undefined,
        `Relation "${semanticModel.modelName}.${relation.fieldName}" is local but carries no target table; only cross-space relations may leave it unset.`,
      );
      assertTargetTableMatches(semanticModel.modelName, targetModel, relation.toTable, 'Relation');

      const targetColumnToField = new Map(
        targetModel.fields.map((f) => [f.columnName, f.fieldName]),
      );

      const to = crossRef(
        relation.toModel,
        relation.toNamespaceId !== undefined && relation.toNamespaceId.length > 0
          ? relation.toNamespaceId
          : resolveModelNamespaceId(targetModel, modelNameToNamespaceId, defaultNamespaceId),
      );
      const on = {
        localFields: relation.on.parentColumns.map((col) => columnToField.get(col) ?? col),
        targetFields: relation.on.childColumns.map((col) => targetColumnToField.get(col) ?? col),
      };

      if (relation.cardinality === 'N:M') {
        if (!relation.through) {
          throw contractError(
            'CONTRACT.RELATION_INVALID',
            `Relation "${semanticModel.modelName}.${relation.fieldName}" with cardinality "N:M" requires through metadata`,
            {
              meta: {
                modelName: semanticModel.modelName,
                relationName: relation.fieldName,
                reason: 'many-to-many-missing-through',
              },
            },
          );
        }
        modelRelations[relation.fieldName] = {
          to,
          cardinality: 'N:M',
          on,
          through: buildThroughDescriptor(
            relation.through,
            tableNamespaceByName,
            targetModel,
            semanticModel.modelName,
            relation.fieldName,
            defaultNamespaceId,
          ),
        };
      } else if (relation.cardinality === '1:N') {
        modelRelations[relation.fieldName] = { to, cardinality: '1:N', on };
      } else {
        modelRelations[relation.fieldName] = {
          to,
          cardinality: relation.cardinality,
          nullable: toOneRelationNullable(semanticModel, relation),
          on,
        };
      }
    }

    let namespaceModels = modelsByNamespace[namespaceId];
    if (namespaceModels === undefined) {
      namespaceModels = {};
      modelsByNamespace[namespaceId] = namespaceModels;
    }
    namespaceModels[semanticModel.modelName] = {
      storage: {
        table: tableName,
        namespaceId,
        fields: storageFields,
      },
      fields: domainFields,
      relations: modelRelations,
    };
  }

  // --- Assemble contract ---

  // Aggregate roots are keyed by bare storage table name. When two models in
  // different namespaces map to the same bare table name, the bare key would
  // collide (last write wins, silently dropping a root), so those entries fall
  // back to a namespace-qualified key. Single-namespace contracts never
  // collide and keep their bare keys unchanged.
  const rootTableNameCounts = new Map<string, number>();
  for (const entry of rootEntries) {
    rootTableNameCounts.set(entry.tableName, (rootTableNameCounts.get(entry.tableName) ?? 0) + 1);
  }
  const roots: Record<string, CrossReference> = {};
  for (const entry of rootEntries) {
    const key =
      (rootTableNameCounts.get(entry.tableName) ?? 0) > 1
        ? `${entry.namespaceId}.${entry.tableName}`
        : entry.tableName;
    roots[key] = entry.ref;
  }

  // Normalise raw codec-triple inputs to the `kind: 'codec-instance'`
  // discriminator shape before hashing so the storageHash matches the
  // persisted JSON envelope produced from the SqlStorage class instance
  // (which always carries the discriminator).
  const rawStorageTypes = definition.storageTypes ?? {};
  const documentTypes: Record<string, StorageTypeInstance> = Object.fromEntries(
    Object.entries(rawStorageTypes).map(([name, entry]) => {
      if ((entry as { kind?: unknown }).kind === 'codec-instance') return [name, entry];
      return [
        name,
        toStorageTypeInstance({
          codecId: entry.codecId,
          nativeType: entry.nativeType,
          typeParams: (entry as { typeParams?: Record<string, unknown> }).typeParams ?? {},
        }),
      ];
    }),
  );
  const namespaceCoordinateIds = collectStorageNamespaceCoordinateIds(definition);

  // Build per-namespace registries for `enumType()` handles.
  // All authored enums target the contract's default namespace.
  const domainEnumsByNs: Record<string, Record<string, ContractEnum>> = {};
  const storageValueSetsByNs: Record<string, Record<string, StorageValueSetInput>> = {};
  for (const [enumName, handle] of Object.entries(definition.enums ?? {})) {
    if (enumName !== handle.enumName) {
      throw contractError(
        'CONTRACT.ENUM_INVALID',
        `enum declaration key "${enumName}" must match enumType name "${handle.enumName}". Aliases are not supported.`,
        {
          meta: {
            enumName: handle.enumName,
            declarationKey: enumName,
            reason: 'key-name-mismatch',
          },
        },
      );
    }
    const nsId = defaultNamespaceId;
    let domainSlot = domainEnumsByNs[nsId];
    if (domainSlot === undefined) {
      domainSlot = {};
      domainEnumsByNs[nsId] = domainSlot;
    }
    domainSlot[enumName] = {
      codecId: handle.codecId,
      members: handle.enumMembers.map((m) => ({
        name: m.name,
        value: encodeViaCodec(m.value, codecLookup?.get(handle.codecId)),
      })),
    };

    let storageSlot = storageValueSetsByNs[nsId];
    if (storageSlot === undefined) {
      storageSlot = {};
      storageValueSetsByNs[nsId] = storageSlot;
    }
    storageSlot[enumName] = {
      kind: 'valueSet',
      values: handle.values.map((v) => encodeViaCodec(v, codecLookup?.get(handle.codecId))),
    };
  }

  const { createNamespace } = definition;
  const entityTypesByDiscriminator = collectEntityTypeDescriptorsByDiscriminator(definition);
  const namespaces: SqlStorageInput['namespaces'] = Object.fromEntries(
    [...namespaceCoordinateIds].sort().map((id) => {
      const entitiesForNs = mergeColumnAndAttachedEntities(
        id,
        definition.attachedEntities?.[id],
        collectedColumnEntities[id],
      );
      assertNoManagedEntityKinds(id, entitiesForNs);

      const enumValueSetEntries = storageValueSetsByNs[id];
      const packValueSetEntries = deriveEntityValueSets(entitiesForNs, entityTypesByDiscriminator);
      const valueSetEntries =
        enumValueSetEntries !== undefined || packValueSetEntries !== undefined
          ? mergeNamespaceValueSets(id, enumValueSetEntries, packValueSetEntries)
          : undefined;

      const nsInput: SqlNamespaceInput = {
        id,
        entries: {
          table: tablesByNamespace[id] ?? {},
          ...entitiesForNs,
          ...(valueSetEntries !== undefined && Object.keys(valueSetEntries).length > 0
            ? { valueSet: valueSetEntries }
            : {}),
        },
      };
      return [id, createNamespace(nsInput)];
    }),
  );
  const storageWithoutHash = {
    ...(Object.keys(documentTypes).length > 0 ? { types: documentTypes } : {}),
    namespaces:
      defaultNamespaceId === UNBOUND_NAMESPACE_ID
        ? ensureUnboundNamespaceSlot(namespaces, createNamespace)
        : namespaces,
  };
  const storageHash: StorageHashBase<string> = definition.storageHash
    ? coreHash(definition.storageHash)
    : computeStorageHash({
        target,
        targetFamily,
        storage: storageWithoutHash as Record<string, unknown>,
        ...sqlContractCanonicalizationHooks,
      });
  const storage = new SqlStorage({ ...storageWithoutHash, storageHash });

  const executionSection =
    executionDefaults.length > 0
      ? {
          mutations: {
            defaults: executionDefaults.sort((a, b) => {
              const tableCompare = a.ref.table.localeCompare(b.ref.table);
              if (tableCompare !== 0) {
                return tableCompare;
              }
              return a.ref.column.localeCompare(b.ref.column);
            }),
          },
        }
      : undefined;

  const extensionNamespaces = definition.extensions
    ? Object.values(definition.extensions).map((pack) => pack.id)
    : undefined;

  const extensions: Record<string, unknown> = { ...(definition.extensions || {}) };
  if (extensionNamespaces) {
    for (const namespace of extensionNamespaces) {
      if (!Object.hasOwn(extensions, namespace)) {
        extensions[namespace] = {};
      }
    }
  }

  const extensionPackCapabilitySources = definition.extensions
    ? Object.values(definition.extensions).map(
        (pack) => pack.capabilities as CapabilityMatrix | undefined,
      )
    : [];
  const capabilities = mergeCapabilityMatrices(
    definition.target.capabilities as CapabilityMatrix | undefined,
    ...extensionPackCapabilitySources,
  );
  // Internal `profileHash` computation is unchanged from `origin/main`: it
  // continues to fingerprint the author-declared capability subset. With
  // `capabilities` removed from the `defineContract` input that subset is
  // now always empty, so the hash naturally stabilises at `hash({})`.
  const profileHash = computeProfileHash({
    target,
    targetFamily,
    capabilities: {},
  });

  const executionWithHash = executionSection
    ? {
        ...executionSection,
        executionHash: computeExecutionHash({ target, targetFamily, execution: executionSection }),
      }
    : undefined;

  const valueObjects: Record<string, ContractValueObject> | undefined =
    definition.valueObjects && definition.valueObjects.length > 0
      ? Object.fromEntries(
          definition.valueObjects.map((vo) => [
            vo.name,
            {
              fields: Object.fromEntries(
                vo.fields.map((f) => [
                  f.fieldName,
                  isValueObjectField(f)
                    ? {
                        type: { kind: 'valueObject' as const, name: f.valueObjectName },
                        nullable: f.nullable,
                        ...(f.many ? { many: true } : {}),
                      }
                    : {
                        type: {
                          kind: 'scalar' as const,
                          codecId: f.descriptor.codecId,
                          ...ifDefined('typeParams', f.descriptor.typeParams),
                        },
                        nullable: f.nullable,
                      },
                ]),
              ),
            },
          ]),
        )
      : undefined;

  const domainNamespaceIds = new Set(Object.keys(modelsByNamespace));
  if (domainNamespaceIds.size === 0) {
    domainNamespaceIds.add(defaultNamespaceId);
  }
  if (valueObjects !== undefined) {
    domainNamespaceIds.add(defaultNamespaceId);
  }
  for (const nsId of Object.keys(domainEnumsByNs)) {
    domainNamespaceIds.add(nsId);
  }
  const domainNamespaces = Object.fromEntries(
    [...domainNamespaceIds].sort().map((namespaceId) => {
      const modelsInNs = modelsByNamespace[namespaceId] ?? {};
      const enumsInNs = domainEnumsByNs[namespaceId];
      const namespaceSlice = {
        models: modelsInNs,
        ...(namespaceId === defaultNamespaceId && valueObjects !== undefined
          ? { valueObjects }
          : {}),
        ...(enumsInNs !== undefined && Object.keys(enumsInNs).length > 0
          ? { enum: enumsInNs }
          : {}),
      };
      return [namespaceId, namespaceSlice];
    }),
  );

  const contract: Contract<SqlStorage> = {
    target,
    targetFamily,
    ...ifDefined('defaultControlPolicy', definition.defaultControlPolicy),
    domain: { namespaces: domainNamespaces },
    roots,
    storage,
    ...(executionWithHash ? { execution: executionWithHash } : {}),
    extensions,
    capabilities,
    profileHash,
    meta: {},
  };

  assertStorageSemantics(definition, contract);
  flushAuthoringWarnings(authoringWarnings);

  return contract;
}
