import {
  bindEnumType,
  type ExtractCodecTypesFromPack,
} from '@internal/sql-contract-ts/contract-builder';
import type mysqlPack from '@internal/target-mysql/pack';

/** `enumType` bound to the pack's codec types, so each `member()` value is checked against the enum codec's input type. */
export const enumType = bindEnumType<ExtractCodecTypesFromPack<typeof mysqlPack>>();
