import type { TargetPackRef } from '@internal/framework-components/components';

/** Everything the Mongo target supplies to the Prisma 6 schema reader. */
export interface Prisma6TargetBinding {
  readonly target: TargetPackRef<'mongo', string>;
  /** The datasource `provider` values the target reads; messages name the first. */
  readonly providers: readonly [string, ...string[]];
  /** The codec each Prisma 6 scalar type maps to. `String` and `Int` also type enums. */
  readonly scalarCodecIds: Readonly<Record<string, string>> & {
    readonly String: string;
    readonly Int: string;
    readonly DateTime: string;
  };
  /** The codec each native type selects, keyed by scalar type and then by native type (`db.Int`). A native type missing here is not supported. */
  readonly nativeTypeCodecIds: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** The ObjectId codec, which a model's `@id` must have. */
  readonly objectIdCodecId: string;
  /** The generator `@default(now())` and `@updatedAt` lower to on a `DateTime` field. */
  readonly timestampGeneratorId: string;
}
