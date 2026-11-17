import type { ControlPolicy } from '@internal/contract/types';
import type {
  ExtensionPackRef,
  FamilyPackRef,
  TargetPackRef,
} from '@internal/framework-components/components';
import { ifDefined } from '@internal/utils/defined';
import type {
  ContractDefinition,
  FieldNode,
  ModelNode,
  RelationNode,
  ValueObjectNode,
} from './contract-definition';
import {
  type AnyFieldBuilder,
  type AnyModelBuilder,
  type AnyValueObjectBuilder,
  type ModelNameInput,
  resolveModelName,
} from './contract-dsl';
import { contractError } from './contract-errors';
import type { EnumTypeHandle } from './enum-type';

/** What `defineContract` receives once a factory has run: the stack and the builder objects. */
export interface DslContractInput {
  readonly family: FamilyPackRef<string>;
  readonly target: TargetPackRef<string, string>;
  readonly extensions?: Record<string, ExtensionPackRef<string, string>> | undefined;
  readonly roots?: Record<string, ModelNameInput> | undefined;
  readonly defaultControlPolicy?: ControlPolicy | undefined;
  readonly models?: Record<string, AnyModelBuilder> | undefined;
  readonly valueObjects?: Record<string, AnyValueObjectBuilder> | undefined;
  readonly enums?: Record<string, EnumTypeHandle> | undefined;
}

function validateTargetPackRef(
  family: FamilyPackRef<string>,
  target: TargetPackRef<string, string>,
): asserts target is TargetPackRef<'mongo', string> {
  if (family.familyId !== 'mongo') {
    throw contractError(
      'CONTRACT.PACK_FAMILY_MISMATCH',
      `defineContract only accepts Mongo family packs. Received family "${family.familyId}".`,
      { meta: { packId: family.id, packFamilyId: family.familyId, contractFamilyId: 'mongo' } },
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

function validateExtensionPackRefs(
  target: TargetPackRef<string, string>,
  extensions: Record<string, ExtensionPackRef<string, string>> | undefined,
): void {
  for (const packRef of Object.values(extensions ?? {})) {
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

function fieldNodes(fields: Record<string, AnyFieldBuilder>): FieldNode[] {
  return Object.entries(fields).map(([fieldName, builder]) => ({
    fieldName,
    ...ifDefined('storedName', builder.__storedName),
    type: builder.__type,
    nullable: builder.__nullable,
    many: builder.__many,
    ...ifDefined('enumName', builder.__enumHandle?.enumName),
    ...ifDefined('executionDefaults', builder.__executionDefaults),
    ...ifDefined('generatorCalls', builder.__generatorCalls),
  }));
}

function relationNodes(builder: AnyModelBuilder): RelationNode[] {
  return Object.entries(builder.__relations).map(([relationName, relation]) => {
    const common = { relationName, toModel: relation.__to, nullable: relation.__nullable };
    return relation.__on === undefined
      ? { ...common, cardinality: relation.__cardinality }
      : { ...common, cardinality: relation.__cardinality, on: relation.__on };
  });
}

function modelNode(
  builder: AnyModelBuilder,
  buildersByName: ReadonlyMap<string, AnyModelBuilder>,
): ModelNode {
  const base = builder.__base;
  const variantValue =
    base === undefined ? undefined : buildersByName.get(base)?.__variants?.[builder.__name]?.value;
  return {
    modelName: builder.__name,
    ...ifDefined('collection', builder.__collection),
    ...ifDefined('owner', builder.__owner),
    ...ifDefined('storageRelations', builder.__storageRelations),
    ...ifDefined('controlPolicy', builder.__controlPolicy),
    ...ifDefined('collectionOptions', builder.__collectionOptions),
    ...ifDefined('indexes', builder.__indexes),
    fields: fieldNodes(builder.__fields),
    relations: relationNodes(builder),
    ...(builder.__discriminator === undefined
      ? {}
      : {
          discriminator: {
            field: builder.__discriminator.field,
            listedVariants: Object.keys(builder.__variants ?? {}),
          },
        }),
    ...(base === undefined
      ? {}
      : {
          base: {
            model: base,
            value: variantValue === undefined ? undefined : { kind: 'string', text: variantValue },
          },
        }),
  };
}

function valueObjectNode(builder: AnyValueObjectBuilder): ValueObjectNode {
  return { name: builder.__name, fields: fieldNodes(builder.__fields) };
}

/** Turns `defineContract`'s builder objects into the plain-data definition the contract is built from. */
export function buildContractDefinition(input: DslContractInput): ContractDefinition {
  const { target } = input;
  validateTargetPackRef(input.family, target);
  validateExtensionPackRefs(target, input.extensions);
  const builders = Object.values(input.models ?? {});
  const buildersByName = new Map<string, AnyModelBuilder>();
  for (const builder of builders) {
    if (!buildersByName.has(builder.__name)) buildersByName.set(builder.__name, builder);
  }
  return {
    target,
    ...ifDefined('extensions', input.extensions),
    ...ifDefined('defaultControlPolicy', input.defaultControlPolicy),
    models: builders.map((builder) => modelNode(builder, buildersByName)),
    valueObjects: Object.values(input.valueObjects ?? {}).map(valueObjectNode),
    ...ifDefined('enums', input.enums),
    ...ifDefined(
      'roots',
      input.roots === undefined
        ? undefined
        : Object.fromEntries(
            Object.entries(input.roots).map(([rootName, model]) => [
              rootName,
              resolveModelName(model),
            ]),
          ),
    ),
    writesCollectionValidators: true,
    warnings: undefined,
  };
}
