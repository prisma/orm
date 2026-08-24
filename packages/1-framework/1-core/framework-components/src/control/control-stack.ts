import type { Contract, JsonValue } from '@internal/contract/types';
import { blindCast } from '@internal/utils/casts';
import { InternalError } from '@internal/utils/internal-error';
import type { AggregateDescriptor } from '../shared/aggregate-descriptor';
import { aggregateDescriptorKey, isAggregateDescriptor } from '../shared/aggregate-descriptor';
import type { CapabilityMatrix } from '../shared/capabilities';
import { mergeCapabilityMatrices } from '../shared/capabilities';
import type { Codec } from '../shared/codec';
import type { AnyCodecDescriptor } from '../shared/codec-descriptor';
import type { CodecLookup, CodecRef, CodecRegistry } from '../shared/codec-types';
import type {
  AuthoringContributions,
  AuthoringEntityTypeNamespace,
  AuthoringFieldNamespace,
  AuthoringModelAttributeDescriptorNamespace,
  AuthoringPslBlockDescriptorNamespace,
  AuthoringTypeNamespace,
} from '../shared/framework-authoring';
import {
  assertNoCrossRegistryCollisions,
  assertResolvableTypeConstructorTemplates,
  collectContributedDescriptorPaths,
  collectScalarTypeConstructors,
  mergeAuthoringNamespaces,
} from '../shared/framework-authoring';
import type { ComponentMetadata } from '../shared/framework-components';
import type {
  ControlMutationDefaultEntry,
  ControlMutationDefaults,
  MutationDefaultGeneratorDescriptor,
} from '../shared/mutation-default-types';
import {
  CONTRACT_CODEC_DESCRIPTOR_MISSING,
  materializeCodec,
  resolveCodecDescriptorOrThrow,
} from '../shared/resolve-codec';
import { runtimeError } from '../shared/runtime-error';
import type { TypesImportSpec } from '../shared/types-import-spec';
import type {
  ControlAdapterDescriptor,
  ControlDriverDescriptor,
  ControlExtensionDescriptor,
  ControlFamilyDescriptor,
  ControlTargetDescriptor,
} from './control-descriptors';

export interface AssembledAuthoringContributions {
  readonly field: AuthoringFieldNamespace;
  readonly type: AuthoringTypeNamespace;
  readonly entityTypes: AuthoringEntityTypeNamespace;
  readonly pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace;
  readonly modelAttributes: AuthoringModelAttributeDescriptorNamespace;
  /** The single {@link AuthoringContributions.valueObjectStorageType} declared across the composed components, validated at assembly against the merged `type` namespace. */
  readonly valueObjectStorageType?: string;
}

export interface ControlStack<
  TFamilyId extends string = string,
  TTargetId extends string = string,
> {
  readonly family: ControlFamilyDescriptor<TFamilyId>;
  readonly target: ControlTargetDescriptor<TFamilyId, TTargetId>;
  readonly adapter?: ControlAdapterDescriptor<TFamilyId, TTargetId> | undefined;
  readonly driver?: ControlDriverDescriptor<TFamilyId, TTargetId> | undefined;
  readonly extensions: readonly ControlExtensionDescriptor<TFamilyId, TTargetId>[];

  readonly extensionContracts: ReadonlyMap<string, Contract>;

  readonly codecTypeImports: ReadonlyArray<TypesImportSpec>;
  readonly queryOperationTypeImports: ReadonlyArray<TypesImportSpec>;
  readonly extensionIds: ReadonlyArray<string>;
  readonly codecLookup: CodecRegistry;
  /** Every codec descriptor the composed components contribute — the set an emitted type surface may resolve against, which is not always the set a target's own registry holds. */
  readonly codecDescriptors: ReadonlyArray<AnyCodecDescriptor>;
  /** Every aggregate overload the composed components declare, validated for shape and single ownership at assembly. */
  readonly aggregateDescriptors: ReadonlyArray<AggregateDescriptor>;
  readonly authoringContributions: AssembledAuthoringContributions;
  /** Names of the top-level zero-arg type constructors in the assembled authoring namespace — the base scalars of the composed stack. */
  readonly scalarTypes: ReadonlyArray<string>;
  readonly controlMutationDefaults: ControlMutationDefaults;
  readonly capabilities: CapabilityMatrix;
}

