import type { ControlPolicy } from '@internal/contract/types';
import type { ForeignKeyDefaultsState } from '@internal/contract-authoring';
import type { CodecLookup } from '@internal/framework-components/codec';
import type {
  ExtensionPackRef,
  FamilyPackRef,
  TargetPackRef,
} from '@internal/framework-components/components';
import type { PackEntityHandle } from '@internal/sql-contract/entity-handle-lowering-hook';
import type {
  SqlNamespaceBase,
  SqlNamespaceInput,
  StorageTypeInstance,
} from '@internal/sql-contract/types';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { buildSqlContractFromDefinition } from './build-contract';
import {
  type ComposedAuthoringHelpers,
  createComposedAuthoringHelpers,
} from './composed-authoring-helpers';
import {
  type ContractInput,
  type ContractModelBuilder,
  check,
  extensionModel,
  field,
  isContractInput,
  type ModelAttributesSpec,
  model,
  type RelationBuilder,
  type RelationState,
  rel,
  type ScalarFieldBuilder,
  type SqlStageSpec,
} from './contract-dsl';
import { contractError } from './contract-errors';
import { buildContractDefinition } from './contract-lowering';
import type { SqlContractResult } from './contract-types';
import type { EnumTypeHandle } from './enum-type';

export { buildSqlContractFromDefinition } from './build-contract';

type ModelLike = {
  readonly stageOne: {
    readonly modelName?: string;
    readonly namespace?: string;
    readonly fields: Record<string, ScalarFieldBuilder>;
    readonly relations: Record<string, RelationBuilder<RelationState>>;
  };
  readonly __attributes: ModelAttributesSpec | undefined;
  readonly __sql: SqlStageSpec | undefined;
  readonly __duplicateNames: undefined;
  buildAttributesSpec(): ModelAttributesSpec | undefined;
  buildSqlSpec(): SqlStageSpec | undefined;
};

type ContractDefinition<
  Family extends FamilyPackRef<string>,
  Target extends TargetPackRef<'sql', string>,
  Types extends Record<string, StorageTypeInstance>,
  Models extends Record<string, ModelLike>,
  Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
  Naming extends ContractInput['naming'] | undefined,
  StorageHash extends string | undefined,
  ForeignKeyDefaults extends ForeignKeyDefaultsState | undefined,
  Namespaces extends readonly string[] | undefined = undefined,
  Enums extends Record<string, EnumTypeHandle> = Record<string, EnumTypeHandle>,
> = {
  readonly family: Family;
  readonly target: Target;
  readonly extensions?: Extensions;
  readonly naming?: Naming;
  readonly storageHash?: StorageHash;
  readonly foreignKeyDefaults?: ForeignKeyDefaults;
  readonly defaultControlPolicy?: ControlPolicy;
  readonly namespaces?: Namespaces;
  readonly createNamespace: (input: SqlNamespaceInput) => SqlNamespaceBase;
  readonly types?: Types;
  readonly models?: Models;
  readonly codecLookup?: CodecLookup;
  readonly enums?: Enums;
  readonly entities?: readonly PackEntityHandle[];
};

type ContractScaffold<
  Family extends FamilyPackRef<string>,
  Target extends TargetPackRef<'sql', string>,
  Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
  Naming extends ContractInput['naming'] | undefined,
  StorageHash extends string | undefined,
  ForeignKeyDefaults extends ForeignKeyDefaultsState | undefined,
  Namespaces extends readonly string[] | undefined = undefined,
  Enums extends Record<string, EnumTypeHandle> = Record<string, EnumTypeHandle>,
> = {
  readonly family: Family;
  readonly target: Target;
  readonly extensions?: Extensions;
  readonly naming?: Naming;
  readonly storageHash?: StorageHash;
  readonly foreignKeyDefaults?: ForeignKeyDefaults;
  readonly defaultControlPolicy?: ControlPolicy;
  readonly namespaces?: Namespaces;
  readonly createNamespace: (input: SqlNamespaceInput) => SqlNamespaceBase;
  readonly types?: never;
  readonly models?: never;
  readonly codecLookup?: CodecLookup;
  readonly enums?: Enums;
  readonly entities?: readonly PackEntityHandle[];
};

