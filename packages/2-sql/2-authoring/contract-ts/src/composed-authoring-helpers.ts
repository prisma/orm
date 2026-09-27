import {
  composePackAuthoringNamespace,
  createEntityHelpersFromNamespace,
  createFieldHelpersFromNamespace,
  type EntityHelpersFromNamespace,
  type ExtractAuthoringNamespaceFromPack,
  type MergeExtensionAuthoringNamespaces,
  type ResolveTemplateValue,
  type TupleFromArgumentDescriptors,
} from '@internal/contract-authoring';
import type {
  AuthoringArgumentDescriptor,
  AuthoringEntityTypeNamespace,
  AuthoringFieldNamespace,
  AuthoringTypeConstructorDescriptor,
  AuthoringTypeNamespace,
} from '@internal/framework-components/authoring';
import { assertNoCrossRegistryCollisions } from '@internal/framework-components/authoring';
import type {
  ExtensionPackRef,
  FamilyPackRef,
  TargetPackRef,
} from '@internal/framework-components/components';
import {
  createFieldPresetHelper,
  createTypeHelpersFromNamespace,
} from './authoring-helper-runtime';
import type { FieldHelpersFromNamespace } from './authoring-type-utils';
import type {
  AnyRelationBuilder,
  ContractModelBuilder,
  IndexTypeMap,
  ScalarFieldBuilder,
} from './contract-dsl';
import { buildFieldPreset, field, model, rel } from './contract-dsl';
import { contractError } from './contract-errors';
import type { MergeExtensionIndexTypes } from './contract-types';

type ExtractTypeNamespaceFromPack<Pack> = ExtractAuthoringNamespaceFromPack<
  Pack,
  'type',
  Record<never, never>
>;
type ExtractFieldNamespaceFromPack<Pack> = ExtractAuthoringNamespaceFromPack<
  Pack,
  'field',
  Record<never, never>
>;
type ExtractEntitiesNamespaceFromPack<Pack> = ExtractAuthoringNamespaceFromPack<
  Pack,
  'entityTypes',
  Record<never, never>
>;

type MergeExtensionTypeNamespaces<Extensions> = MergeExtensionAuthoringNamespaces<
  Extensions,
  'type'
>;
type MergeExtensionFieldNamespaces<Extensions> = MergeExtensionAuthoringNamespaces<
  Extensions,
  'field'
>;
type MergeExtensionEntityNamespaces<Extensions> = MergeExtensionAuthoringNamespaces<
  Extensions,
  'entityTypes'
>;

type StorageTypeFromDescriptor<
  Descriptor extends AuthoringTypeConstructorDescriptor,
  Args extends readonly unknown[],
> = {
  readonly kind: 'codec-instance';
  readonly codecId: ResolveTemplateValue<Descriptor['output']['codecId'], Args>;
  readonly nativeType: ResolveTemplateValue<Descriptor['output']['nativeType'], Args>;
} & (Descriptor['output'] extends {
  readonly typeParams: infer TypeParams extends Record<string, unknown>;
}
  ? {
      readonly typeParams: ResolveTemplateValue<TypeParams, Args>;
    }
  : { readonly typeParams: Record<never, never> });

type TypeHelperFunction<Descriptor extends AuthoringTypeConstructorDescriptor> =
  Descriptor extends { readonly args: infer Args extends readonly AuthoringArgumentDescriptor[] }
    ? <const Params extends TupleFromArgumentDescriptors<Args>>(
        ...args: Params
      ) => StorageTypeFromDescriptor<Descriptor, Params>
    : () => StorageTypeFromDescriptor<Descriptor, readonly []>;

type TypeHelpersFromNamespace<Namespace> = {
  readonly [K in keyof Namespace]: Namespace[K] extends AuthoringTypeConstructorDescriptor
    ? TypeHelperFunction<Namespace[K]>
    : Namespace[K] extends Record<string, unknown>
      ? TypeHelpersFromNamespace<Namespace[K]>
      : never;
};

type CoreFieldHelpers = Pick<typeof field, 'column' | 'generated' | 'namedType'>;

type MergeAllPackIndexTypes<Family, Target, Extensions> = MergeExtensionIndexTypes<
  { readonly __family: Family; readonly __target: Target } & (Extensions extends Record<
    string,
    unknown
  >
    ? Extensions
    : Record<never, never>)
>;

type PackAwareModel<IndexTypes extends IndexTypeMap> = {
  <
    const ModelName extends string,
    Fields extends Record<string, ScalarFieldBuilder>,
    Relations extends Record<string, AnyRelationBuilder> = Record<never, never>,
  >(
    modelName: ModelName,
    input: { readonly fields: Fields; readonly relations?: Relations; readonly namespace?: string },
  ): ContractModelBuilder<ModelName, Fields, Relations, undefined, undefined, IndexTypes>;
  <
    Fields extends Record<string, ScalarFieldBuilder>,
    Relations extends Record<string, AnyRelationBuilder> = Record<never, never>,
  >(input: {
    readonly fields: Fields;
    readonly relations?: Relations;
    readonly namespace?: string;
  }): ContractModelBuilder<undefined, Fields, Relations, undefined, undefined, IndexTypes>;
};

export type ComposedAuthoringHelpers<
  Family extends FamilyPackRef<string>,
  Target extends TargetPackRef<'sql', string>,
  Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
