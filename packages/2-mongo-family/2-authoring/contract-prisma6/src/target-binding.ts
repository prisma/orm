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
  /** The codec `@db.ObjectId` selects on a `String` field. */
  readonly objectIdCodecId: string;
  /** The generator `@default(now())` and `@updatedAt` lower to on a `DateTime` field. */
  readonly timestampGeneratorId: string;
}