type ContractFactory<
  Family extends FamilyPackRef<string>,
  Target extends TargetPackRef<'sql', string>,
  Types extends Record<string, StorageTypeInstance>,
  Models extends Record<string, ModelLike>,
  Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
  Enums extends Record<string, EnumTypeHandle> = Record<string, EnumTypeHandle>,
> = (helpers: ComposedAuthoringHelpers<Family, Target, Extensions>) => {
  readonly types?: Types;
  readonly models?: Models;
  readonly enums?: Enums;
  readonly entities?: readonly PackEntityHandle[];
};

function validateTargetPackRef(
  family: FamilyPackRef<string>,
  target: TargetPackRef<'sql', string>,
): void {
  if (family.familyId !== 'sql') {
    throw contractError(
      'CONTRACT.PACK_FAMILY_MISMATCH',
      `defineContract only accepts SQL family packs. Received family "${family.familyId}".`,
      { meta: { packId: family.id, packFamilyId: family.familyId, contractFamilyId: 'sql' } },
    );
  }

  if (target.familyId !== family.familyId) {
    throw contractError(
      'CONTRACT.PACK_FAMILY_MISMATCH',
      `target pack "${target.id}" targets family "${target.familyId}" but contract family is "${family.familyId}".`,
      {
        meta: {
          packId: target.id,
          packFamilyId: target.familyId,
          contractFamilyId: family.familyId,
        },
      },
    );
  }
}

/**
 * Per-target reserved namespace names enforced by `defineContract` for
 * SQL family contracts. Two categories:
 *
 * 1. **IR sentinels** (`__unbound__`, `__unspecified__`) — reserved on
 *    every SQL target. The double-underscore decoration marks them as
 *    framework-reserved coordinates; user code must not declare them
 *    explicitly.
 * 2. **Target-specific PSL keywords** — Postgres reserves the bare
 *    `unbound` identifier for the late-binding opt-in
 *    (`namespace unbound { … }`) so the TS surface must reject it from
 *    `defineContract({ namespaces })` lists. SQLite has no schema
 *    concept and rejects every non-empty namespaces list outright;
 *    callers should declare `namespaces: []` or omit the field.
 */
function validateNamespaceDeclarations(
  target: TargetPackRef<'sql', string>,
  namespaces: readonly string[] | undefined,
): void {
  if (!namespaces) {
    return;
  }

  if (target.targetId === 'sqlite' && namespaces.length > 0) {
    throw contractError(
      'CONTRACT.NAMESPACE_UNSUPPORTED',
      `defineContract: SQLite contracts cannot declare namespaces (SQLite has no schema concept; emitted DDL is always unqualified). Received namespaces: [${namespaces
        .map((name) => `"${name}"`)
        .join(', ')}].`,
      { meta: { namespaces, targetId: target.targetId } },
    );
  }

  const seen = new Set<string>();
  for (const namespace of namespaces) {
    if (namespace.length === 0) {
      throw contractError(
        'CONTRACT.NAMESPACE_INVALID',
        'defineContract: namespace names cannot be empty.',
        { meta: { namespace, reason: 'empty' } },
      );
    }
    if (namespace.trim().length === 0) {
      throw contractError(
        'CONTRACT.NAMESPACE_INVALID',
        `defineContract: namespace name "${namespace}" cannot be whitespace-only.`,
        { meta: { namespace, reason: 'whitespace-only' } },
      );
    }
    if (namespace === '__unbound__' || namespace === '__unspecified__') {
      throw contractError(
        'CONTRACT.NAMESPACE_INVALID',
        `defineContract: namespace name "${namespace}" is a reserved IR sentinel and cannot appear in the declared namespaces list.`,
        { meta: { namespace, reason: 'reserved-ir-sentinel' } },
      );
    }
    if (target.targetId === 'postgres' && namespace === 'unbound') {
      throw contractError(
        'CONTRACT.NAMESPACE_INVALID',
        `defineContract: namespace name "unbound" is reserved by Postgres for the late-binding opt-in (use \`namespace unbound { … }\` in PSL instead of declaring it as a regular schema).`,
        { meta: { namespace, reason: 'reserved-by-postgres' } },
      );
    }
    if (seen.has(namespace)) {
      throw contractError(
        'CONTRACT.NAME_DUPLICATE',
        `defineContract: namespaces list contains duplicate entry "${namespace}".`,
        { meta: { kind: 'namespace', name: namespace } },
      );
    }
    seen.add(namespace);
  }
}

