import type { AnyCodecDescriptor } from '@internal/framework-components/codec';
import { sqliteCodecDescriptorRegistry } from '@internal/target-sqlite/codecs';
import sqliteTargetDescriptor from '@internal/target-sqlite/control';
import sqliteAdapterDescriptor from '../../../src/exports/control';

export const sqliteComponents = [sqliteTargetDescriptor, sqliteAdapterDescriptor] as const;

const textDescriptor = sqliteCodecDescriptorRegistry.descriptorFor('sqlite/text@1')!;

export function textCodecDescriptor(codecId: string): AnyCodecDescriptor {
  return {
    codecId,
    dataType: textDescriptor.dataType,
    traits: textDescriptor.traits,
    paramsSchema: textDescriptor.paramsSchema,
    isParameterized: false,
    factory: (params: undefined) => textDescriptor.factory(params),
  };
}
