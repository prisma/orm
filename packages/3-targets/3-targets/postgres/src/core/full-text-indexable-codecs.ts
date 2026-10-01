import { codecDescriptors } from './codecs';

/** Widens a descriptor's trait tuple, so membership is a plain string test. */
function traitsOf(descriptor: { readonly traits: readonly string[] }): readonly string[] {
  return descriptor.traits;
}

const TEXTUAL_CODEC_IDS: ReadonlySet<string> = new Set(
  codecDescriptors
    .filter((descriptor) => traitsOf(descriptor).includes('textual'))
    .map((descriptor) => descriptor.codecId),
);

/**
 * Whether a column stored through this codec can be indexed for full-text search.
 * Read from the codec descriptors themselves, so both authoring surfaces accept
 * exactly the columns the `textual` operations dispatch on.
 */
export function isFullTextIndexableCodec(codecId: string): boolean {
  return TEXTUAL_CODEC_IDS.has(codecId);
}
