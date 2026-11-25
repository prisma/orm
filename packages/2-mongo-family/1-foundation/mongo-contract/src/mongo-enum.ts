import type { ContractEnum } from '@internal/contract/types';
import type { MongoValueSetInput } from './ir/mongo-value-set';

/**
 * The storage value set of each enum: its members as the contract holds them, in the form their codec stores.
 */
export function mongoValueSetsOf(
  enums: Readonly<Record<string, ContractEnum>>,
): Record<string, MongoValueSetInput> {
  return Object.fromEntries(
    Object.entries(enums).map(([enumName, { members }]): [string, MongoValueSetInput] => [
      enumName,
      { kind: 'valueSet', values: members.map((member) => member.value) },
    ]),
  );
}
