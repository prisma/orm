import type { BoundEnumType } from '@internal/contract-authoring';
import {
  bindEnumType,
  type ExtractCodecTypesFromPack,
} from '@internal/mongo-contract-ts/contract-builder';
import type mongoTargetPack from '@internal/target-mongo/pack';

type MongoCodecTypes = ExtractCodecTypesFromPack<typeof mongoTargetPack>;

/**
 * The `enumType` authors call when building a Mongo contract (re-exported
 * from `@internal/mongo/contract-builder`).
 *
 * `bindEnumType` is the core, codec-agnostic `enumType` factory; calling it
 * with the Mongo target pack's codec typemap constrains member values to the
 * codec's input type so `mongo/string@1` requires string values and a
 * mismatch is a compile error.
 */
export const enumType: BoundEnumType<MongoCodecTypes> = bindEnumType<MongoCodecTypes>();