export interface CreateControlStackInput<
  TFamilyId extends string = string,
  TTargetId extends string = string,
> {
  readonly family: ControlFamilyDescriptor<TFamilyId>;
  readonly target: ControlTargetDescriptor<TFamilyId, TTargetId>;
  readonly adapter?: ControlAdapterDescriptor<TFamilyId, TTargetId> | undefined;
  readonly driver?: ControlDriverDescriptor<TFamilyId, TTargetId> | undefined;
  readonly extensions?: ReadonlyArray<ControlExtensionDescriptor<TFamilyId, TTargetId>> | undefined;
}

function addUniqueId(ids: string[], seen: Set<string>, id: string): void {
  if (!seen.has(id)) {
    ids.push(id);
    seen.add(id);
  }
}

export function assertUniqueCodecOwner(options: {
  readonly codecId: string;
  readonly owners: Map<string, string>;
  readonly descriptorId: string;
  readonly entityLabel: string;
  readonly entityOwnershipLabel: string;
}): void {
  const existingOwner = options.owners.get(options.codecId);
  if (existingOwner !== undefined) {
    throw new InternalError(
      `Duplicate ${options.entityLabel} for codecId "${options.codecId}". ` +
        `Descriptor "${options.descriptorId}" conflicts with "${existingOwner}". ` +
        `Each codecId can only have one ${options.entityOwnershipLabel}.`,
    );
  }
}

export function extractCodecTypeImports(
  descriptors: ReadonlyArray<Pick<ComponentMetadata, 'types'>>,
): ReadonlyArray<TypesImportSpec> {
  const imports: TypesImportSpec[] = [];

  for (const descriptor of descriptors) {
    const codecTypes = descriptor.types?.codecTypes;
    if (codecTypes?.import) {
      imports.push(codecTypes.import);
    }
    if (codecTypes?.typeImports) {
      imports.push(...codecTypes.typeImports);
    }
  }

  return imports;
}

export function extractQueryOperationTypeImports(
  descriptors: ReadonlyArray<Pick<ComponentMetadata, 'types'>>,
): ReadonlyArray<TypesImportSpec> {
  const imports: TypesImportSpec[] = [];

  for (const descriptor of descriptors) {
    const queryOperationTypes = descriptor.types?.queryOperationTypes;
    if (queryOperationTypes?.import) {
      imports.push(queryOperationTypes.import);
    }
  }

  return imports;
}

export function extractComponentIds(
  family: { readonly id: string },
  target: { readonly id: string },
  adapter: { readonly id: string } | undefined,
  extensions: ReadonlyArray<{ readonly id: string }>,
): ReadonlyArray<string> {
  const ids: string[] = [];
  const seen = new Set<string>();

  addUniqueId(ids, seen, family.id);
  addUniqueId(ids, seen, target.id);
  if (adapter) {
    addUniqueId(ids, seen, adapter.id);
  }

  for (const ext of extensions) {
    addUniqueId(ids, seen, ext.id);
  }

  return ids;
}

