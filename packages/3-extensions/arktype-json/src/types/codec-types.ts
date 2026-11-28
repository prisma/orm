/**
 * Codec type definitions for the arktype-json extension.
 *
 * Type-only export consumed by emitted `contract.d.ts` to power
 * `CodecTypes['arktype/json@1']['output']` lookups. The shape mirrors the
 * codec the curried factory returns at runtime so the emit and no-emit
 * paths stay structurally aligned.
 *
 * The output type is intentionally `unknown` — the precise inference is
 * column-site-local (the no-emit `FieldOutputType` resolver reads the
 * factory's return type from the column descriptor's `type` slot, which
 * carries `(ctx) => Codec<…, S['infer']>`). The emit path renders the
 * descriptor's `expression` as the column's TS type (per the descriptor's
 * `renderOutputType`); the codec-id-keyed `CodecTypes` map is the
 * fallback for sites without a column descriptor in scope.
 */

import type { JsonValue } from '@internal/contract/types';

export type CodecTypes = {
  readonly 'arktype/json@1': {
    readonly input: unknown;
    readonly output: unknown;
    readonly json: JsonValue;
    readonly traits: 'equality';
  };
};
