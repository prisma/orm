import type { AnyCodecDescriptor } from '@internal/framework-components/codec';
import { runtimeError } from '@internal/framework-components/runtime';
import { structuredError } from '@internal/utils/structured-error';
import type { MongoCodec } from './codecs';

export interface MongoCodecRegistry {
  get(id: string): MongoCodec<string> | undefined;
  has(id: string): boolean;
  register(codec: MongoCodec<string>): void;
  [Symbol.iterator](): Iterator<MongoCodec<string>>;
  values(): IterableIterator<MongoCodec<string>>;
}

/**
 * Create a new Mongo codec registry. Inline object literal — no class implementation; the registry is just a private `Map` with the documented surface methods.
 */
export function newMongoCodecRegistry(): MongoCodecRegistry {
  const byId = new Map<string, MongoCodec<string>>();
  return {
    get: (id) => byId.get(id),
    has: (id) => byId.has(id),
    register: (codec) => {
      if (byId.has(codec.id)) {
        throw structuredError(
          'RUNTIME.DUPLICATE_CODEC',
          `Codec with ID '${codec.id}' is already registered`,
        );
      }
      byId.set(codec.id, codec);
    },
    values: () => byId.values(),
    [Symbol.iterator]: function* () {
      yield* byId.values();
    },
  };
}

export interface MongoCodecContributor {
  readonly id: string;
  readonly types?: {
    readonly codecTypes?: {
      readonly codecDescriptors?: ReadonlyArray<AnyCodecDescriptor>;
    };
  };
}

/**
 * One registry holding the codec of every descriptor in each contributor's `types.codecTypes.codecDescriptors`, such as an execution stack's target, adapter and extensions. A codec whose data type has parameters is registered as its descriptor builds it without parameters. Throws `RUNTIME.DUPLICATE_CODEC` naming both contributors when two contribute the same codec id.
 */
export function assembleMongoCodecRegistry(
  contributors: readonly MongoCodecContributor[],
): MongoCodecRegistry {
  const registry = newMongoCodecRegistry();
  const owners = new Map<string, string>();
  for (const contributor of contributors) {
    for (const descriptor of contributor.types?.codecTypes?.codecDescriptors ?? []) {
      const existingOwner = owners.get(descriptor.codecId);
      if (existingOwner !== undefined) {
        throw runtimeError(
          'RUNTIME.DUPLICATE_CODEC',
          `Duplicate Mongo codec id '${descriptor.codecId}' contributed by '${contributor.id}' (already registered by '${existingOwner}').`,
          { codecId: descriptor.codecId, existingOwner, incomingOwner: contributor.id },
        );
      }
      registry.register(descriptor.factory(undefined)({ name: descriptor.codecId }));
      owners.set(descriptor.codecId, contributor.id);
    }
  }
  return registry;
}
