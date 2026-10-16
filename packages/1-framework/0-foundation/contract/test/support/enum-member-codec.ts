import type { EnumMemberCodec } from '../../src/enum-accessor';
import type { JsonValue } from '../../src/types';

export interface StoredFormConversions {
  readonly fromStored: (json: JsonValue) => unknown;
  readonly toStored: (value: unknown) => JsonValue;
}

/** An enum member codec whose data type holds any stored form as it is. */
export function enumMemberCodec(conversions: StoredFormConversions): EnumMemberCodec {
  return {
    dataType: {
      fromContract: (json) => ({ stored: json }),
      toContract: (value) => (value as { readonly stored: JsonValue }).stored,
    },
    fromDataTypeValue: (value) =>
      conversions.fromStored((value as { readonly stored: JsonValue }).stored),
    toDataTypeValue: (value) => ({ stored: conversions.toStored(value) }),
  };
}
