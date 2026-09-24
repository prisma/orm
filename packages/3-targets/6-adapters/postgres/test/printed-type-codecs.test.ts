import { describe, expect, it } from 'vitest';
import { CODEC_ID_BY_PRINTED_TYPE } from '../../../3-targets/postgres/src/core/psl-infer/infer-default-codec';
import {
  postgresNativeAuthoringTypes,
  postgresScalarAuthoringTypes,
} from '../src/core/control-mutation-defaults';

/**
 * `contract infer` writes a default in the form the codec `contract emit` binds to the printed type
 * name reads back. The printer restates that binding for the type names it prints, because the
 * authoring namespaces that own it sit above the target package; this fails if the two disagree.
 */
const emitCodecIdByTypeName: ReadonlyMap<string, string> = new Map(
  [
    ...Object.entries(postgresScalarAuthoringTypes),
    ...Object.entries(postgresNativeAuthoringTypes),
  ].map(([typeName, typeConstructor]) => [typeName, typeConstructor.output.codecId]),
);

describe('the codec bound to each printed PSL type name', () => {
  it('has a binding to compare against', () => {
    expect(emitCodecIdByTypeName.size).toBeGreaterThan(0);
    expect(CODEC_ID_BY_PRINTED_TYPE.size).toBeGreaterThan(0);
  });

  it('agrees with the type constructor contract emit resolves', () => {
    expect(
      [...CODEC_ID_BY_PRINTED_TYPE].map(([typeName, codecId]) => ({ typeName, codecId })),
    ).toEqual(
      [...CODEC_ID_BY_PRINTED_TYPE.keys()].map((typeName) => ({
        typeName,
        codecId: emitCodecIdByTypeName.get(typeName),
      })),
    );
  });
});
