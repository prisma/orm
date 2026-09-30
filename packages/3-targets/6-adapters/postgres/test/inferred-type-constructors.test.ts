import { describe, expect, it } from 'vitest';
import { INFERRED_PSL_TYPE_NAMES } from '../../../3-targets/postgres/src/core/psl-build/postgres-type-map';
import { adapterTypeConstructors } from '../../../3-targets/postgres/test/psl-infer/adapter-type-constructors';
import { postgresAuthoringTypes } from '../src/core/control-mutation-defaults';

/**
 * `contract infer` writes each column's type as one of this adapter's type constructors, and reads its
 * default back through the codec that constructor gives. The target's infer tests restate those
 * constructors because this adapter sits above the target; this fails if the two disagree.
 */
describe('the type constructors contract infer writes', () => {
  it('are this adapter type constructors, one for every type name the type map writes', () => {
    const adapterTypes: Readonly<Record<string, unknown>> = postgresAuthoringTypes;
    const restated: Readonly<Record<string, unknown>> = adapterTypeConstructors;
    const withoutDocumentation = (name: string) => {
      const typeConstructor = adapterTypes[name];
      if (typeof typeConstructor !== 'object' || typeConstructor === null) return typeConstructor;
      const { documentation: _documentation, ...rest } = typeConstructor as Record<string, unknown>;
      return rest;
    };
    expect(
      [...INFERRED_PSL_TYPE_NAMES].map((name) => ({ name, typeConstructor: restated[name] })),
    ).toEqual(
      [...INFERRED_PSL_TYPE_NAMES].map((name) => ({
        name,
        typeConstructor: withoutDocumentation(name),
      })),
    );
  });
});
