import { type CodecLookup, renderTsLiteral } from '@internal/framework-components/codec';

/**
 * Mirrors the real Postgres primitive codecs' `renderValueLiteral`: `pg/text@1` and `pg/int4@1` are
 * identity codecs whose encoded form equals their decoded output, so the encoded value renders
 * directly as a literal. Tests pass this so the value-set column emit produces literal unions —
 * the same result the production control-stack lookup produces.
 */
export const identityCodecLookup: CodecLookup = {
  get: () => undefined,
  renderOutputTypeFor: () => undefined,
  renderValueLiteralFor: (id, value) =>
    id === 'pg/text@1' || id === 'pg/int4@1' ? renderTsLiteral(value) : undefined,
};

/** Codec id of the non-identity test codec. */
export const NON_IDENTITY_CODEC_ID = 'test/level@1';

/**
 * A non-identity test codec: it encodes to integers `0 | 1 | 2` (the value-set's stored form) but
 * its decoded output type is the string literals `"low" | "high" | "urgent"`. `renderValueLiteral`
 * decodes the encoded int, then renders the decoded string literal — proving the emit type is the
 * codec's **output**, not the raw encoded literal. The codec output type itself (`Level`) is the
 * fallback used when `renderValueLiteral` returns `undefined`.
 */
const LEVEL_BY_INDEX = ['low', 'high', 'urgent'] as const;

export const nonIdentityCodecLookup: CodecLookup = {
  get: () => undefined,
  renderOutputTypeFor: (id) => (id === NON_IDENTITY_CODEC_ID ? 'Level' : undefined),
  renderValueLiteralFor: (id, value) => {
    if (id !== NON_IDENTITY_CODEC_ID) return undefined;
    if (typeof value !== 'number') return undefined;
    const decoded = LEVEL_BY_INDEX[value];
    return decoded === undefined ? undefined : renderTsLiteral(decoded);
  },
};
