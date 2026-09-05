import type { ContractSourceDiagnostic } from '@internal/config/config-types';
import type {
  ColumnDefault,
  ExecutionMutationDefaultPhases,
  ValueSetRef,
} from '@internal/contract/types';
import type {
  AuthoringContributions,
  AuthoringEntityTypeDescriptor,
  AuthoringEntityTypeNamespace,
  AuthoringFieldNamespace,
  AuthoringFieldPresetDescriptor,
  AuthoringTypeConstructorDescriptor,
  AuthoringTypeNamespace,
} from '@internal/framework-components/authoring';
import {
  hasRegisteredFieldNamespace,
  instantiateAuthoringFieldPreset,
  instantiateAuthoringTypeConstructor,
  isAuthoringEntityTypeDescriptor,
  isAuthoringFieldPresetDescriptor,
  isAuthoringTypeConstructorDescriptor,
  validateAuthoringHelperArguments,
} from '@internal/framework-components/authoring';
import type { AnyCodecDescriptor, CodecLookup } from '@internal/framework-components/codec';
import type {
  ControlMutationDefaultRegistry,
  MutationDefaultGeneratorDescriptor,
} from '@internal/framework-components/control';
import type {
  FieldSymbol,
  ModelSymbol,
  PslSpan,
  ResolvedTypeConstructorCall,
  SymbolTable,
} from '@internal/psl-parser';
import type { SourceFile } from '@internal/psl-parser/syntax';

import { InternalError } from '@internal/utils/internal-error';
import { contractError } from './contract-errors';
import { lowerDefaultFunctionWithRegistry } from './default-function-registry';

import { mapPslHelperArgs } from './psl-authoring-arguments';
import {
  fieldSpecContext,
  findFieldAttributeNode,
  interpretFieldAttribute,
  sqlAttributeSpecs,
} from './sql-attribute-specs';

export type ColumnDescriptor = {
  readonly codecId: string;
  readonly nativeType: string;
  readonly typeRef?: string;
  readonly typeParams?: Record<string, unknown> | undefined;
  /**
   * Storage-plane value-set ref, set only by an entity-ref type constructor
   * (e.g. `pg.enum(Ref)`) resolving `Ref` against a document-local
   * value-set-deriving entity. Threaded straight onto the `StorageColumn` —
   * this is what drives value-set → codec typing (`computeColumnType`
   * gating on `column.valueSet`); every other resolution path leaves it
   * unset.
   */
  readonly valueSet?: ValueSetRef;
};

export function toNamedTypeFieldDescriptor(
  typeRef: string,
  descriptor: Pick<ColumnDescriptor, 'codecId' | 'nativeType'>,
): ColumnDescriptor {
  return {
    codecId: descriptor.codecId,
    nativeType: descriptor.nativeType,
    typeRef,
  };
}