export function assembleAuthoringContributions(
  descriptors: ReadonlyArray<{ readonly id?: string; readonly authoring?: AuthoringContributions }>,
): AssembledAuthoringContributions {
  const field = {} as Record<string, unknown>;
  const type = {} as Record<string, unknown>;
  const entityTypes = {} as Record<string, unknown>;
  const pslBlockDescriptors: Record<string, unknown> = {};
  const modelAttributes: Record<string, unknown> = {};

  const pathOwners = new Map<string, string>();
  const claimContributedPaths = (
    namespace: Record<string, unknown>,
    descriptorKind: string,
    label: string,
    descriptorId: string,
  ): void => {
    for (const path of collectContributedDescriptorPaths(namespace, descriptorKind)) {
      const key = `${label}:${path}`;
      const existingOwner = pathOwners.get(key);
      if (existingOwner !== undefined) {
        throw new InternalError(
          `Duplicate authoring ${label} helper "${path}". ` +
            `Descriptor "${descriptorId}" conflicts with "${existingOwner}".`,
        );
      }
      pathOwners.set(key, descriptorId);
    }
  };

  let valueObjectStorageDeclaration:
    | { readonly name: string; readonly ownerId: string }
    | undefined;

  for (const descriptor of descriptors) {
    const descriptorId = descriptor.id ?? '<unknown>';
    const declaredValueObjectStorageType = descriptor.authoring?.valueObjectStorageType;
    if (declaredValueObjectStorageType !== undefined) {
      if (valueObjectStorageDeclaration !== undefined) {
        throw new InternalError(
          'Duplicate authoring valueObjectStorageType declaration. ' +
            `Descriptor "${descriptorId}" conflicts with "${valueObjectStorageDeclaration.ownerId}". ` +
            'Exactly one composed component may declare the value-object storage type.',
        );
      }
      valueObjectStorageDeclaration = {
        name: declaredValueObjectStorageType,
        ownerId: descriptorId,
      };
    }
    if (descriptor.authoring?.field) {
      claimContributedPaths(descriptor.authoring.field, 'fieldPreset', 'field', descriptorId);
      mergeAuthoringNamespaces(field, descriptor.authoring.field, [], 'fieldPreset', 'field');
    }
    if (descriptor.authoring?.type) {
      claimContributedPaths(descriptor.authoring.type, 'typeConstructor', 'type', descriptorId);
      assertResolvableTypeConstructorTemplates(descriptor.authoring.type, descriptorId);
      mergeAuthoringNamespaces(type, descriptor.authoring.type, [], 'typeConstructor', 'type');
    }
    if (descriptor.authoring?.entityTypes) {
      claimContributedPaths(descriptor.authoring.entityTypes, 'entity', 'entity', descriptorId);
      mergeAuthoringNamespaces(
        entityTypes,
        descriptor.authoring.entityTypes,
        [],
        'entity',
        'entity',
      );
    }
    if (descriptor.authoring?.pslBlockDescriptors) {
      claimContributedPaths(
        descriptor.authoring.pslBlockDescriptors,
        'pslBlock',
        'pslBlock',
        descriptorId,
      );
      mergeAuthoringNamespaces(
        pslBlockDescriptors,
        descriptor.authoring.pslBlockDescriptors,
        [],
        'pslBlock',
        'pslBlock',
      );
    }
    if (descriptor.authoring?.modelAttributes) {
      mergeAuthoringNamespaces(
        modelAttributes,
        descriptor.authoring.modelAttributes,
        [],
        'modelAttribute',
        'modelAttribute',
      );
    }
  }

  const fieldNamespace = field as AuthoringFieldNamespace;
  const typeNamespace = type as AuthoringTypeNamespace;
  const entityTypeNamespace = entityTypes as AuthoringEntityTypeNamespace;
  const pslBlockDescriptorNamespace = blindCast<
    AuthoringPslBlockDescriptorNamespace,
    'merge target accumulator narrows to typed namespace post-merge'
  >(pslBlockDescriptors);
  const modelAttributeNamespace = blindCast<
    AuthoringModelAttributeDescriptorNamespace,
    'merge target accumulator narrows to typed namespace post-merge'
  >(modelAttributes);
  assertNoCrossRegistryCollisions(
    typeNamespace,
    fieldNamespace,
    entityTypeNamespace,
    pslBlockDescriptorNamespace,
    modelAttributeNamespace,
  );

  if (
    valueObjectStorageDeclaration !== undefined &&
    !collectScalarTypeConstructors(typeNamespace).has(valueObjectStorageDeclaration.name)
  ) {
    throw new InternalError(
      `Invalid authoring valueObjectStorageType "${valueObjectStorageDeclaration.name}" declared by descriptor "${valueObjectStorageDeclaration.ownerId}". ` +
        'The name must be a top-level bare-eligible type constructor in the assembled authoring namespace.',
    );
  }

  return {
    field: fieldNamespace,
    type: typeNamespace,
    entityTypes: entityTypeNamespace,
    pslBlockDescriptors: pslBlockDescriptorNamespace,
    modelAttributes: modelAttributeNamespace,
    ...(valueObjectStorageDeclaration !== undefined
      ? { valueObjectStorageType: valueObjectStorageDeclaration.name }
      : {}),
  };
}

