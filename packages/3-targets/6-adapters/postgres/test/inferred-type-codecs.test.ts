import { describe, expect, it } from 'vitest';
import { BINDING_BY_INFERRED_TYPE } from '../../../3-targets/postgres/src/core/psl-infer/infer-default-codec';
import {
  postgresNativeAuthoringTypes,
  postgresScalarAuthoringTypes,
} from '../src/core/control-mutation-defaults';

/**
 * `contract infer` writes a default in the form the codec `contract emit` binds to the type name it
 * writes reads back. It restates that binding for the type names it writes, because the authoring
 * namespaces that own it sit above the target package; this fails if the two disagree.
 */
const emitBindingByTypeName: ReadonlyMap<string, unknown> = new Map(
  [
    ...Object.entries(postgresScalarAuthoringTypes),
    ...Object.entries(postgresNativeAuthoringTypes),
  ].map(([typeName, typeConstructor]) => [
    typeName,
    {
      codecId: typeConstructor.output.codecId,
      ...('typeParams' in typeConstructor.output && typeConstructor.output.typeParams !== undefined
        ? { typeParams: typeConstructor.output.typeParams }
        : {}),
    },
  ]),
);

describe('the codec bound to each inferred PSL type name', () => {
  it('has a binding to compare against', () => {
    expect(emitBindingByTypeName.size).toBeGreaterThan(0);
    expect(BINDING_BY_INFERRED_TYPE.size).toBeGreaterThan(0);
  });

  it('agrees with the codec and type parameters of the type constructor contract emit resolves', () => {
    expect(
      [...BINDING_BY_INFERRED_TYPE].map(([typeName, binding]) => ({ typeName, binding })),
    ).toEqual(
      [...BINDING_BY_INFERRED_TYPE.keys()].map((typeName) => ({
        typeName,
        binding: emitBindingByTypeName.get(typeName),
      })),
    );
  });
});