/**
 * Per-model `namespace` validation paired with
 * {@link validateNamespaceDeclarations}. Mirrors the reserved-name
 * rules so the per-model surface stays consistent with the contract-
 * level surface:
 *
 * - `__unbound__` / `__unspecified__` — reserved IR sentinels on
 *   every SQL target.
 * - `unbound` on Postgres — reserved for the PSL
 *   `namespace unbound { … }` opt-in.
 *
 * Additionally enforces that each per-model `namespace` either
 * references an entry in the contract's declared `namespaces` list or
 * names the Postgres late-binding keyword (`unbound`) — the latter is
 * not a "declared namespace" but is a legal opt-in only via PSL today,
 * so the TS surface also rejects it on the per-model side and points
 * authors at the PSL `namespace unbound { … }` block.
 *
 * The SQLite per-model `namespace` field is rejected outright (SQLite
 * has no schema concept).
 */
function validatePerModelNamespaces(
  target: TargetPackRef<'sql', string>,
  namespaces: readonly string[] | undefined,
  models: Record<string, ModelLike>,
): void {
  const declaredNamespaces = new Set<string>(namespaces ?? []);

  for (const [modelKey, modelBuilder] of Object.entries(models)) {
    const perModelNamespace = modelBuilder.stageOne.namespace;
    if (perModelNamespace === undefined) {
      continue;
    }

    if (target.targetId === 'sqlite') {
      throw contractError(
        'CONTRACT.NAMESPACE_UNSUPPORTED',
        `defineContract: model "${modelKey}" sets \`namespace: "${perModelNamespace}"\` but the target is SQLite (SQLite has no schema concept; remove the per-model \`namespace\` field).`,
        { meta: { modelKey, namespace: perModelNamespace, targetId: target.targetId } },
      );
    }

    if (perModelNamespace === '__unbound__' || perModelNamespace === '__unspecified__') {
      throw contractError(
        'CONTRACT.NAMESPACE_INVALID',
        `defineContract: model "${modelKey}" sets \`namespace: "${perModelNamespace}"\` but that name is a reserved IR sentinel and cannot appear in user code.`,
        { meta: { modelKey, namespace: perModelNamespace, reason: 'reserved-ir-sentinel' } },
      );
    }

    if (target.targetId === 'postgres' && perModelNamespace === 'unbound') {
      throw contractError(
        'CONTRACT.NAMESPACE_INVALID',
        `defineContract: model "${modelKey}" sets \`namespace: "unbound"\` but that name is reserved by Postgres for the late-binding opt-in (use \`namespace unbound { … }\` in PSL instead — there is no equivalent surface in the TS builder today).`,
        { meta: { modelKey, namespace: perModelNamespace, reason: 'reserved-by-postgres' } },
      );
    }

    if (!declaredNamespaces.has(perModelNamespace)) {
      const hint =
        declaredNamespaces.size > 0
          ? ` Declared namespaces: [${[...declaredNamespaces].map((name) => `"${name}"`).join(', ')}].`
          : ' The contract does not declare any namespaces; add `namespaces: ["…"]` to `defineContract` first.';
      throw contractError(
        'CONTRACT.NAMESPACE_UNKNOWN',
        `defineContract: model "${modelKey}" references namespace "${perModelNamespace}" but that name does not appear in the contract's declared \`namespaces\` list.${hint}`,
        { meta: { modelKey, namespace: perModelNamespace, declared: [...declaredNamespaces] } },
      );
    }
  }
}

