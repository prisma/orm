import { ContractValidationError } from './contract-validation-error';
import {
  type FieldLike,
  fieldLike,
  fieldModifierProblems,
  valueObjectTypeProblems,
} from './field-problems';
import { isPlainRecord } from './is-plain-record';
import { valueObjectsWithCoordinates } from './storage-value-objects';
import type { StorageBase } from './types';

/**
 * Checks the fields of the value objects in storage (ADR 309): each value object a field refers to is in storage, each value set a member names is in storage, and each field's `many` and `dict` are well formed. Both families run it beside `validateContractDomain`, which checks the references from the domain to storage.
 */
export function validateStorageValueObjects(storage: Pick<StorageBase, 'namespaces'>): void {
  const errors = valueObjectsWithCoordinates(storage).flatMap(
    ({ coordinate: { namespaceId, entityName }, valueObject }) =>
      Object.entries(valueObject.fields).flatMap(([fieldName, field]) => {
        const location = `Value object "${namespaceId}:${entityName}" field "${fieldName}"`;
        const valueSetProblem = missingValueSetProblem(storage, fieldLike(field)?.valueSet);
        return [
          ...valueObjectTypeProblems(storage, fieldLike(field)?.type, location),
          ...(valueSetProblem === undefined ? [] : [`${location} ${valueSetProblem}`]),
          ...fieldModifierProblems(location, field),
        ];
      }),
  );
  if (errors.length > 0) {
    throw new ContractValidationError(
      `Contract storage validation failed:\n- ${errors.join('\n- ')}`,
      'storage',
    );
  }
}

function missingValueSetProblem(
  storage: Pick<StorageBase, 'namespaces'>,
  valueSet: FieldLike['valueSet'],
): string | undefined {
  if (valueSet === undefined) return undefined;
  const namespaceId = valueSet.namespaceId ?? '';
  const entityName = valueSet.entityName ?? '';
  const slot = Object.hasOwn(storage.namespaces, namespaceId)
    ? storage.namespaces[namespaceId]?.entries?.['valueSet']
    : undefined;
  return isPlainRecord(slot) && Object.hasOwn(slot, entityName)
    ? undefined
    : `refers to value set "${entityName}" in storage namespace "${namespaceId}", which storage.namespaces.${namespaceId}.entries.valueSet does not have`;
}
