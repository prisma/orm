import type { DataType } from '@internal/framework-components/codec';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import { assembleDataTypes } from '@internal/framework-components/control';

/** The data type a codec represents, or `undefined` when no component registers it. */
export type DataTypeResolver = (codecId: string) => DataType | undefined;

/**
 * Builds the resolver the contract→IR derivation uses to give each column its data type (ADR 254):
 * the codec's descriptor names the type, and the composed components register it. Codecs and
 * data types from extension packs are found the same way as the target's own. Returns `undefined`
 * when no framework components are supplied, so callers can omit the option.
 */
export function buildDataTypeResolver(
  frameworkComponents?: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>,
): DataTypeResolver | undefined {
  if (!frameworkComponents) {
    return undefined;
  }
  const dataTypes = assembleDataTypes(frameworkComponents).lookup;
  const dataTypeOfCodec = new Map<string, string>();
  for (const component of frameworkComponents) {
    for (const descriptor of component.types?.codecTypes?.codecDescriptors ?? []) {
      dataTypeOfCodec.set(descriptor.codecId, descriptor.dataType);
    }
  }
  return (codecId) => {
    const dataTypeId = dataTypeOfCodec.get(codecId);
    return dataTypeId === undefined ? undefined : dataTypes.get(dataTypeId);
  };
}
