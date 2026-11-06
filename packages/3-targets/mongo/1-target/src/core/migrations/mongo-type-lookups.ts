import { assembleDataTypes, type TypeLookups } from '@internal/framework-components/codec';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import { extractCodecLookup } from '@internal/framework-components/control';

/** The codecs and data types the composed components register, an extension's among them. */
export function mongoTypeLookupsOf(
  frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'mongo', 'mongo'>>,
): TypeLookups {
  return {
    codecLookup: extractCodecLookup(frameworkComponents),
    dataTypeLookup: assembleDataTypes(frameworkComponents).lookup,
  };
}