export function getAuthoringTypeConstructor(
  contributions: AuthoringContributions | undefined,
  path: readonly string[],
): AuthoringTypeConstructorDescriptor | undefined {
  let current: AuthoringTypeConstructorDescriptor | AuthoringTypeNamespace | undefined =
    contributions?.type;

  for (const segment of path) {
    if (typeof current !== 'object' || current === null || 'kind' in current) {
      return undefined;
    }
    current = current[segment];
  }

  return current !== undefined && isAuthoringTypeConstructorDescriptor(current)
    ? current
    : undefined;
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

/**
 * Walks `authoringContributions.field` segment-by-segment and returns the field-preset descriptor at the resolved path, or `undefined` if no descriptor is registered.
 *
 * Symmetric with `getAuthoringTypeConstructor`. Field presets are strictly richer than type constructors — they can contribute `default` / `executionDefaults` / `id` / `unique` / `nullable` in addition to the `codecId` / `nativeType` / `typeParams` triple. PSL resolution tries field presets first, then falls back to type constructors on miss (see `resolveFieldTypeDescriptor`).
 */
export function getAuthoringFieldPreset(
  contributions: AuthoringContributions | undefined,
  path: readonly string[],
): AuthoringFieldPresetDescriptor | undefined {
  let current: AuthoringFieldPresetDescriptor | AuthoringFieldNamespace | undefined =
    contributions?.field;

  for (const segment of path) {
    if (typeof current !== 'object' || current === null || 'kind' in current) {
      return undefined;
    }
    current = current[segment];
  }

  return current !== undefined && isAuthoringFieldPresetDescriptor(current) ? current : undefined;
}

/**
 * Returns the namespace prefix of `attributeName` if it references an unrecognized extension namespace, otherwise `undefined`. A namespace is considered recognized when it is:
 *
 * - `db` (native-type spec, always allowed),
 * - the active family id (e.g. `sql`),
 * - the active target id (e.g. `postgres`),
 * - a registered field-preset namespace (e.g. `temporal`),
 * - present in `composedExtensions`.
 *
 * Family/target/field-preset namespaces are exempted so that e.g. `@sql.foo` surfaces as PSL_UNSUPPORTED_*_ATTRIBUTE (the attribute isn't defined) rather than PSL_EXTENSION_NAMESPACE_NOT_COMPOSED (the namespace is already composed).
 */
export function checkUncomposedNamespace(
  attributeName: string,
  composedExtensions: ReadonlySet<string>,
  context?: {
    readonly familyId?: string;
    readonly targetId?: string;
    readonly authoringContributions?: AuthoringContributions | undefined;
  },
): string | undefined {
  const dotIndex = attributeName.indexOf('.');
  if (dotIndex <= 0 || dotIndex === attributeName.length - 1) {
    return undefined;
  }
  const namespace = attributeName.slice(0, dotIndex);
  if (
    namespace === 'db' ||
    namespace === context?.familyId ||
    namespace === context?.targetId ||
    hasRegisteredFieldNamespace(context?.authoringContributions, namespace) ||
    composedExtensions.has(namespace)
  ) {
    return undefined;
  }
  return namespace;
}

/**
 * Pushes the canonical `PSL_EXTENSION_NAMESPACE_NOT_COMPOSED` diagnostic for a subject (attribute, model attribute, or type constructor) that references an extension namespace which is not composed in the current contract.
 *
 * The `data` payload carries the missing namespace so machine consumers (agents, IDE extensions, CLI auto-fix) don't have to parse the prose.
 */
export function reportUncomposedNamespace(input: {
  readonly subjectLabel: string;
  readonly namespace: string;
  readonly sourceId: string;
  readonly span: PslSpan;
  readonly diagnostics: ContractSourceDiagnostic[];
}): void {
  input.diagnostics.push({
    code: 'PSL_EXTENSION_NAMESPACE_NOT_COMPOSED',
    message: `${input.subjectLabel} uses unrecognized namespace "${input.namespace}". Add extension pack "${input.namespace}" to extensions in prisma.config.ts.`,
    sourceId: input.sourceId,
    span: input.span,
    data: { namespace: input.namespace, suggestedPack: input.namespace },
  });
}

/**
 * Pushes the canonical `PSL_UNKNOWN_FIELD_PRESET` diagnostic when a typoed preset name is referenced inside a registered field-preset namespace. The `data` payload exposes the namespace and full helper path so machine consumers (agents, IDE extensions) don't have to parse the prose.
 */
export function reportUnknownFieldPreset(input: {
  readonly entityLabel: string;
  readonly namespace: string;
  readonly helperPath: string;
  readonly sourceId: string;
  readonly span: PslSpan;
  readonly diagnostics: ContractSourceDiagnostic[];
}): void {
  input.diagnostics.push({
    code: 'PSL_UNKNOWN_FIELD_PRESET',
    message: `${input.entityLabel} references unknown field preset "${input.helperPath}". Check the spelling against the available presets in the "${input.namespace}" namespace.`,
    sourceId: input.sourceId,
    span: input.span,
    data: { namespace: input.namespace, helperPath: input.helperPath },
  });
}

export function instantiatePslTypeConstructor(input: {
  readonly call: ResolvedTypeConstructorCall;
  readonly descriptor: AuthoringTypeConstructorDescriptor;
  readonly diagnostics: ContractSourceDiagnostic[];
  readonly sourceId: string;
  readonly entityLabel: string;
}):
  | {
      readonly codecId: string;
      readonly nativeType: string;
      readonly typeParams?: Record<string, unknown>;
    }
  | undefined {
  const helperPath = input.call.path.join('.');
  const args = mapPslHelperArgs({
    args: input.call.args,
    descriptors: input.descriptor.args ?? [],
    helperLabel: `constructor "${helperPath}"`,
    span: input.call.span,
    diagnostics: input.diagnostics,
    sourceId: input.sourceId,
    entityLabel: input.entityLabel,
  });
  if (!args) {
    return undefined;
  }

  try {
    validateAuthoringHelperArguments(helperPath, input.descriptor.args, args);
    return instantiateAuthoringTypeConstructor(input.descriptor, args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    input.diagnostics.push({
      code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
      message: `${input.entityLabel} constructor "${helperPath}" ${message}`,
      sourceId: input.sourceId,
      span: input.call.span,
    });
    return undefined;
  }
}

function pushUnsupportedTypeConstructorDiagnostic(input: {
  readonly diagnostics: ContractSourceDiagnostic[];
  readonly sourceId: string;
  readonly span: PslSpan;
  readonly code: 'PSL_UNSUPPORTED_FIELD_TYPE' | 'PSL_UNSUPPORTED_NAMED_TYPE_CONSTRUCTOR';
  readonly message: string;
}): undefined {
  input.diagnostics.push({
    code: input.code,
    message: input.message,
    sourceId: input.sourceId,
    span: input.span,
  });
  return undefined;
}

export function resolvePslTypeConstructorDescriptor(input: {
  readonly call: ResolvedTypeConstructorCall;
  readonly authoringContributions: AuthoringContributions | undefined;
  readonly composedExtensions: ReadonlySet<string>;
  readonly familyId: string;
  readonly targetId: string;
  readonly diagnostics: ContractSourceDiagnostic[];
  readonly sourceId: string;
  readonly unsupportedCode: 'PSL_UNSUPPORTED_FIELD_TYPE' | 'PSL_UNSUPPORTED_NAMED_TYPE_CONSTRUCTOR';
  readonly unsupportedMessage: string;
}): AuthoringTypeConstructorDescriptor | undefined {
  const descriptor = getAuthoringTypeConstructor(input.authoringContributions, input.call.path);
  if (descriptor) {
    return descriptor;
  }

  const uncomposedNamespace = checkUncomposedNamespace(
    input.call.path.join('.'),
    input.composedExtensions,
    {
      familyId: input.familyId,
      targetId: input.targetId,
      authoringContributions: input.authoringContributions,
    },
  );
  if (uncomposedNamespace) {
    reportUncomposedNamespace({
      subjectLabel: `Type constructor "${input.call.path.join('.')}"`,
      namespace: uncomposedNamespace,
      sourceId: input.sourceId,
      span: input.call.span,
      diagnostics: input.diagnostics,
    });
    return undefined;
  }

  return pushUnsupportedTypeConstructorDiagnostic({
    diagnostics: input.diagnostics,
    sourceId: input.sourceId,
    span: input.call.span,
    code: input.unsupportedCode,
    message: input.unsupportedMessage,
  });
}

/**
 * Instantiates a field-preset call against its descriptor, coercing PSL AST arguments into the descriptor's typed argument shape and returning the preset's full set of contract contributions.
 *
 * Symmetric with `instantiatePslTypeConstructor` but richer: a field preset can contribute `default`, `executionDefaults`, `id`, `unique`, and `nullable` in addition to the storage-type triple. PSL → typed-args coercion happens here (via `mapPslHelperArgs`) so that `instantiateAuthoringFieldPreset` itself stays typed-input-only and TS keeps its zero-runtime-validation cost.
 */
export function instantiateFieldPreset(input: {
  readonly call: ResolvedTypeConstructorCall;
  readonly descriptor: AuthoringFieldPresetDescriptor;
  readonly diagnostics: ContractSourceDiagnostic[];
  readonly sourceId: string;
  readonly entityLabel: string;
}):
  | {
      readonly descriptor: ColumnDescriptor;
      readonly nullable: boolean;
      readonly default?: ColumnDefault;
      readonly executionDefaults?: ExecutionMutationDefaultPhases;
      readonly id: boolean;
      readonly unique: boolean;
    }
  | undefined {
  const helperPath = input.call.path.join('.');
  const args = mapPslHelperArgs({
    args: input.call.args,
    descriptors: input.descriptor.args ?? [],
    helperLabel: `preset "${helperPath}"`,
    span: input.call.span,
    diagnostics: input.diagnostics,
    sourceId: input.sourceId,
    entityLabel: input.entityLabel,
  });
  if (!args) {
    return undefined;
  }

  try {
    validateAuthoringHelperArguments(helperPath, input.descriptor.args, args);
    const instantiated = instantiateAuthoringFieldPreset(input.descriptor, args);
    return {
      descriptor: {
        codecId: instantiated.descriptor.codecId,
        nativeType: instantiated.descriptor.nativeType,
        ...(instantiated.descriptor.typeParams !== undefined
          ? { typeParams: instantiated.descriptor.typeParams }
          : {}),
      },
      nullable: instantiated.nullable,
      ...(instantiated.default !== undefined ? { default: instantiated.default } : {}),
      ...(instantiated.executionDefaults !== undefined
        ? { executionDefaults: instantiated.executionDefaults }
        : {}),
      id: instantiated.id,
      unique: instantiated.unique,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    input.diagnostics.push({
      code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
      message: `${input.entityLabel} preset "${helperPath}" ${message}`,
      sourceId: input.sourceId,
      span: input.call.span,
    });
    return undefined;
  }
}

/**
 * Result of a codec descriptor's `columnFromEntity` authoring hook — the
 * per-column params derived from the entity a type constructor's
 * `entityRefArg` resolved to. `nativeType` mirrors what the codec descriptor's
 * `nativeTypeFor` derives from the same `typeParams` at render time, so the
 * column's declared native type and the render-time cast agree.
 */
interface EntityRefColumnFromEntityResult {
  readonly typeParams?: Record<string, unknown>;
  readonly nativeType: string;
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
 * codec descriptor registered for `descriptor.output.codecId`. The `nativeType`
 * / `typeParams.typeName` `columnFromEntity` returns are bare — schema
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
    | Readonly<Record<string, Readonly<Record<string, unknown>>>>
    | undefined;
  readonly codecLookup: CodecLookup | undefined;
  readonly diagnostics: ContractSourceDiagnostic[];
  readonly sourceId: string;
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
  const ref = positionalArgs[entityRefArg.index]?.value;
  if (input.call.args.length !== 1 || positionalArgs.length !== 1 || ref === undefined) {
    input.diagnostics.push({
      code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
      message: `${input.entityLabel} type constructor "${helperPath}" expects exactly one positional argument naming the referenced entity`,
      sourceId: input.sourceId,
      span: input.call.span,
    });
    return { ok: false, alreadyReported: true };
  }

  const reportUnknownRef = (): ResolveFieldTypeResult => {
    input.diagnostics.push({
      code: 'PSL_UNKNOWN_ENTITY_REF',
      message: `${input.entityLabel} type constructor "${helperPath}(${ref})" does not resolve — no entity named "${ref}" was found in namespace "${input.namespaceId ?? '(unspecified)'}"`,
      sourceId: input.sourceId,
      span: input.call.span,
    });
    return { ok: false, alreadyReported: true };
  };

  const entity = input.namespaceExtensionEntities?.[entityRefArg.entityKind]?.[ref];
  if (entity === undefined) {
    return reportUnknownRef();
  }

  const codecId = input.descriptor.output.codecId;
  const codecDescriptor = input.codecLookup?.descriptorFor?.(codecId);
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

  const derivedValueSet = input.namespaceExtensionEntities?.['valueSet']?.[ref];
  if (derivedValueSet !== undefined && input.namespaceId === undefined) {
    input.diagnostics.push({
      code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
      message: `${input.entityLabel} type constructor "${helperPath}(${ref})" resolves to a value-set-typed entity, but the field has no resolvable namespace to scope the value-set ref to`,
      sourceId: input.sourceId,
      span: input.call.span,
    });
    return { ok: false, alreadyReported: true };
  }

  const valueSet: ValueSetRef | undefined =
    derivedValueSet !== undefined && input.namespaceId !== undefined
      ? {
          plane: 'storage',
          entityKind: 'valueSet',
          namespaceId: input.namespaceId,
          entityName: ref,
        }
      : undefined;

  return {
    ok: true,
    descriptor: {
      codecId,
      nativeType: resolved.nativeType,
      ...(resolved.typeParams !== undefined ? { typeParams: resolved.typeParams } : {}),
      ...(valueSet !== undefined ? { valueSet } : {}),
    },
  };
}

/**
 * Contract contributions a field preset adds beyond the bare storage-type triple. Set when a field is resolved through the field-preset dispatch path; absent when resolved through the type-constructor path or as a scalar/enum/named-type lookup.
 */
export type FieldPresetContributions = {
  readonly nullable: boolean;
  readonly id: boolean;
  readonly unique: boolean;
  readonly default?: ColumnDefault;
  readonly executionDefaults?: ExecutionMutationDefaultPhases;
};

export type ResolveFieldTypeResult =
  | {
      readonly ok: true;
      readonly descriptor: ColumnDescriptor;
      readonly presetContributions?: FieldPresetContributions;
    }
  | { readonly ok: false; readonly alreadyReported: boolean };

export function resolveFieldTypeDescriptor(input: {
  readonly field: FieldSymbol;
  readonly enumTypeDescriptors: ReadonlyMap<string, ColumnDescriptor>;
  readonly namedTypeDescriptors: ReadonlyMap<string, ColumnDescriptor>;
  readonly scalarColumnDescriptors: ReadonlyMap<string, ColumnDescriptor>;
  readonly authoringContributions: AuthoringContributions | undefined;
  readonly composedExtensions: ReadonlySet<string>;
  readonly familyId: string;
  readonly targetId: string;
  readonly diagnostics: ContractSourceDiagnostic[];
  readonly sourceId: string;
  readonly entityLabel: string;
  /**
   * The field's namespace id — required to build a `valueSet` ref (`{
   * namespaceId, entityName, … }`) when an entity-ref type constructor
   * resolves the field's type. Storage value-sets are namespace-scoped, so
   * the ref must point at the value-set derived in the SAME namespace the
   * field's own column lives in.
   */
  readonly namespaceId?: string;
  /**
   * Extension entities already lowered for this namespace (the exact shape
   * `lowerExtensionBlocksForNamespace` in the interpreter produces), keyed
   * by entries-slot discriminator then block name. Consulted only when a
   * type constructor's descriptor declares an `entityRefArg` (e.g.
   * `pg.enum(Ref)`); every other resolution path ignores it.
   */
  readonly namespaceExtensionEntities?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  /**
   * Codec-id-keyed descriptor lookup — consulted only when a type
   * constructor's descriptor declares an `entityRefArg`, to reach the
   * registered codec's `columnFromEntity` authoring hook.
   */
  readonly codecLookup?: CodecLookup;
}): ResolveFieldTypeResult {
  // Avoid cascading unsupported-type diagnostics after invalid qualification.
  if (input.field.malformedType) {
    return { ok: false, alreadyReported: true };
  }
  if (input.field.typeConstructor) {
    // Field presets carry richer semantics than type constructors, so a field preset match is the complete answer. Shared composition rejects exact cross-registry collisions before PSL resolution can observe them.
    const presetDescriptor = getAuthoringFieldPreset(
      input.authoringContributions,
      input.field.typeConstructor.path,
    );
    if (presetDescriptor) {
      const instantiated = instantiateFieldPreset({
        call: input.field.typeConstructor,
        descriptor: presetDescriptor,
        diagnostics: input.diagnostics,
        sourceId: input.sourceId,
        entityLabel: input.entityLabel,
      });
      if (!instantiated) {
        return { ok: false, alreadyReported: true };
      }
      const presetContributions: FieldPresetContributions = {
        nullable: instantiated.nullable,
        id: instantiated.id,
        unique: instantiated.unique,
        ...(instantiated.default !== undefined ? { default: instantiated.default } : {}),
        ...(instantiated.executionDefaults !== undefined
          ? { executionDefaults: instantiated.executionDefaults }
          : {}),
      };
      return { ok: true, descriptor: instantiated.descriptor, presetContributions };
    }

    const helperPath = input.field.typeConstructor.path.join('.');
    const namespacePrefix =
      input.field.typeConstructor.path.length > 1 ? input.field.typeConstructor.path[0] : undefined;
    const typeDescriptor = getAuthoringTypeConstructor(
      input.authoringContributions,
      input.field.typeConstructor.path,
    );

    if (typeDescriptor?.entityRefArg) {
      return resolveEntityRefTypeConstructorCall({
        call: input.field.typeConstructor,
        descriptor: typeDescriptor,
        namespaceId: input.namespaceId,
        namespaceExtensionEntities: input.namespaceExtensionEntities,
        codecLookup: input.codecLookup,
        diagnostics: input.diagnostics,
        sourceId: input.sourceId,
        entityLabel: input.entityLabel,
      });
    }

    if (
      !typeDescriptor &&
      namespacePrefix &&
      hasRegisteredFieldNamespace(input.authoringContributions, namespacePrefix)
    ) {
      reportUnknownFieldPreset({
        entityLabel: input.entityLabel,
        namespace: namespacePrefix,
        helperPath,
        sourceId: input.sourceId,
        span: input.field.typeConstructor.span,
        diagnostics: input.diagnostics,
      });
      return { ok: false, alreadyReported: true };
    }

    const descriptor =
      typeDescriptor ??
      resolvePslTypeConstructorDescriptor({
        call: input.field.typeConstructor,
        authoringContributions: input.authoringContributions,
        composedExtensions: input.composedExtensions,
        familyId: input.familyId,
        targetId: input.targetId,
        diagnostics: input.diagnostics,
        sourceId: input.sourceId,
        unsupportedCode: 'PSL_UNSUPPORTED_FIELD_TYPE',
        unsupportedMessage: `${input.entityLabel} type constructor "${helperPath}" is not supported in SQL PSL provider v1`,
      });
    if (!descriptor) {
      return { ok: false, alreadyReported: true };
    }

    const instantiated = instantiatePslTypeConstructor({
      call: input.field.typeConstructor,
      descriptor,
      diagnostics: input.diagnostics,
      sourceId: input.sourceId,
      entityLabel: input.entityLabel,
    });
    if (!instantiated) {
      return { ok: false, alreadyReported: true };
    }
    return { ok: true, descriptor: instantiated };
  }

  const descriptor = resolveColumnDescriptor(
    input.field,
    input.enumTypeDescriptors,
    input.namedTypeDescriptors,
    input.scalarColumnDescriptors,
  );
  if (!descriptor) {
    return { ok: false, alreadyReported: false };
  }
  return { ok: true, descriptor };
}

export function lowerDefaultForField(input: {
  readonly modelName: string;
  readonly fieldName: string;
  readonly field: FieldSymbol;
  readonly model: ModelSymbol;
  readonly symbolTable: SymbolTable;
  readonly sourceFile: SourceFile;
  readonly columnDescriptor: ColumnDescriptor;
  readonly generatorDescriptorById: ReadonlyMap<string, MutationDefaultGeneratorDescriptor>;
  readonly sourceId: string;
  readonly defaultFunctionRegistry: ControlMutationDefaultRegistry;
  readonly diagnostics: ContractSourceDiagnostic[];
}): {
  readonly defaultValue?: ColumnDefault;
  readonly executionDefaults?: ExecutionMutationDefaultPhases;
} {
  const node = findFieldAttributeNode(input.field, 'default');
  if (node === undefined) return {};
  const spec = sqlAttributeSpecs.field.default(
    fieldSpecContext({
      symbols: input.symbolTable,
      model: input.model,
      field: input.field,
      controlMutationDefaults: input.defaultFunctionRegistry,
    }),
  );
  const interpreted = interpretFieldAttribute({
    node,
    spec,
    model: input.model,
    field: input.field,
    sourceFile: input.sourceFile,
    sourceId: input.sourceId,
    diagnostics: input.diagnostics,
  });
  if (interpreted === undefined) return {};
  const value = interpreted.value;

  if (Array.isArray(value)) {
    return { defaultValue: { kind: 'literal', value: [...value] } };
  }

  if (typeof value === 'object') {
    const lowered = lowerDefaultFunctionWithRegistry({
      call: value,
      registry: input.defaultFunctionRegistry,
      context: {
        sourceId: input.sourceId,
        modelName: input.modelName,
        fieldName: input.fieldName,
        columnCodecId: input.columnDescriptor.codecId,
      },
    });

    if (!lowered.ok) {
      input.diagnostics.push(lowered.diagnostic);
      return {};
    }

    if (lowered.value.kind === 'storage') {
      return { defaultValue: lowered.value.defaultValue };
    }

    const generatorDescriptor = input.generatorDescriptorById.get(lowered.value.generated.id);
    if (!generatorDescriptor) {
      input.diagnostics.push({
        code: 'PSL_INVALID_DEFAULT_APPLICABILITY',
        message: `Default generator "${lowered.value.generated.id}" is not available in the composed mutation default registry.`,
        sourceId: input.sourceId,
        span: value.span,
      });
      return {};
    }

    // Preset-only generators (e.g. `timestampNow`) co-register their codec through the preset descriptor, so they don't carry an `applicableCodecIds` list. Such a generator surfacing on the `@default(...)` lowering path is itself the bug — emit a diagnostic pointing the user at the correct authoring surface.
    if (generatorDescriptor.applicableCodecIds === undefined) {
      input.diagnostics.push({
        code: 'PSL_INVALID_DEFAULT_APPLICABILITY',
        message: `Default generator "${generatorDescriptor.id}" is not applicable to "@default(...)" lowering. Use the corresponding field preset (e.g. \`temporal.${generatorDescriptor.id === 'timestampNow' ? 'updatedAt' : generatorDescriptor.id}()\`) instead.`,
        sourceId: input.sourceId,
        span: value.span,
      });
      return {};
    }

    if (!generatorDescriptor.applicableCodecIds.includes(input.columnDescriptor.codecId)) {
      input.diagnostics.push({
        code: 'PSL_INVALID_DEFAULT_APPLICABILITY',
        message: `Default generator "${generatorDescriptor.id}" is not applicable to "${input.modelName}.${input.fieldName}" with codecId "${input.columnDescriptor.codecId}".`,
        sourceId: input.sourceId,
        span: value.span,
      });
      return {};
    }

    return { executionDefaults: { onCreate: lowered.value.generated } };
  }

  return { defaultValue: { kind: 'literal', value } };
}

export function resolveColumnDescriptor(
  field: FieldSymbol,
  enumTypeDescriptors: ReadonlyMap<string, ColumnDescriptor>,
  namedTypeDescriptors: ReadonlyMap<string, ColumnDescriptor>,
  scalarColumnDescriptors: ReadonlyMap<string, ColumnDescriptor>,
): ColumnDescriptor | undefined {
  if (namedTypeDescriptors.has(field.typeName)) {
    return namedTypeDescriptors.get(field.typeName);
  }
  if (enumTypeDescriptors.has(field.typeName)) {
    return enumTypeDescriptors.get(field.typeName);
  }
  return scalarColumnDescriptors.get(field.typeName);
}
