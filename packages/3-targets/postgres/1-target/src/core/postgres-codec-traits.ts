import { codecDescriptors } from './codecs';

const TRAITS_BY_CODEC_ID: ReadonlyMap<string, readonly string[]> = new Map(
  codecDescriptors.map((descriptor): [string, readonly string[]] => [
    descriptor.codecId,
    descriptor.traits,
  ]),
);

/** The traits of a Postgres codec, or `undefined` for a codec the target does not register. */
export function postgresCodecTraitsOf(codecId: string): readonly string[] | undefined {
  return TRAITS_BY_CODEC_ID.get(codecId);
}