export function assembleControlMutationDefaults(
  descriptors: ReadonlyArray<
    Pick<ComponentMetadata, 'controlMutationDefaults'> & { readonly id?: string }
  >,
): ControlMutationDefaults {
  const defaultFunctionRegistry = new Map<string, ControlMutationDefaultEntry>();
  const functionOwners = new Map<string, string>();
  const generatorMap = new Map<string, MutationDefaultGeneratorDescriptor>();
  const generatorOwners = new Map<string, string>();

  for (const descriptor of descriptors) {
    const contributions = descriptor.controlMutationDefaults;
    if (!contributions) continue;
    const descriptorId = descriptor.id ?? '<unknown>';

    for (const generatorDescriptor of contributions.generatorDescriptors) {
      const existingOwner = generatorOwners.get(generatorDescriptor.id);
      if (existingOwner !== undefined) {
        throw new InternalError(
          `Duplicate mutation default generator id "${generatorDescriptor.id}". ` +
            `Descriptor "${descriptorId}" conflicts with "${existingOwner}".`,
        );
      }
      generatorMap.set(generatorDescriptor.id, generatorDescriptor);
      generatorOwners.set(generatorDescriptor.id, descriptorId);
    }

    for (const [functionName, handler] of contributions.defaultFunctionRegistry) {
      const existingOwner = functionOwners.get(functionName);
      if (existingOwner !== undefined) {
        throw new InternalError(
          `Duplicate mutation default function "${functionName}". ` +
            `Descriptor "${descriptorId}" conflicts with "${existingOwner}".`,
        );
      }
      defaultFunctionRegistry.set(functionName, handler);
      functionOwners.set(functionName, descriptorId);
    }
  }

  return {
    defaultFunctionRegistry,
    generatorDescriptors: Array.from(generatorMap.values()),
  };
}

/**
 * Collect every contributed {@link AggregateDescriptor} across the composed components, rejecting malformed shapes and second claims on one `(operation, input)` overload.
 *
 * Both planes read the same contribution slot: emission derives result types from these descriptors, and family runtimes build their resolution registry from them. Rejections are user-facing — an extension author's bad contribution surfaces here first, during `contract emit` — so a malformed shape raises `CONTRACT.AGGREGATE_DESCRIPTOR_INVALID` and a second claim raises `CONTRACT.AGGREGATE_DESCRIPTOR_DUPLICATE`, each naming the contributing component.
 */
