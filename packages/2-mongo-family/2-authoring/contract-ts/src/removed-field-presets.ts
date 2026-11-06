import { answerMissingPropertyReads } from '@internal/contract-authoring';
import { contractError } from './contract-errors';

const GUIDE = 'The upgrade guide "Field presets are removed" lists every rewrite.';

export const TEMPORAL_REWRITES: Readonly<Record<string, string>> = {
  createdAt: 'field.date().onCreate(gen.now())',
  updatedAt: 'field.date().onCreate(gen.now()).onUpdate(gen.now())',
  timestamp:
    'field.date(), with .onCreate(gen.now()) and .onUpdate(gen.now()) for the phases the preset set',
};

function refuse(preset: string): never {
  const helper = `field.temporal.${preset}`;
  throw contractError(
    'CONTRACT.FIELD_HELPER_UNKNOWN',
    `${helper} was a field preset, and Prisma 8 removed field presets. Write ${TEMPORAL_REWRITES[preset]}. ${GUIDE}`,
    { meta: { helper } },
  );
}

/**
 * The MongoDB `field` helpers, where `field.temporal`, which held the removed field presets, gives an object whose read of a preset throws `CONTRACT.FIELD_HELPER_UNKNOWN` with its rewrite, so a JavaScript caller, or a contract emitted before it is type-checked, learns what to write instead. Every other read behaves as on `helpers`.
 */
export function refusingRemovedFieldPresets<Helpers extends object>(helpers: Helpers): Helpers {
  return answerMissingPropertyReads(helpers, new Set(['temporal']), () =>
    answerMissingPropertyReads({}, new Set(Object.keys(TEMPORAL_REWRITES)), refuse),
  );
}
