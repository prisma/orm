import {
  type CanonicalArguments,
  type CodecTypeMap,
  composePackAuthoringNamespace,
  createEntityHelpersFromNamespace,
  type DataTypeArgumentTypes,
  type EntityHelpersFromNamespace,
  type ExtractAuthoringNamespaceFromPack,
  type ExtractDataTypeArgumentTypesFromPack,
  type MergeExtensionAuthoringNamespaces,
  type ResolveTemplateValue,
  type TupleFromArgumentDescriptors,
  type UnionToIntersection,
} from '@internal/contract-authoring';
import type {
  AuthoringArgumentDescriptor,
  AuthoringEntityTypeNamespace,
  AuthoringTypeAliasDescriptor,
  AuthoringTypeConstructorDescriptor,
  AuthoringTypeNamespace,
  DataTypeComponent,
} from '@internal/framework-components/authoring';
import {
  assembleDataTypeSupport,
  assertNoCrossRegistryCollisions,
} from '@internal/framework-components/authoring';
import type { CodecLookupWithDescriptors } from '@internal/framework-components/codec';
import {
  createGeneratorHelpers,
  type ExtensionPackRef,
  type ExtensionPackValues,
  type FamilyPackRef,
  type GeneratorFunctionCall,
  type GeneratorHelpersOf,
  type TargetPackRef,
} from '@internal/framework-components/components';
import { blindCast } from '@internal/utils/casts';
import {
  type AuthoringHelperLookups,
  createTypeHelpersFromNamespace,
} from './authoring-helper-runtime';
import type {
  AnyRelationBuilder,
  ColumnFieldHelper,
  ContractModelBuilder,
  IndexTypeMap,
  NamedTypeFieldHelper,
  ScalarFieldBuilder,
} from './contract-dsl';
import { field, model, rel } from './contract-dsl';
import { contractError } from './contract-errors';
import type {
  ExtractCodecTypesFromPack,
  MergeExtensionCodecTypesSafe,
  MergeExtensionIndexTypes,
} from './contract-types';
import { refusingRemovedFieldPresets } from './removed-field-presets';

type ExtractTypeNamespaceFromPack<Pack> = ExtractAuthoringNamespaceFromPack<
  Pack,
  'type',
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
} & (Descriptor['output'] extends {
  readonly typeParams: infer TypeParams extends Record<string, unknown>;
}
  ? {
      readonly typeParams: ResolveTemplateValue<TypeParams, Args>;
    }
  : { readonly typeParams: Record<never, never> });

type TypeHelperFunction<
  Descriptor extends AuthoringTypeConstructorDescriptor,
  ValueTypes extends DataTypeArgumentTypes,
> = Descriptor extends {
  readonly args: infer Args extends readonly AuthoringArgumentDescriptor[];
}
  ? <const Params extends TupleFromArgumentDescriptors<Args, ValueTypes>>(
      ...args: Params
    ) => StorageTypeFromDescriptor<Descriptor, CanonicalArguments<Args, Params, ValueTypes>>
  : () => StorageTypeFromDescriptor<Descriptor, readonly []>;

type AliasGeneratorCalls<Output> = (Output extends { readonly onCreate: GeneratorFunctionCall }
  ? { readonly onCreate: GeneratorFunctionCall }
  : unknown) &
  (Output extends { readonly onUpdate: GeneratorFunctionCall }
    ? { readonly onUpdate: GeneratorFunctionCall }
    : unknown);

type TypeAliasHelperFunction<Descriptor extends AuthoringTypeAliasDescriptor> = () => {
  readonly kind: 'codec-instance';
  readonly codecId: Descriptor['output']['type']['codecId'];
  readonly typeParams: Descriptor['output']['type'] extends {
    readonly typeParams: infer TypeParams extends Record<string, unknown>;
  }
    ? TypeParams
    : Record<never, never>;
} & (Descriptor['output'] extends
  | { readonly onCreate: GeneratorFunctionCall }
  | { readonly onUpdate: GeneratorFunctionCall }
  ? { readonly generatorCalls: AliasGeneratorCalls<Descriptor['output']> }
  : unknown);

type TypeHelpersFromNamespace<Namespace, ValueTypes extends DataTypeArgumentTypes> = {
  readonly [K in keyof Namespace]: Namespace[K] extends AuthoringTypeConstructorDescriptor
    ? TypeHelperFunction<Namespace[K], ValueTypes>
    : Namespace[K] extends AuthoringTypeAliasDescriptor
      ? TypeAliasHelperFunction<Namespace[K]>
      : Namespace[K] extends Record<string, unknown>
        ? TypeHelpersFromNamespace<Namespace[K], ValueTypes>
        : never;
};

type MergeExtensionDataTypeArgumentTypes<Extensions> =
  Extensions extends Record<string, unknown>
    ? keyof Extensions extends never
      ? Record<never, never>
      : UnionToIntersection<
          {
            [K in keyof Extensions]: ExtractDataTypeArgumentTypesFromPack<Extensions[K]>;
          }[keyof Extensions]
        >
    : Record<never, never>;

