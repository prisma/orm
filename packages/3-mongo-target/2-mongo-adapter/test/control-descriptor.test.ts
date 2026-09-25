import { mongoDescriptorById } from '@internal/target-mongo/codecs';
import { describe, expect, it } from 'vitest';
import mongoAdapterDescriptor, { mongoScalarAuthoringTypes } from '../src/exports/control';

// The legacy scalar-type map channel (name-to-codecId, retired in TML-2985) is gone; the pinned
// name → codecId pairs below carry the retired map's claims forward.
const expectedScalars = [
  ['String', 'mongo/string@1'],
  ['Int32', 'mongo/int32@1'],
  ['Bool', 'mongo/bool@1'],
  ['Date', 'mongo/date@1'],
  ['ObjectId', 'mongo/objectId@1'],
  ['Double', 'mongo/double@1'],
  ['Int64', 'mongo/int64@1'],
  ['Decimal128', 'mongo/decimal128@1'],
  ['Binary', 'mongo/binary@1'],
] as const;

const deprecatedAliases = [
  ['Int', 'Int32'],
  ['Float', 'Double'],
  ['Boolean', 'Bool'],
  ['DateTime', 'Date'],
] as const;

describe('mongoScalarAuthoringTypes', () => {
  it('pins every base scalar as a zero-arg type constructor with manifest-derived nativeType', () => {
    expect(Object.keys(mongoScalarAuthoringTypes).sort()).toEqual(
      [
        ...expectedScalars.map(([name]) => name),
        'Json',
        ...deprecatedAliases.map(([name]) => name),
      ].sort(),
    );
    for (const [name, codecId] of expectedScalars) {
      expect(mongoScalarAuthoringTypes[name]).toEqual({
        kind: 'typeConstructor',
        documentation: expect.stringMatching(/\S/),
        output: { codecId, nativeType: mongoDescriptorById(codecId)?.targetTypes?.[0] },
      });
    }
  });

  it.each(deprecatedAliases)(
    'keeps %s as a deprecated alias of %s with the same codec and native type',
    (alias, replacement) => {
      expect(mongoScalarAuthoringTypes[alias]).toEqual({
        ...mongoScalarAuthoringTypes[replacement],
        documentation: expect.stringContaining(`Deprecated: use ${replacement}.`),
        deprecated: { replacement },
      });
    },
  );

  it('pins Json, whose codec has no BSON type, to the json native type', () => {
    expect(mongoDescriptorById('mongo/json@1')?.targetTypes).toEqual([]);
    expect(mongoScalarAuthoringTypes.Json).toEqual({
      kind: 'typeConstructor',
      documentation: expect.stringMatching(/\S/),
      output: { codecId: 'mongo/json@1', nativeType: 'json' },
    });
  });

  it('is wired as the adapter descriptor authoring type contribution', () => {
    expect(mongoAdapterDescriptor.authoring?.type).toBe(mongoScalarAuthoringTypes);
  });

  it('points emitted contracts at the target codec types', () => {
    expect(mongoAdapterDescriptor.types?.codecTypes?.import).toEqual({
      package: '@internal/target-mongo/codec-types',
      named: 'CodecTypes',
      alias: 'MongoCodecTypes',
    });
  });
});