export function collectAggregateDescriptors(
  descriptors: ReadonlyArray<Pick<ComponentMetadata, 'types'> & { readonly id?: string }>,
): ReadonlyArray<AggregateDescriptor> {
  const collected: AggregateDescriptor[] = [];
  const owners = new Map<string, string>();

  for (const descriptor of descriptors) {
    const descriptorId = descriptor.id ?? '<unknown>';
    for (const contributed of descriptor.types?.aggregateDescriptors ?? []) {
      if (!isAggregateDescriptor(contributed)) {
        throw runtimeError(
          'CONTRACT.AGGREGATE_DESCRIPTOR_INVALID',
          `Malformed aggregate descriptor contributed by "${descriptorId}". ` +
            'A descriptor declares a non-empty `operation`, an `input` match of kind `none`/`any`/`codec`/`trait`, ' +
            'an `output` of kind `self`/`codec`, and a boolean `nullable` — plus `emptyResultJson`, ' +
            "in the result codec's canonical JSON, where `nullable` is false; a `self` output needs an input to reuse.",
          { contributedBy: descriptorId, descriptor: contributed },
        );
      }

      const key = aggregateDescriptorKey(contributed);
      const existingOwner = owners.get(key);
      if (existingOwner !== undefined) {
        throw runtimeError(
          'CONTRACT.AGGREGATE_DESCRIPTOR_DUPLICATE',
          `Duplicate aggregate descriptor for "${key}". ` +
            `Descriptor "${descriptorId}" conflicts with "${existingOwner}". ` +
            'Each operation/input pair can only have one provider.',
          { key, contributedBy: descriptorId, owner: existingOwner },
        );
      }
      owners.set(key, descriptorId);
      collected.push(contributed);
    }
  }

  return collected;
}

/**
 * Flatten the codec descriptors the composed components contribute.
 *
 * A component may know a codec and still withhold it — an adapter that cannot name a codec's emitted type contributes the rest without it — so the contributed set is not always the set some component's own registry holds. Consumers whose output must agree with what the runtime resolves read this list rather than any one component's registry.
 */
export function collectCodecDescriptors(
  descriptors: ReadonlyArray<Pick<ComponentMetadata, 'types'>>,
): ReadonlyArray<AnyCodecDescriptor> {
  return descriptors.flatMap((descriptor) => descriptor.types?.codecTypes?.codecDescriptors ?? []);
}

