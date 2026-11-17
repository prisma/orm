import { type BuiltinGeneratorId, builtinGeneratorIds } from './generator-ids';

export { CUID_VERSION, NANOID_SIZE, UUID_VERSIONS } from './generator-limits';
export type { BuiltinGeneratorId };
export { builtinGeneratorIds };

const NANOID_DEFAULT_SIZE = 21;

type GeneratorParams = Readonly<Record<string, unknown>> | undefined;

function nanoidLength(params: GeneratorParams): number {
  const size = params?.['size'];
  return typeof size === 'number' ? size : NANOID_DEFAULT_SIZE;
}

const generatedLengthById: Record<BuiltinGeneratorId, (params: GeneratorParams) => number> = {
  ulid: () => 26,
  nanoid: nanoidLength,
  uuidv7: () => 36,
  uuidv4: () => 36,
  cuid2: () => 24,
  ksuid: () => 27,
};

/** The number of characters the built-in generator `id` writes under `params`, such as 36 for a UUID or a Nano ID's size. */
export function generatedLength(id: BuiltinGeneratorId, params: GeneratorParams): number {
  return generatedLengthById[id](params);
}
