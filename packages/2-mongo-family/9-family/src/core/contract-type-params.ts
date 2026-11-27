import { ContractValidationError } from '@internal/contract/contract-validation-error';
import {
  type ContractFieldType,
  type ScalarFieldType,
  valueObjectsWithCoordinates,
} from '@internal/contract/types';
import type { TypeLookups } from '@internal/framework-components/codec';
import type { MongoContract } from '@internal/mongo-contract';
import { codecTypeParamsProblem } from '@internal/mongo-contract/data-type';

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

function fieldProblems(
  path: string,
  fields: Readonly<Record<string, { readonly type: ContractFieldType }>>,
  lookups: TypeLookups,
): readonly string[] {
  return Object.entries(fields).flatMap(([fieldName, field]) =>
    scalarTypesOf(`${path}.fields.${fieldName}.type`, field.type).flatMap(({ path, type }) => {
      if (type.typeParams === undefined) return [];
      const problem = codecTypeParamsProblem(type.codecId, type.typeParams, lookups);
      return problem === undefined ? [] : [`${path}.typeParams: ${problem.message}`];
    }),
  );
}

/**
 * Refuses a contract whose model or value-object field gives its data type a parameter the data type does not accept, as the contract builder refuses it. A codec or data type the stack does not register is not checked.
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
