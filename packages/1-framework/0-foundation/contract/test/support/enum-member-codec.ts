import type { EnumMemberCodec } from '../../src/enum-accessor';
import type { JsonValue } from '../../src/types';

export interface StoredFormConversions {
  readonly fromStored: (json: JsonValue) => unknown;
  readonly toStored: (value: unknown) => JsonValue;
  /** The data type's key for values its equality holds equal, when it has one. */
  readonly equalityKey?: (json: JsonValue) => string;
}

/** An enum member codec whose data type holds any stored form as it is. */
export function enumMemberCodec(conversions: StoredFormConversions): EnumMemberCodec {
  return {
    dataType: {
      fromContract: (json) => ({ stored: json }),
      toContract: (value) => (value as { readonly stored: JsonValue }).stored,
      ...(conversions.equalityKey === undefined ? {} : { equalityKey: conversions.equalityKey }),
    },
    fromDataTypeValue: (value) =>
      conversions.fromStored((value as { readonly stored: JsonValue }).stored),
    toDataTypeValue: (value) => ({ stored: conversions.toStored(value) }),
  };
}
