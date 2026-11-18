import { buildExecutionSection, computeProfileHash } from '@internal/contract/hashing';
import type { DataTypeSupport } from '@internal/framework-components/authoring';
import type { CodecLookupWithDescriptors, TypeLookups } from '@internal/framework-components/codec';
import { assembleGeneratorFunctions } from '@internal/framework-components/components';
import {
  buildMongoStorage,
  deriveCollectionValidators,
  type MongoContract,
  type MongoContractRefusal,
  mongoContractRefusalsOf,
  mongoValueSetsOf,
} from '@internal/mongo-contract';
import { ifDefined } from '@internal/utils/defined';
import { notOk, ok, type Result } from '@internal/utils/result';
import { buildCollections } from './build-collections';
import { buildEnums } from './build-enums';
import {
  buildExecutionDefaults,
  checkValueObjectExecutionDefaults,
} from './build-execution-defaults';
import { checkFields } from './build-fields';
import { buildModels, buildRoots, buildValueObjects } from './build-models';
import { decidePolymorphism, inheritVariantCollections } from './build-polymorphism';
import { type BuildRefusal, type BuildWarning, validatorRefusalKey } from './build-refusals';
import type { ContractDefinition } from './contract-definition';

/** Whether a refusal is about listing an enum in a collection validator, which matters only when collections get validators. */
function isAboutEnumListing(refusal: MongoContractRefusal): boolean {
  return (
    refusal.kind === 'enumBsonType' ||
    refusal.kind === 'enumNotListable' ||
    refusal.kind === 'enumMemberNotListable'
  );
}

/** A contract the builder built, with the warnings to report about it. */
export interface BuiltContract {
  readonly contract: MongoContract;
  readonly warnings: readonly BuildWarning[];
}

/** Why the builder refused a definition, with the warnings to report about it all the same. */
export interface BuildFailure {
  readonly refusals: readonly BuildRefusal[];
  readonly warnings: readonly BuildWarning[];
}

/**
 * Builds a MongoDB contract from its plain-data definition, with the stack's codecs and data types. Every MongoDB family rule is checked here, and each refusal comes back as data keyed by the part of the definition it is about, for the source to report in its own terms.
 */
export function buildMongoContractFromDefinition(
  definition: ContractDefinition,
  codecLookup: CodecLookupWithDescriptors,
  dataTypes: DataTypeSupport,
): Result<BuiltContract, BuildFailure> {
  const refusals: BuildRefusal[] = [];
  const warnings: BuildWarning[] = (definition.warnings ?? []).map((warning) => ({
    kind: 'source',
    warning,
  }));
  const namespaceId = definition.target.defaultNamespaceId;
  const lookups: TypeLookups = { codecLookup, dataTypeLookup: dataTypes.lookup };
  const components = [definition.target, ...Object.values(definition.extensions ?? {})];
  const generatorFunctions = assembleGeneratorFunctions(components);

  const models = inheritVariantCollections(definition.models, refusals);
  const builtEnums = buildEnums(definition, codecLookup, refusals);
  const variantValues = decidePolymorphism({
    models,
    enums: builtEnums,
    codecLookup,
    dataTypes,
    refusals,
  });
  const builtModels = buildModels({ models, variantValues, namespaceId, refusals });
  const builtValueObjects = buildValueObjects(definition.valueObjects, namespaceId, refusals);
  checkFields({
    models,
    valueObjects: definition.valueObjects,
    declaredEnums: new Set(Object.keys(definition.enums ?? {})),
    lookups,
    refusals,
    warnings,
  });
  const collections = buildCollections({ models, variantValues, refusals });
  checkValueObjectExecutionDefaults(definition.valueObjects, refusals);
  const executionDefaults = buildExecutionDefaults({
    models,
    generatorFunctions,
    namespaceId,
    refusals,
  });
  if (refusals.length > 0) return notOk({ refusals, warnings });

  const controlPolicies = {
    collections: Object.fromEntries(
      Object.entries(collections).map(([name, collection]) => [name, collection.control]),
    ),
    defaultControlPolicy: definition.defaultControlPolicy,
  };
  const validatorRefusals = mongoContractRefusalsOf({
    models: builtModels,
    valueObjects: builtValueObjects,
    enums: builtEnums,
    lookups,
    controlPolicies,
  }).filter((refusal) => definition.writesCollectionValidators || !isAboutEnumListing(refusal));
  if (validatorRefusals.length > 0) {
    return notOk({
      refusals: validatorRefusals.map((refusal) => ({
        kind: 'validator' as const,
        key: validatorRefusalKey(refusal),
        refusal,
      })),
      warnings,
    });
  }

  const storageValueSets = mongoValueSetsOf(builtEnums);
  const validators = definition.writesCollectionValidators
    ? deriveCollectionValidators({
        models: builtModels,
        lookups,
        storage: {
          namespaces: {
            [namespaceId]: { id: namespaceId, entries: { valueObject: builtValueObjects } },
          },
        },
        valueSets: storageValueSets,
        controlPolicies,
      })
    : {};
  const storage = buildMongoStorage({
    namespaceId,
    collections: Object.fromEntries(
      Object.entries(collections).map(([name, collection]) => [
        name,
        { ...collection, ...ifDefined('validator', validators[name]) },
      ]),
    ),
    valueSets: storageValueSets,
    valueObjects: builtValueObjects,
  });
  // Contracts carry no capabilities when built; emit adds the stack's. The profile hash fingerprints this empty set.
  const capabilities: Record<string, Record<string, boolean>> = {};
  const execution = buildExecutionSection({
    target: definition.target.targetId,
    targetFamily: definition.target.familyId,
    defaults: executionDefaults,
  });

  return ok({
    contract: {
      target: definition.target.targetId,
      targetFamily: definition.target.familyId,
      ...ifDefined('defaultControlPolicy', definition.defaultControlPolicy),
      roots: buildRoots(definition, models, namespaceId),
      domain: {
        namespaces: {
          [namespaceId]: {
            models: builtModels,
            ...(Object.keys(builtEnums).length > 0 ? { enum: builtEnums } : {}),
          },
        },
      },
      storage,
      capabilities,
      extensions: definition.extensions ?? {},
      profileHash: computeProfileHash({
        target: definition.target.targetId,
        targetFamily: definition.target.familyId,
        capabilities,
      }),
      meta: {},
      ...ifDefined('execution', execution),
    },
    warnings,
  });
}
