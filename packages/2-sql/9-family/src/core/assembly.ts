import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import { assertUniqueCodecOwner } from '@internal/framework-components/control';
import { blindCast } from '@internal/utils/casts';
import type { CodecControlHooks } from './migrations/types';

type CodecControlHooksMap = Record<string, CodecControlHooks>;

function hasCodecControlHooks(descriptor: unknown): descriptor is {
  readonly id: string;
  readonly types: {
    readonly codecTypes: {
      readonly controlPlaneHooks: CodecControlHooksMap;
    };
  };
} {
  if (typeof descriptor !== 'object' || descriptor === null) {
    return false;
  }
  const d = blindCast<
    { types?: { codecTypes?: { controlPlaneHooks?: unknown } } },
    'object check proves descriptor is property-readable, nested optional fields are probed defensively'
  >(descriptor);
  const hooks = d.types?.codecTypes?.controlPlaneHooks;
  return hooks !== null && hooks !== undefined && typeof hooks === 'object';
}

export function extractCodecControlHooks(
  descriptors: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>,
): Map<string, CodecControlHooks> {
  const hooks = new Map<string, CodecControlHooks>();
  const owners = new Map<string, string>();

  for (const descriptor of descriptors) {
    if (typeof descriptor !== 'object' || descriptor === null) {
      continue;
    }
    if (!hasCodecControlHooks(descriptor)) {
      continue;
    }
    const controlPlaneHooks = descriptor.types.codecTypes.controlPlaneHooks;
    for (const [codecId, hook] of Object.entries(controlPlaneHooks)) {
      assertUniqueCodecOwner({
        codecId,
        owners,
        descriptorId: descriptor.id,
        entityLabel: 'control hooks',
        entityOwnershipLabel: 'owner',
      });
      hooks.set(codecId, hook);
      owners.set(codecId, descriptor.id);
    }
  }

  return hooks;
}