export function extractCodecLookup(
  descriptors: ReadonlyArray<Pick<ComponentMetadata & { id: string }, 'types' | 'id'>>,
): CodecRegistry {
  const byId = new Map<string, Codec>();
  const descriptorsById = new Map<string, AnyCodecDescriptor>();
  const targetTypesById = new Map<string, readonly string[]>();
  const renderersById = new Map<string, (params: Record<string, unknown>) => string | undefined>();
  const inputRenderersById = new Map<
    string,
    (params: Record<string, unknown>) => string | undefined
  >();
  const valueLiteralRenderersById = new Map<
    string,
    (value: JsonValue, side: 'output' | 'input') => string | undefined
  >();
  const owners = new Map<string, string>();
  for (const descriptor of descriptors) {
    const codecTypes = descriptor.types?.codecTypes;
    const descriptorId = descriptor.id;
    // Descriptor-side metadata is the single source of truth for `targetTypes` / `renderOutputType`. A component contributes its codecs by listing `codecDescriptors` on `types.codecTypes`; each codecId has exactly one contributor across the stack.
    for (const codecDescriptor of codecTypes?.codecDescriptors ?? []) {
      assertUniqueCodecOwner({
        codecId: codecDescriptor.codecId,
        owners,
        descriptorId,
        entityLabel: 'codec descriptor',
        entityOwnershipLabel: 'codec descriptor provider',
      });
      owners.set(codecDescriptor.codecId, descriptorId);
      descriptorsById.set(codecDescriptor.codecId, codecDescriptor);
      if (Array.isArray(codecDescriptor.targetTypes)) {
        targetTypesById.set(codecDescriptor.codecId, codecDescriptor.targetTypes);
      }
      if (typeof codecDescriptor.renderOutputType === 'function') {
        renderersById.set(codecDescriptor.codecId, codecDescriptor.renderOutputType);
      }
      if (typeof codecDescriptor.renderInputType === 'function') {
        inputRenderersById.set(codecDescriptor.codecId, codecDescriptor.renderInputType);
      }
      if (typeof codecDescriptor.renderValueLiteral === 'function') {
        valueLiteralRenderersById.set(codecDescriptor.codecId, codecDescriptor.renderValueLiteral);
      }
      // Materialize a representative `Codec` instance for `byId.get()` so consumers reading the lookup's instance side (e.g. SQL renderer's cast-policy lookup, or the contract emitter's literal-default `encodeJson` resolver) keep finding the codec.
      //
      // Two cohorts:
      // - Non-parameterized descriptors: factory must succeed; any throw is a real bug and we let it propagate (no silent try/catch).
      // - Parameterized descriptors: try with empty params. Many parameterized codecs treat params as advisory (e.g. `pg/timestamptz-temporal@1` whose precision is rendered into the `nativeType` only and never read by the runtime codec), so an empty-params construction yields a usable representative for id-keyed lookups (e.g. emit-time literal-default encoding). Codecs whose factory genuinely requires params (e.g. `pg/vector@1` threading `length` into the runtime codec) will throw; for those, per-column instances are materialized at runtime by `buildContractCodecRegistry` and the id-keyed lookup miss is correct (the column-aware path resolves them).
      if (!byId.has(codecDescriptor.codecId)) {
        if (codecDescriptor.isParameterized) {
          try {
            const representative = codecDescriptor.factory({} as never)({
              name: `<lookup:${codecDescriptor.codecId}>`,
            } as Parameters<ReturnType<typeof codecDescriptor.factory>>[0]);
            byId.set(codecDescriptor.codecId, representative);
          } catch {
            // Factory requires concrete params; skip representative materialization. Per-column instances are built at runtime; id-keyed lookup miss is the correct outcome here.
          }
        } else {
          const representative = codecDescriptor.factory(undefined as never)({
            name: `<lookup:${codecDescriptor.codecId}>`,
          } as Parameters<ReturnType<typeof codecDescriptor.factory>>[0]);
          byId.set(codecDescriptor.codecId, representative);
        }
      }
    }
  }
  return {
    get: (id) => byId.get(id),
    forCodecRef(ref: CodecRef) {
      const d = resolveCodecDescriptorOrThrow(
        (id) => descriptorsById.get(id),
        ref,
        CONTRACT_CODEC_DESCRIPTOR_MISSING,
      );
      return materializeCodec(d, ref, { name: `<ref:${ref.codecId}>` });
    },
    forColumn: () => undefined,
    targetTypesFor: (id) => targetTypesById.get(id),
    renderOutputTypeFor: (id, params) => renderersById.get(id)?.(params),
    renderInputTypeFor: (id, params) => inputRenderersById.get(id)?.(params),
    renderValueLiteralFor: (id, value, side) => valueLiteralRenderersById.get(id)?.(value, side),
    descriptorFor: (id) => descriptorsById.get(id),
  };
}

export function validateScalarTypeCodecIds(
  typeNamespace: AuthoringTypeNamespace,
  codecLookup: CodecLookup,
): string[] {
  const errors: string[] = [];
  for (const [typeName, output] of collectScalarTypeConstructors(typeNamespace)) {
    if (!codecLookup.get(output.codecId)) {
      errors.push(
        `Scalar type "${typeName}" references codec "${output.codecId}" which is not registered by any component.`,
      );
    }
  }
  return errors;
}

interface DependencyDeclaringDescriptor {
  readonly id: string;
  readonly contractSpace?: {
    readonly contractJson?: {
      readonly extensions?: Readonly<Record<string, unknown>>;
    };
  };
}

function assembleExtensionContracts(
  extensions: ReadonlyArray<
    Pick<ControlExtensionDescriptor<string, string>, 'id' | 'contractSpace'>
  >,
): ReadonlyMap<string, Contract> {
  const result = new Map<string, Contract>();
  for (const ext of extensions) {
    if (ext.contractSpace === undefined) continue;
    result.set(ext.id, ext.contractSpace.contractJson);
  }
  return result;
}

function readDeclaredDependencyIds(descriptor: DependencyDeclaringDescriptor): readonly string[] {
  const packs = descriptor.contractSpace?.contractJson?.extensions;
  if (packs === null || typeof packs !== 'object') return [];
  return Object.keys(packs);
}

