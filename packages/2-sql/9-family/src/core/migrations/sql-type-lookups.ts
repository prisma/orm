import { assembleDataTypes } from '@internal/framework-components/codec';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import { extractCodecLookup } from '@internal/framework-components/control';
import type { SqlTypeLookups } from '@internal/sql-contract/data-type';

/** The codecs and data types a set of composed components registers. */
export function sqlTypeLookupsOf(
  frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>,
): SqlTypeLookups {
  return {
    codecLookup: extractCodecLookup(frameworkComponents),
    dataTypeLookup: assembleDataTypes(frameworkComponents).lookup,
  };
}