type DataTypeArgumentTypesOfPacks<Family, Target, Extensions> =
  ExtractDataTypeArgumentTypesFromPack<Family> &
    ExtractDataTypeArgumentTypesFromPack<Target> &
    MergeExtensionDataTypeArgumentTypes<Extensions>;

type FieldHelpersForCodecs<CodecTypes extends CodecTypeMap> = {
  readonly column: ColumnFieldHelper<CodecTypes>;
  readonly namedType: NamedTypeFieldHelper;
};

type CodecTypesOfPacks<Family, Target, Extensions> = ExtractCodecTypesFromPack<Family> &
  ExtractCodecTypesFromPack<Target> &
  MergeExtensionCodecTypesSafe<Extensions>;

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
    const Namespace extends string | undefined = undefined,
  >(
    modelName: ModelName,
    input: {
      readonly fields: Fields;
      readonly relations?: Relations;
      readonly namespace?: Namespace;
    },
  ): ContractModelBuilder<
    ModelName,
    Fields,
    Relations,
    undefined,
    undefined,
    IndexTypes,
    '<self>',
    NoInfer<Namespace>
  >;
  <
    Fields extends Record<string, ScalarFieldBuilder>,
    Relations extends Record<string, AnyRelationBuilder> = Record<never, never>,
    const Namespace extends string | undefined = undefined,
  >(input: {
    readonly fields: Fields;
    readonly relations?: Relations;
    readonly namespace?: Namespace;
  }): ContractModelBuilder<
    undefined,
    Fields,
    Relations,
    undefined,
    undefined,
    IndexTypes,
    '<self>',
    NoInfer<Namespace>
  >;
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
  readonly field: FieldHelpersForCodecs<CodecTypesOfPacks<Family, Target, Extensions>>;
  readonly model: PackAwareModel<MergeAllPackIndexTypes<Family, Target, Extensions>>;
  readonly rel: typeof rel;
  readonly type: TypeHelpersFromNamespace<
    ExtractTypeNamespaceFromPack<Family> &
      ExtractTypeNamespaceFromPack<Target> &
      MergeExtensionTypeNamespaces<Extensions>,
    DataTypeArgumentTypesOfPacks<Family, Target, Extensions>
  >;
  readonly gen: GeneratorHelpersOf<Family | Target | ExtensionPackValues<Extensions>>;
};

type AuthoringComponent = DataTypeComponent & {
  readonly authoring?: { readonly entityTypes?: unknown };
};

function composeTypeNamespace(components: readonly AuthoringComponent[]): AuthoringTypeNamespace {
  return composePackAuthoringNamespace(components, 'type');
}

function composeEntityNamespace(
  components: readonly AuthoringComponent[],
): AuthoringEntityTypeNamespace {
  return composePackAuthoringNamespace(components, 'entityTypes');
}

/**
 * Reserved top-level keys on the composed helpers surface — the
 * built-in `model` / `rel` helpers, the `field` / `type` / `gen` namespace
 * objects. Pack-contributed entity types are flattened to the same
 * top-level shape (e.g. `helpers.enum({...})`), so a pack cannot
 * contribute an entity type whose name collides with one of these
 * reserved keys without silently overwriting at runtime. Detect the
 * collision at compose time and fail loudly with a guidance message.
 */
const RESERVED_HELPER_KEYS: readonly string[] = ['field', 'model', 'rel', 'type', 'gen'];

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

export function createComposedAuthoringHelpers<
  Family extends FamilyPackRef<string>,
  Target extends TargetPackRef<'sql', string>,
  Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
>(options: {
  readonly family: Family;
  readonly target: Target;
  readonly extensions?: Extensions;
  readonly codecLookup: CodecLookupWithDescriptors;
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
  const entityNamespace = composeEntityNamespace(components);
  // Mirrors the call in `assembleAuthoringContributions`: PSL composes via
  // `createControlStack`, the TS DSL composes here. Both seams need the guard.
  assertNoCrossRegistryCollisions(typeNamespace, entityNamespace);
  assertNoBuiltInEntityCollisions(entityNamespace);
  const { support } = assembleDataTypeSupport(
    components,
    (codecId) => options.codecLookup.descriptorFor(codecId)?.dataType,
  );
  const helperLookups: AuthoringHelperLookups = {
    codecLookup: options.codecLookup,
    dataTypes: support,
  };

  return blindCast<
    ComposedAuthoringHelpers<Family, Target, Extensions>,
    'the helpers are the same objects for every set of packs; the packs decide only their types'
  >({
    ...createEntityHelpersFromNamespace(entityNamespace, {
      ctx: {
        family: options.family.familyId,
        target: options.target.targetId,
        codecLookup: options.codecLookup,
        dataTypes: support,
      },
    }),
    field: refusingRemovedFieldPresets(field, typeNamespace),
    model,
    rel,
    type: createTypeHelpersFromNamespace(typeNamespace, helperLookups),
    gen: createGeneratorHelpers([options.family, options.target, ...extensionValues]),
  });
}
