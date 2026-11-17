import type { ContractEnum } from '@internal/contract/types';
import type { MongoValueSetInput } from './ir/mongo-value-set';

/**
 * The storage value set of each enum: its members as the contract holds them, in the form their codec stores.
 */
export function mongoValueSetsOf(
  enums: Readonly<Record<string, ContractEnum>>,
): Record<string, MongoValueSetInput> {
  const valueSets: Record<string, MongoValueSetInput> = {};
  for (const [enumName, { members }] of Object.entries(enums)) {
    valueSets[enumName] = { kind: 'valueSet', values: members.map((member) => member.value) };
  }
  return valueSets;
}
