import type { ContractField } from '@internal/contract/types';
import { deserialize, widgetContract } from './refusal-support';

/** A contract whose one value object, `Address`, has the one member `street`. */
export function addressContract(field: ContractField) {
  return deserialize(
    widgetContract({
      columns: { address: { nativeType: 'jsonb', codecId: 'pg/jsonb@1', nullable: false } },
      fields: { address: { nullable: false, type: { kind: 'valueObject', name: 'Address' } } },
      domain: { valueObjects: { Address: { fields: { street: field } } } },
    }),
  );
}

const countryEnumParts = {
  enum: { Country: { codecId: 'pg/text@1', members: [{ name: 'DE', value: 'DE' }] } },
} as const;
export const countryValueSet = {
  plane: 'domain',
  entityKind: 'enum',
  namespaceId: 'public',
  entityName: 'Country',
} as const;

/** A contract whose value object `Address` has the given members, beside the domain enum `Country`. */
export function withCountryMembers(fields: Record<string, ContractField>) {
  return deserialize(
    widgetContract({
      columns: { address: { nativeType: 'jsonb', codecId: 'pg/jsonb@1', nullable: false } },
      fields: { address: { nullable: false, type: { kind: 'valueObject', name: 'Address' } } },
      domain: { ...countryEnumParts, valueObjects: { Address: { fields } } },
      entries: { valueSet: { Country: { kind: 'valueSet', values: ['DE'] } } },
    }),
  );
}
