import { InternalError } from '@internal/utils/internal-error';

/**
 * A place in a stored document, as the keys from its root. `*` stands for any one key or index,
 * and a trailing `**` for the place and everything below it.
 */
export type DocumentPlace = readonly string[];

export interface UnknownKeyProbe {
  /** How many objects the probe added a key to, one at a time. */
  readonly objects: number;
  /** The places, outside the open ones, whose object was read with the added key. */
  readonly accepted: readonly string[];
}

const probeKey = '__keyNoFormatDefines';

type Path = readonly (string | number)[];

function objectPaths(value: unknown, path: Path): Path[] {
  if (Array.isArray(value))
    return value.flatMap((entry, index) => objectPaths(entry, [...path, index]));
  if (value === null || typeof value !== 'object') return [];
  return [
    path,
    ...Object.entries(value).flatMap(([key, entry]) => objectPaths(entry, [...path, key])),
  ];
}

function matches(place: DocumentPlace, path: Path): boolean {
  const [first, ...rest] = place;
  if (first === undefined) return path.length === 0;
  if (first === '**') return true;
  const [step, ...remaining] = path;
  if (step === undefined || (first !== '*' && first !== String(step))) return false;
  return matches(rest, remaining);
}

function placeText(path: Path): string {
  return path
    .map((step, index) =>
      typeof step === 'number' ? `[${step}]` : index === 0 ? step : `.${step}`,
    )
    .join('');
}

function withKeyAt(document: unknown, path: Path): unknown {
  const copy: unknown = structuredClone(document);
  const target: unknown = path.reduce<unknown>((at, step) => Reflect.get(Object(at), step), copy);
  Reflect.set(Object(target), probeKey, true);
  return copy;
}

function refusalOf(read: () => unknown): string | undefined {
  try {
    read();
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * Adds a key no format defines to each object of a stored document in turn, reads each copy, and
 * reports the objects outside `openPlaces` whose copy was read. A reader that refuses an unknown key
 * everywhere its format does not leave open reports none. Use it in a target's tests, over the
 * files that target writes, with the places its format leaves open.
 */
export function probeUnknownKeys(
  document: unknown,
  read: (document: unknown) => unknown,
  openPlaces: readonly DocumentPlace[],
): UnknownKeyProbe {
  const refused = refusalOf(() => read(structuredClone(document)));
  if (refused !== undefined) {
    throw new InternalError(`The document is refused before any key is added: ${refused}`);
  }
  const paths = objectPaths(document, []);
  if (paths.length === 0) throw new InternalError('The document has no object to add a key to');
  const accepted = paths
    .filter((path) => !openPlaces.some((place) => matches(place, path)))
    .filter((path) => refusalOf(() => read(withKeyAt(document, path))) === undefined)
    .map(placeText);
  return { objects: paths.length, accepted };
}
