import type { ContractCodecRegistry } from '@internal/sql-relational-core/ast';
import type { CodecDescriptorRegistry } from '@internal/sql-relational-core/query-lane-context';
import { createAstCodecResolver } from './ast-codec-resolver';

/**
 * Build a contract-free {@link ContractCodecRegistry} that resolves codecs
 * purely from AST-supplied {@link import('@internal/framework-components/codec').CodecRef}s
 * against a target's descriptor registry.
 *
 * Dispatch is driven entirely by `CodecRef`s embedded in AST nodes; no
 * contract walk is needed. `forColumn` always returns `undefined` — this
 * registry carries no column-to-codec mappings.
 */
export function createAstCodecRegistry(
  descriptors: CodecDescriptorRegistry,
): ContractCodecRegistry {
  const resolver = createAstCodecResolver(descriptors, (ref) => ({
    name: ref.codecId,
    usedAt: [],
  }));
  return {
    forColumn: () => undefined,
    forCodecRef: (ref) => resolver.forCodecRef(ref),
  };
}
