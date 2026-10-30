import { answerMissingPropertyReads } from '@internal/contract-authoring';
import { contractError } from './contract-errors';

const GUIDE = 'The upgrade guide "Field presets are removed" lists every rewrite.';

export const TEMPORAL_REWRITES: Readonly<Record<string, string>> = {
  createdAt: 'field.scalar(type.temporal.CreatedAt())',
  updatedAt: 'field.scalar(type.temporal.UpdatedAt())',
  timestamp:
    'field.scalar(type.Date()), with .onCreate(gen.now()) and .onUpdate(gen.now()) for the phases the preset set',
};

/** Each removed scalar field helper and the type constructor its field is now written with. */
export const REMOVED_SCALAR_HELPERS: Readonly<Record<string, string>> = {
  objectId: 'ObjectId',
  string: 'String',
  double: 'Double',
  int32: 'Int32',
  bool: 'Bool',
  date: 'Date',
  int64: 'Int64',
  int64Number: 'Int64Number',
  decimal128: 'Decimal128',
  binary: 'Binary',
  json: 'Json',
  bson: 'Bson',
  vector: 'Vector',
};

function refusePreset(preset: string): never {
  const helper = `field.temporal.${preset}`;
  throw contractError(
    'CONTRACT.FIELD_HELPER_UNKNOWN',
    `${helper} was a field preset, and Prisma 8 removed field presets. Write ${TEMPORAL_REWRITES[preset]}. ${GUIDE}`,
    { meta: { helper } },
  );
}

function refuseScalarHelper(name: string): never {
  const helper = `field.${name}`;
  const typeName = REMOVED_SCALAR_HELPERS[name];
  const length = name === 'vector' ? ', or field.scalar(type.Vector(n)) for a length n' : '';
  throw contractError(
    'CONTRACT.FIELD_HELPER_UNKNOWN',
    `${helper}() was removed. Write field.scalar(type.${typeName}())${length}.`,
    { meta: { helper } },
  );
}

/**
 * The MongoDB `field` helpers, where a read of a removed scalar helper such as `field.objectId`, or of a removed field preset under `field.temporal`, throws `CONTRACT.FIELD_HELPER_UNKNOWN` with its rewrite, so a JavaScript caller, or a contract emitted before it is type-checked, learns what to write instead. Every other read behaves as on `helpers`.
 */
export function refusingRemovedFieldHelpers<Helpers extends object>(helpers: Helpers): Helpers {
  const temporal = () =>
    answerMissingPropertyReads({}, new Set(Object.keys(TEMPORAL_REWRITES)), refusePreset);
  return answerMissingPropertyReads(
    helpers,
    new Set(['temporal', ...Object.keys(REMOVED_SCALAR_HELPERS)]),
    (name) => (name === 'temporal' ? temporal() : refuseScalarHelper(name)),
  );
}