> = EntityHelpersFromNamespace<
  ExtractEntitiesNamespaceFromPack<Family> &
    ExtractEntitiesNamespaceFromPack<Target> &
    MergeExtensionEntityNamespaces<Extensions>
> & {
  readonly field: CoreFieldHelpers &
    FieldHelpersFromNamespace<
      ExtractFieldNamespaceFromPack<Family> &
        ExtractFieldNamespaceFromPack<Target> &
        MergeExtensionFieldNamespaces<Extensions>
    >;
  readonly model: PackAwareModel<MergeAllPackIndexTypes<Family, Target, Extensions>>;
  readonly rel: typeof rel;
  readonly type: TypeHelpersFromNamespace<
    ExtractTypeNamespaceFromPack<Family> &
      ExtractTypeNamespaceFromPack<Target> &
      MergeExtensionTypeNamespaces<Extensions>
  >;
};

type AuthoringComponent = {
  readonly authoring?: {
    readonly type?: unknown;
    readonly field?: unknown;
    readonly entityTypes?: unknown;
  };
};

function composeTypeNamespace(components: readonly AuthoringComponent[]): AuthoringTypeNamespace {
  return composePackAuthoringNamespace(components, 'type');
}

function composeFieldNamespace(components: readonly AuthoringComponent[]): AuthoringFieldNamespace {
  return composePackAuthoringNamespace(components, 'field');
}

function composeEntityNamespace(
  components: readonly AuthoringComponent[],
): AuthoringEntityTypeNamespace {
  return composePackAuthoringNamespace(components, 'entityTypes');
}

/**
 * Reserved top-level keys on the composed helpers surface — the
 * built-in `model` / `rel` helpers, the `field` / `type` namespace
 * objects. Pack-contributed entity types are flattened to the same
 * top-level shape (e.g. `helpers.enum({...})`), so a pack cannot
 * contribute an entity type whose name collides with one of these
 * reserved keys without silently overwriting at runtime. Detect the
 * collision at compose time and fail loudly with a guidance message.
 */
const RESERVED_HELPER_KEYS: readonly string[] = ['field', 'model', 'rel', 'type'];

function assertNoBuiltInEntityCollisions(namespace: AuthoringEntityTypeNamespace): void {
  const collisions = Object.keys(namespace).filter((name) => RESERVED_HELPER_KEYS.includes(name));
  if (collisions.length > 0) {
    throw contractError(
      'CONTRACT.PACK_CONTRIBUTION_INVALID',
      `Pack-contributed entity type(s) ${collisions.map((c) => `"${c}"`).join(', ')} collide with the reserved built-in helper key(s) on the composed helpers surface. Reserved keys: ${RESERVED_HELPER_KEYS.map((k) => `"${k}"`).join(', ')}.`,
      { meta: { collisions, reservedKeys: RESERVED_HELPER_KEYS } },
    );
  }
}

function createComposedFieldHelpers(
  fieldNamespace: AuthoringFieldNamespace,
): CoreFieldHelpers & Record<string, unknown> {
  const helperNamespace = createFieldHelpersFromNamespace(
    fieldNamespace,
    ({ helperPath, descriptor }) =>
      createFieldPresetHelper({
        helperPath,
        descriptor,
        build: ({ args, namedConstraintOptions }) =>
          buildFieldPreset(descriptor, args, namedConstraintOptions),
      }),
  );
  const coreFieldHelpers = {
    column: field.column,
    generated: field.generated,
    namedType: field.namedType,
  } satisfies CoreFieldHelpers;

  const coreHelperNames = new Set(Object.keys(coreFieldHelpers));
  for (const helperName of Object.keys(helperNamespace)) {
    if (coreHelperNames.has(helperName)) {
      throw contractError(
        'CONTRACT.PACK_CONTRIBUTION_INVALID',
        `Duplicate authoring field helper "${helperName}". Core field helpers reserve that name.`,
        { meta: { helperName } },
      );
    }
  }

  return {
    ...coreFieldHelpers,
    ...helperNamespace,
  };
}

export function createComposedAuthoringHelpers<
  Family extends FamilyPackRef<string>,
  Target extends TargetPackRef<'sql', string>,
  Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
>(options: {
  readonly family: Family;
  readonly target: Target;
  readonly extensions?: Extensions;
}): ComposedAuthoringHelpers<Family, Target, Extensions> {
  const extensionValues: readonly ExtensionPackRef<'sql', string>[] = Object.values(
    (options.extensions ?? {}) as Record<string, ExtensionPackRef<'sql', string>>,
  );
  const components: readonly AuthoringComponent[] = [
    options.family,
    options.target,
    ...extensionValues,
  ];

  const typeNamespace = composeTypeNamespace(components);
  const fieldNamespace = composeFieldNamespace(components);
  const entityNamespace = composeEntityNamespace(components);
  // Mirrors the call in `assembleAuthoringContributions`: PSL composes via
  // `createControlStack`, the TS DSL composes here. Both seams need the guard.
  assertNoCrossRegistryCollisions(typeNamespace, fieldNamespace, entityNamespace);
  assertNoBuiltInEntityCollisions(entityNamespace);

  return {
    ...createEntityHelpersFromNamespace(entityNamespace, {
      ctx: { family: options.family.familyId, target: options.target.targetId },
    }),
    field: createComposedFieldHelpers(fieldNamespace),
    model,
    rel,
    type: createTypeHelpersFromNamespace(typeNamespace),
  } as ComposedAuthoringHelpers<Family, Target, Extensions>;
}
