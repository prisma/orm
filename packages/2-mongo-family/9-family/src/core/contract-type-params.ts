import { ContractValidationError } from '@internal/contract/contract-validation-error';
import {
  type ContractFieldType,
  type ScalarFieldType,
  valueObjectsWithCoordinates,
} from '@internal/contract/types';
import { type TypeLookups, validateCodecTypeParams } from '@internal/framework-components/codec';
import type { MongoContract } from '@internal/mongo-contract';
import { codecTypeParamsProblem } from '@internal/mongo-contract/data-type';
import { isInternalError } from '@internal/utils/internal-error';

function scalarTypesOf(
  path: string,
  type: ContractFieldType,
): readonly { readonly path: string; readonly type: ScalarFieldType }[] {
  if (type.kind === 'scalar') return [{ path, type }];
  if (type.kind === 'union') {
    return type.members.flatMap((member, index) =>
      scalarTypesOf(`${path}.members[${index}]`, member),
    );
  }
  return [];
}

function typeParamsProblem(
  codecId: string,
  typeParams: Readonly<Record<string, unknown>>,
  lookups: TypeLookups,
): string | undefined {
  const descriptor = lookups.codecLookup.descriptorFor(codecId);
  if (descriptor === undefined) return undefined;
  const dataType = lookups.dataTypeLookup.get(descriptor.dataType);
  if (dataType?.params !== undefined) {
    return codecTypeParamsProblem(codecId, typeParams, lookups)?.message;
  }
  try {
    validateCodecTypeParams(descriptor, { codecId, typeParams });
    return undefined;
  } catch (error) {
    if (!(error instanceof Error) || isInternalError(error)) throw error;
    return error.message;
  }
}

function fieldProblems(
  path: string,
  fields: Readonly<Record<string, { readonly type: ContractFieldType }>>,
  lookups: TypeLookups,
): readonly string[] {
  return Object.entries(fields).flatMap(([fieldName, field]) =>
    scalarTypesOf(`${path}.fields.${fieldName}.type`, field.type).flatMap(({ path, type }) => {
      if (type.typeParams === undefined) return [];
      const problem = typeParamsProblem(type.codecId, type.typeParams, lookups);
      return problem === undefined ? [] : [`${path}.typeParams: ${problem}`];
    }),
  );
}

/**
 * Refuses a contract whose model or value-object field gives its type a parameter it does not accept: the data type's parameter schema decides when it has one, as the contract builder does, and otherwise the codec's, so a type that takes no parameters refuses any. A codec the stack does not register is not checked.
 */
export function assertFieldTypeParams(contract: MongoContract, lookups: TypeLookups): void {
  const problems = [
    ...Object.entries(contract.domain.namespaces).flatMap(([namespaceId, namespace]) =>
      Object.entries(namespace.models).flatMap(([modelName, model]) =>
        fieldProblems(
          `domain.namespaces.${namespaceId}.models.${modelName}`,
          model.fields,
          lookups,
        ),
      ),
    ),
    ...valueObjectsWithCoordinates(contract.storage).flatMap(({ coordinate, valueObject }) =>
      fieldProblems(
        `storage.namespaces.${coordinate.namespaceId}.entries.valueObject.${coordinate.entityName}`,
        valueObject.fields,
        lookups,
      ),
    ),
  ];
  if (problems.length > 0) {
    throw new ContractValidationError(problems.join('; '), 'domain');
  }
}