function validateExtensionPackRefs(
  target: TargetPackRef<'sql', string>,
  extensions?: Record<string, ExtensionPackRef<'sql', string>>,
): void {
  if (!extensions) {
    return;
  }

  for (const packRef of Object.values(extensions)) {
    if (packRef.kind !== 'extension') {
      throw contractError(
        'CONTRACT.PACK_REF_INVALID',
        `defineContract only accepts extension pack refs in extensions. Received kind "${packRef.kind}".`,
        { meta: { packId: packRef.id, kind: packRef.kind } },
      );
    }

    if (packRef.familyId !== target.familyId) {
      throw contractError(
        'CONTRACT.PACK_FAMILY_MISMATCH',
        `extension pack "${packRef.id}" targets family "${packRef.familyId}" but contract target family is "${target.familyId}".`,
        {
          meta: {
            packId: packRef.id,
            packFamilyId: packRef.familyId,
            contractFamilyId: target.familyId,
          },
        },
      );
    }

    if (packRef.targetId && packRef.targetId !== target.targetId) {
      throw contractError(
        'CONTRACT.PACK_TARGET_MISMATCH',
        `extension pack "${packRef.id}" targets "${packRef.targetId}" but contract target is "${target.targetId}".`,
        {
          meta: {
            packId: packRef.id,
            packTargetId: packRef.targetId,
            contractTargetId: target.targetId,
          },
        },
      );
    }
  }
}

function buildContractFromDsl<Definition extends ContractInput>(
  definition: Definition,
): SqlContractResult<Definition> {
  validateTargetPackRef(definition.family, definition.target);
  validateExtensionPackRefs(definition.target, definition.extensions);
  validateNamespaceDeclarations(definition.target, definition.namespaces);
  validatePerModelNamespaces(
    definition.target,
    definition.namespaces,
    (definition.models ?? {}) as Record<string, ModelLike>,
  );

  return blindCast<
    SqlContractResult<Definition>,
    'buildSqlContractFromDefinition return type is wide; SqlContractResult conditional resolves correctly at runtime for any concrete Definition'
  >(buildSqlContractFromDefinition(buildContractDefinition(definition), definition.codecLookup));
}

// Input for buildBoundContract — all fields from ContractInput except family/target
// (those are injected by the builder, pre-bound at the call site).
type BoundDefinitionInput<
  Types extends Record<string, StorageTypeInstance> = Record<never, never>,
  Models extends Record<string, ModelLike> = Record<never, never>,
  Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined = undefined,
  Naming extends ContractInput['naming'] | undefined = undefined,
  StorageHash extends string | undefined = undefined,
  ForeignKeyDefaults extends ForeignKeyDefaultsState | undefined = undefined,
  Namespaces extends readonly string[] | undefined = undefined,
> = {
  readonly extensions?: Extensions;
  readonly naming?: Naming;
  readonly storageHash?: StorageHash;
  readonly foreignKeyDefaults?: ForeignKeyDefaults;
  readonly defaultControlPolicy?: ControlPolicy;
  readonly namespaces?: Namespaces;
  readonly createNamespace: (input: SqlNamespaceInput) => SqlNamespaceBase;
  readonly types?: Types;
  readonly models?: Models;
  readonly codecLookup?: CodecLookup;
  readonly enums?: Record<string, EnumTypeHandle>;
  readonly entities?: readonly PackEntityHandle[];
};

