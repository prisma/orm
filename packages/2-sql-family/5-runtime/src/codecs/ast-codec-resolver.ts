import type { CodecRef } from '@internal/framework-components/codec';
import {
  materializeCodec,
  resolveCodecDescriptorOrThrow,
} from '@internal/framework-components/codec';
import { canonicalizeJson } from '@internal/framework-components/utils';
import type { Codec, SqlCodecInstanceContext } from '@internal/sql-relational-core/ast';
import type { CodecDescriptorRegistry } from '@internal/sql-relational-core/query-lane-context';

/**
 * Per-`ExecutionContext` resolver that materialises the {@link Codec} for a {@link CodecRef} carried on an AST node.
 *
 * Wraps `descriptorFor(codecId).factory(typeParams)(ctx)` with a content-keyed cache: lookups are keyed by `${codecId}:${canonicalizeJson(typeParams)}`, so two refs with the same `codecId` and structurally equal `typeParams` (regardless of object key order) resolve to the same memoised codec instance. Non-parameterized codecs key as `${codecId}:undefined` and share one instance per resolver.
 *
 * AST-bound codec resolution dissolves the legacy column-aware dispatch path: every codec-bearing AST node carries the canonical `CodecRef` directly, so the resolver is the single dispatch shape encode and decode share. Refs the contract walk pre-populates hit on first call; refs the AST supplies (e.g. deserialised migration ops) populate the cache lazily.
 */
export interface AstCodecResolver {
  /**
   * Resolve the {@link Codec} for the supplied {@link CodecRef}.
   *
   * Throws `RUNTIME.CODEC_DESCRIPTOR_MISSING` when no descriptor is registered for `ref.codecId`. Throws `RUNTIME.TYPE_PARAMS_INVALID` when the descriptor's `paramsSchema` rejects `ref.typeParams` (validated only on cache miss; subsequent lookups for the same canonical key skip validation).
   */
  forCodecRef(ref: CodecRef): Codec;
}

/**
 * Build an {@link AstCodecResolver} bound to a descriptor registry and a per-call instance-context factory.
 *
 * The instance-context factory lets callers control `name` / `usedAt` for refs the AST supplies (e.g. AST-embedded migration ops where the materialisation site is the AST node, not a contract column). The contract-walk pre-population path constructs its own contexts and invokes the resolver with those refs to seed the cache.
 */
export function createAstCodecResolver(
  descriptors: CodecDescriptorRegistry,
  instanceContextFor: (ref: CodecRef) => SqlCodecInstanceContext,
): AstCodecResolver {
  const cache = new Map<string, Codec>();

  return {
    forCodecRef(ref: CodecRef): Codec {
      const key = `${ref.codecId}:${canonicalizeJson(ref.typeParams)}`;
      const cached = cache.get(key);
      if (cached) return cached;

      const descriptor = resolveCodecDescriptorOrThrow(
        (id) => descriptors.descriptorFor(id),
        ref,
        'RUNTIME.CODEC_DESCRIPTOR_MISSING',
      );
      const ctx = instanceContextFor(ref);
      const codec = materializeCodec(descriptor, ref, ctx);

      cache.set(key, codec);
      return codec;
    },
  };
}
