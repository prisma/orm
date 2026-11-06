import type { CodecDescriptor, CodecRef } from '@internal/framework-components/codec';
import type { SqlStorage } from '@internal/sql-contract/types';
import { structuredError } from '@internal/utils/structured-error';
import type { AnyCodecDescriptor } from './ast/codec-types';
import { codecRefForStorageColumn } from './codec-ref-for-column';
import type { CodecDescriptorRegistry } from './query-lane-context';

/**
 * Build a {@link CodecDescriptorRegistry} from a flat descriptor list.
 *
 * Used by:
 * - Each codec-shipping package's `core/registry.ts` to expose a package-scoped registry as the public consumer surface (replacing raw descriptor-array exports). See ADR 208.
 * - The runtime's `buildExecutionContext` to construct the contract-bound combined registry from every contributor's `codecs:` slot.
 *
 * The descriptor map is heterogeneous in `P` — each codec id has its own params shape. The public {@link CodecDescriptorRegistry} interface widens to `CodecDescriptor<unknown>` and consumers narrow per codec id at the call site (the descriptor's `paramsSchema` validates JSON-sourced params before the factory ever sees them, so the runtime narrow is safe). The cast at registration goes through `unknown` because
 * `CodecDescriptor<P>` is invariant in `P` (the `factory` and `renderOutputType` slots use `P` contravariantly).
 */
export function buildCodecDescriptorRegistry(
  allDescriptors: ReadonlyArray<AnyCodecDescriptor>,
  storage?: SqlStorage,
): CodecDescriptorRegistry {
  type AnyDescriptor = CodecDescriptor<unknown>;
  const byId = new Map<string, AnyDescriptor>();

  for (const descriptor of allDescriptors) {
    if (byId.has(descriptor.codecId)) {
      throw structuredError(
        'RUNTIME.DUPLICATE_CODEC',
        `Duplicate codec descriptor id: '${descriptor.codecId}' — registered twice during registry construction. ` +
          'Each codecId must be contributed by exactly one component (target / adapter / extension pack).',
        { meta: { codecId: descriptor.codecId } },
      );
    }
    const widened = descriptor as unknown as AnyDescriptor;
    byId.set(descriptor.codecId, widened);
  }

  return {
    descriptorFor(codecId: string): AnyDescriptor | undefined {
      return byId.get(codecId);
    },
    codecRefForColumn(namespaceId: string, table: string, column: string): CodecRef | undefined {
      if (!storage) return undefined;
      return codecRefForStorageColumn(storage, namespaceId, table, column);
    },
    *values(): IterableIterator<AnyDescriptor> {
      yield* byId.values();
    },
  };
}
