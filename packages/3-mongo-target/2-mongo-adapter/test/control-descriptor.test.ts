import { describe, expect, it } from 'vitest';
import { mongoDescriptorById } from '../src/core/codecs';
import mongoAdapterDescriptor, { mongoScalarAuthoringTypes } from '../src/exports/control';

// The legacy scalar-type map channel (name-to-codecId, retired in TML-2985) is gone; the pinned
// name → codecId pairs below carry the retired map's claims forward.
const expectedScalars = [
  ['String', 'mongo/string@1'],
  ['Int', 'mongo/int32@1'],
  ['Boolean', 'mongo/bool@1'],
  ['DateTime', 'mongo/date@1'],
  ['ObjectId', 'mongo/objectId@1'],
  ['Float', 'mongo/double@1'],
] as const;

describe('mongoScalarAuthoringTypes', () => {
  it('pins every base scalar as a zero-arg type constructor with manifest-derived nativeType', () => {
    expect(Object.keys(mongoScalarAuthoringTypes).sort()).toEqual(
      expectedScalars.map(([name]) => name).sort(),
    );
    for (const [name, codecId] of expectedScalars) {
      expect(mongoScalarAuthoringTypes[name]).toEqual({
        kind: 'typeConstructor',
        documentation: expect.stringMatching(/\S/),
        output: { codecId, nativeType: mongoDescriptorById(codecId)?.targetTypes?.[0] },
      });
    }
  });

  it('is wired as the adapter descriptor authoring type contribution', () => {
    expect(mongoAdapterDescriptor.authoring?.type).toBe(mongoScalarAuthoringTypes);
  });
});
