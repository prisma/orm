import type { AggregateDescriptor } from '@internal/framework-components/components';

type PackDescriptors<Pack> = Pack extends {
  readonly __aggregateDescriptors?: ReadonlyArray<infer Descriptor extends AggregateDescriptor>;
}
  ? Descriptor
  : never;

type Descriptors<Packs> = {
  [Key in keyof Packs]: PackDescriptors<Packs[Key]>;
}[keyof Packs];

type CodecTraits<Codec> = Codec extends { readonly traits: infer Traits } ? Traits : never;

type ExactMatch<Descriptor, Id> = Descriptor extends {
  readonly input: { readonly kind: 'codec'; readonly codecId: infer CodecId };
}
  ? Id extends CodecId
    ? Descriptor
    : never
  : never;

type TraitMatch<Descriptor, Traits> = Descriptor extends {
  readonly input: { readonly kind: 'trait'; readonly trait: infer Trait };
}
  ? Trait extends Traits
    ? Descriptor
    : never
  : never;

type Fallback<First, Second> = [First] extends [never] ? Second : First;

type Match<Descriptor, Id, Codec> = Fallback<
  ExactMatch<Descriptor, Id>,
  TraitMatch<Descriptor, CodecTraits<Codec>>
>;

type Result<Descriptor, Id> = Descriptor extends {
  readonly output: infer Output;
  readonly nullable: infer Nullable extends boolean;
}
  ? {
      readonly output: Output extends {
        readonly kind: 'codec';
        readonly codecId: infer CodecId extends string;
      }
        ? CodecId
        : Id & string;
      readonly nullable: Nullable;
    }
  : never;

type Operation<Descriptor, Codecs> = {
  readonly byCodec: {
    readonly [Id in keyof Codecs & string as [Match<Descriptor, Id, Codecs[Id]>] extends [never]
      ? never
      : Id]: Result<Match<Descriptor, Id, Codecs[Id]>, Id>;
  };
} & ([Extract<Descriptor, { readonly input: { readonly kind: 'any' | 'none' } }>] extends [never]
  ? Record<never, never>
  : {
      readonly withoutInput: Result<
        Extract<Descriptor, { readonly input: { readonly kind: 'any' | 'none' } }>,
        never
      >;
    }) &
  ([Extract<Descriptor, { readonly input: { readonly kind: 'any' } }>] extends [never]
    ? Record<never, never>
    : {
        readonly anyInput: Result<
          Extract<Descriptor, { readonly input: { readonly kind: 'any' } }>,
          never
        >;
      });

export type AggregateTypesFromPacks<Packs, Codecs> = {
  readonly [Name in Descriptors<Packs>['operation']]: Operation<
    Extract<Descriptors<Packs>, { readonly operation: Name }>,
    Codecs
  >;
};