// A bare `Record<string, EnumTypeHandle>` (no literal keys) is the widened
// default for a side that declared no enums; drop it so the merge keeps only
// literally-authored enum handles.
type LiteralEnums<E extends Record<string, EnumTypeHandle>> = string extends keyof E
  ? Record<never, never>
  : E;

// Merges enum handles authored on the scaffold definition with those returned
// from the factory callback. Either side may be the widened default (empty).
export type MergeEnums<
  ScaffoldEnums extends Record<string, EnumTypeHandle>,
  FactoryEnums extends Record<string, EnumTypeHandle>,
> = LiteralEnums<ScaffoldEnums> & LiteralEnums<FactoryEnums>;

// Merges a bound input with the pre-bound family/target to produce a full ContractDefinition.
type WithFamilyTarget<
  Input,
  F extends FamilyPackRef<string>,
  T extends TargetPackRef<'sql', string>,
> = Input & { readonly family: F; readonly target: T };

/**
 * Shared builder that assembles a SqlContract with pre-bound family and target.
 * Extension wrappers keep their own public overloads and delegate their impl body here;
 * this is a plain overloaded function (not a factory returning an overloaded function)
 * so no overloaded-function-return cast is needed.
 *
 * Overload 1: definition form (no factory).
 */
export function buildBoundContract<
  const F extends FamilyPackRef<string>,
  const T extends TargetPackRef<'sql', string>,
  const Definition extends BoundDefinitionInput<
    Record<string, StorageTypeInstance>,
    Record<string, ModelLike>,
    Record<string, ExtensionPackRef<'sql', string>> | undefined,
    ContractInput['naming'] | undefined,
    string | undefined,
    ForeignKeyDefaultsState | undefined,
    readonly string[] | undefined
  >,
>(
  family: F,
  target: T,
  definition: Definition,
  factory?: undefined,
): SqlContractResult<WithFamilyTarget<Definition, F, T>>;
/**
 * Overload 2: factory form.
 */
export function buildBoundContract<
  const F extends FamilyPackRef<string>,
  const T extends TargetPackRef<'sql', string>,
  const Definition extends BoundDefinitionInput<
    Record<string, StorageTypeInstance>,
    Record<string, ModelLike>,
    Record<string, ExtensionPackRef<'sql', string>> | undefined,
    ContractInput['naming'] | undefined,
    string | undefined,
    ForeignKeyDefaultsState | undefined,
    readonly string[] | undefined
  >,
  const Built extends {
    readonly types?: Record<string, StorageTypeInstance>;
    readonly models?: Record<string, ModelLike>;
    readonly enums?: Record<string, EnumTypeHandle>;
    readonly entities?: readonly PackEntityHandle[];
  },
>(
  family: F,
  target: T,
  definition: Definition,
  factory: (
    helpers: ComposedAuthoringHelpers<F, T, NonNullable<Definition['extensions']>>,
  ) => Built,
): SqlContractResult<WithFamilyTarget<Definition & Built, F, T>>;
/** Implementation. */
export function buildBoundContract(
  family: FamilyPackRef<string>,
  target: TargetPackRef<'sql', string>,
  definition: Omit<ContractInput, 'family' | 'target'>,
  factory?:
    | ((
        helpers: ComposedAuthoringHelpers<
          FamilyPackRef<string>,
          TargetPackRef<'sql', string>,
          Record<string, ExtensionPackRef<'sql', string>> | undefined
        >,
      ) => {
        readonly types?: Record<string, StorageTypeInstance>;
        readonly models?: Record<string, ModelLike>;
        readonly enums?: Record<string, EnumTypeHandle>;
        readonly entities?: readonly PackEntityHandle[];
      })
    | undefined,
) {
  const full = { ...definition, family, target };

  if (factory !== undefined) {
    const built = factory(
      createComposedAuthoringHelpers({
        family,
        target,
        extensions: definition.extensions,
      }),
    );
    const mergedEnums = { ...(definition.enums ?? {}), ...built.enums };
    const mergedEntities = [...(definition.entities ?? []), ...(built.entities ?? [])];
    return buildContractFromDsl({
      ...full,
      ...ifDefined('types', built.types),
      ...ifDefined('models', built.models),
      ...ifDefined('enums', Object.keys(mergedEnums).length > 0 ? mergedEnums : undefined),
      ...ifDefined('entities', mergedEntities.length > 0 ? mergedEntities : undefined),
    });
  }

  return buildContractFromDsl(full);
}

