import { assembleDataTypes, type TypeLookups } from '@internal/framework-components/codec';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import { extractCodecLookup } from '@internal/framework-components/control';

/** The codecs and data types a set of composed components registers. */
export function sqlTypeLookupsOf(
  frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>,
): TypeLookups {
  return {
    codecLookup: extractCodecLookup(frameworkComponents),
    dataTypeLookup: assembleDataTypes(frameworkComponents).lookup,
  };
}
