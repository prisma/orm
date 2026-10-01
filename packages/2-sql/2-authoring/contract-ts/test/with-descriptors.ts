import type {
  AnyCodecDescriptor,
  CodecLookup,
  CodecLookupWithDescriptors,
} from '@internal/framework-components/codec';

/**
 * A stub lookup with a descriptor for each codec it holds, so a column's codec is built through `descriptorFor` as the control stack's lookup builds it. Each descriptor takes no type parameters and hands out the lookup's codec.
 */
export function withDescriptors(lookup: CodecLookup): CodecLookupWithDescriptors {
  return {
    ...lookup,
    descriptorFor: (id) => {
      const codec = lookup.get(id);
      return codec === undefined
        ? undefined
        : ({
            codecId: id,
            paramsSchema: undefined,
            factory: () => () => codec,
          } as unknown as AnyCodecDescriptor);
    },
  };
}