export function defineContract<
  const Family extends FamilyPackRef<string>,
  const Target extends TargetPackRef<'sql', string>,
  const Types extends Record<string, StorageTypeInstance> = Record<never, never>,
  const Models extends Record<string, ModelLike> = Record<never, never>,
  const Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined = undefined,
  const Naming extends ContractInput['naming'] | undefined = undefined,
  const StorageHash extends string | undefined = undefined,
  const ForeignKeyDefaults extends ForeignKeyDefaultsState | undefined = undefined,
  const Namespaces extends readonly string[] | undefined = undefined,
  const Enums extends Record<string, EnumTypeHandle> = Record<string, EnumTypeHandle>,
>(
  definition: ContractDefinition<
    Family,
    Target,
    Types,
    Models,
    Extensions,
    Naming,
    StorageHash,
    ForeignKeyDefaults,
    Namespaces,
    Enums
  >,
): SqlContractResult<
  ContractDefinition<
    Family,
    Target,
    Types,
    Models,
    Extensions,
    Naming,
    StorageHash,
    ForeignKeyDefaults,
    Namespaces,
    Enums
  >
>;
export function defineContract<
  const Family extends FamilyPackRef<string>,
  const Target extends TargetPackRef<'sql', string>,
  const Types extends Record<string, StorageTypeInstance> = Record<never, never>,
  const Models extends Record<string, ModelLike> = Record<never, never>,
  const Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined = undefined,
  const Naming extends ContractInput['naming'] | undefined = undefined,
  const StorageHash extends string | undefined = undefined,
  const ForeignKeyDefaults extends ForeignKeyDefaultsState | undefined = undefined,
  const Namespaces extends readonly string[] | undefined = undefined,
  const ScaffoldEnums extends Record<string, EnumTypeHandle> = Record<string, EnumTypeHandle>,
  const FactoryEnums extends Record<string, EnumTypeHandle> = Record<string, EnumTypeHandle>,
>(
  definition: ContractScaffold<
    Family,
    Target,
    Extensions,
    Naming,
    StorageHash,
    ForeignKeyDefaults,
    Namespaces,
    ScaffoldEnums
  >,
  factory: ContractFactory<Family, Target, Types, Models, Extensions, FactoryEnums>,
): SqlContractResult<
  ContractDefinition<
    Family,
    Target,
    Types,
    Models,
    Extensions,
    Naming,
    StorageHash,
    ForeignKeyDefaults,
    Namespaces,
    MergeEnums<ScaffoldEnums, FactoryEnums>
  >
>;
export function defineContract(
  definition: ContractInput,
  factory?: ContractFactory<
    FamilyPackRef<string>,
    TargetPackRef<'sql', string>,
    Record<string, StorageTypeInstance>,
    Record<string, ModelLike>,
    Record<string, ExtensionPackRef<'sql', string>> | undefined
  >,
): SqlContractResult<ContractInput> {
  if (!isContractInput(definition)) {
    throw contractError(
      'CONTRACT.ARGUMENT_INVALID',
      'defineContract expects a contract definition object. Define your contract with defineContract({ family, target, models, ... }).',
    );
  }

  if (factory !== undefined) {
    return buildBoundContract(definition.family, definition.target, definition, factory);
  }
  return buildBoundContract(definition.family, definition.target, definition);
}

export type {
  ComposedAuthoringHelpers,
  ContractInput,
  ContractModelBuilder,
  ModelLike,
  ScalarFieldBuilder,
};
export { check, extensionModel, field, model, rel };