/**
 * Builds a dependency-respecting load order for the given extension descriptors
 * using Kahn's topological sort algorithm. Dependencies (packs declared in
 * `contractSpace.contractJson.extensions`) are placed before the extensions
 * that depend on them.
 *
 * Throws if the dependency graph contains a cycle, with an error message that
 * names every extension involved in the cycle.
 *
 * Throws if any extension declares a dependency on a pack ID that is not present
 * in the provided list — add the missing pack to the `extensions` list to
 * resolve the error.
 */

export function buildExtensionLoadOrder(
  extensions: ReadonlyArray<DependencyDeclaringDescriptor>,
): readonly string[] {
  if (extensions.length === 0) return [];

  const idSet = new Set(extensions.map((e) => e.id));
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const ext of extensions) {
    if (!inDegree.has(ext.id)) inDegree.set(ext.id, 0);
    if (!dependents.has(ext.id)) dependents.set(ext.id, []);
  }

  for (const ext of extensions) {
    for (const depId of readDeclaredDependencyIds(ext)) {
      if (!idSet.has(depId)) {
        throw new InternalError(
          `Extension "${ext.id}" declares a dependency on "${depId}", but "${depId}" is not in the provided extension set. Add the missing space to extensions.`,
        );
      }
      inDegree.set(ext.id, (inDegree.get(ext.id) ?? 0) + 1);
      const list = dependents.get(depId);
      if (list !== undefined) list.push(ext.id);
    }
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }
  queue.sort();

  const result: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined) break;
    result.push(id);
    const children = dependents.get(id) ?? [];
    children.sort();
    for (const childId of children) {
      const newDeg = (inDegree.get(childId) ?? 1) - 1;
      inDegree.set(childId, newDeg);
      if (newDeg === 0) queue.push(childId);
    }
  }

  if (result.length < extensions.length) {
    const cycleMembers = extensions
      .map((e) => e.id)
      .filter((id) => !result.includes(id))
      .sort();
    throw new InternalError(
      `Extension dependency cycle detected. Cycle members: ${cycleMembers.map((id) => `"${id}"`).join(', ')}.`,
    );
  }

  return result;
}

export function createControlStack<TFamilyId extends string, TTargetId extends string>(
  input: CreateControlStackInput<TFamilyId, TTargetId>,
): ControlStack<TFamilyId, TTargetId> {
  const { family, target, adapter, driver, extensions = [] } = input;

  const orderedIds = buildExtensionLoadOrder(extensions);
  const extensionById = new Map(extensions.map((ext) => [ext.id, ext]));
  const orderedExtensions = orderedIds
    .map((id) => extensionById.get(id))
    .filter((ext): ext is ControlExtensionDescriptor<TFamilyId, TTargetId> => ext !== undefined);

  const allDescriptors = [family, target, ...(adapter ? [adapter] : []), ...orderedExtensions];

  const codecLookup = extractCodecLookup(allDescriptors);
  const authoringContributions = assembleAuthoringContributions(allDescriptors);

  return {
    family,
    target,
    adapter,
    driver,
    extensions: orderedExtensions,
    extensionContracts: assembleExtensionContracts(orderedExtensions),

    codecTypeImports: extractCodecTypeImports(allDescriptors),
    queryOperationTypeImports: extractQueryOperationTypeImports(allDescriptors),
    extensionIds: extractComponentIds(family, target, adapter, orderedExtensions),
    codecLookup,
    codecDescriptors: collectCodecDescriptors(allDescriptors),
    aggregateDescriptors: collectAggregateDescriptors(allDescriptors),
    authoringContributions,
    scalarTypes: [...collectScalarTypeConstructors(authoringContributions.type).keys()],
    controlMutationDefaults: assembleControlMutationDefaults(allDescriptors),
    capabilities: mergeCapabilityMatrices({}, [
      target,
      ...(adapter ? [adapter] : []),
      ...orderedExtensions,
    ]),
  };
}
