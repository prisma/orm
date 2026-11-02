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
  readonly codecs: () => MongoCodecRegistry;
}

/**
 * One registry holding the codecs of every contributor, such as an execution stack's target, adapter and extensions. Throws `RUNTIME.DUPLICATE_CODEC` naming both contributors when two contribute the same codec id.
 */
export function composeMongoCodecRegistry(
  contributors: readonly MongoCodecContributor[],
): MongoCodecRegistry {
  const registry = newMongoCodecRegistry();
  const owners = new Map<string, string>();
  for (const contributor of contributors) {
    for (const codec of contributor.codecs().values()) {
      const existingOwner = owners.get(codec.id);
      if (existingOwner !== undefined) {
        throw runtimeError(
          'RUNTIME.DUPLICATE_CODEC',
          `Duplicate Mongo codec id '${codec.id}' contributed by '${contributor.id}' (already registered by '${existingOwner}').`,
          { codecId: codec.id, existingOwner, incomingOwner: contributor.id },
        );
      }
      registry.register(codec);
      owners.set(codec.id, contributor.id);
    }
  }
  return registry;
}
