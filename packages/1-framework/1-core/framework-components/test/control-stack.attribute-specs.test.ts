import { describe, expect, it } from 'vitest';
import { assembleAuthoringContributions } from '../src/control/control-stack';
import type { ComponentDescriptor } from '../src/shared/framework-components';

function createDescriptor(
  overrides: Partial<ComponentDescriptor<string>> = {},
): ComponentDescriptor<string> {
  return {
    kind: 'target',
    id: 'test',
    version: '0.0.1',
    ...overrides,
  } as ComponentDescriptor<string>;
}

function makeSpecFactory(attribute: string) {
  return () => ({ attribute });
}

describe('assembleAuthoringContributions attributeSpecs', () => {
  it('returns empty model and field records for descriptors without authoring', () => {
    const result = assembleAuthoringContributions([createDescriptor()]);
    expect(result.attributeSpecs).toEqual({ model: {}, field: {} });
  });

  it('merges attributeSpecs levels from multiple descriptors', () => {
    const result = assembleAuthoringContributions([
      createDescriptor({
        authoring: {
          attributeSpecs: { model: { rls: makeSpecFactory('rls') }, field: {} },
        },
      }),
      createDescriptor({
        id: 'other',
        authoring: {
          attributeSpecs: {
            model: { stamp: makeSpecFactory('stamp') },
            field: { relation: makeSpecFactory('relation') },
          },
        },
      }),
    ]);
    expect(Object.keys(result.attributeSpecs.model)).toEqual(['rls', 'stamp']);
    expect(Object.keys(result.attributeSpecs.field)).toEqual(['relation']);
  });

  it('keeps the contributed factory reachable under its attribute name', () => {
    const factory = makeSpecFactory('rls');
    const result = assembleAuthoringContributions([
      createDescriptor({
        authoring: { attributeSpecs: { model: { rls: factory }, field: {} } },
      }),
    ]);
    expect(result.attributeSpecs.model['rls']).toBe(factory);
  });

  it('claims the same name independently at the model and field levels', () => {
    const result = assembleAuthoringContributions([
      createDescriptor({
        authoring: {
          attributeSpecs: {
            model: { map: makeSpecFactory('map') },
            field: { map: makeSpecFactory('map') },
          },
        },
      }),
    ]);
    expect(Object.keys(result.attributeSpecs.model)).toEqual(['map']);
    expect(Object.keys(result.attributeSpecs.field)).toEqual(['map']);
  });

  it('rejects the same model attribute name claimed by two descriptors', () => {
    expect(() =>
      assembleAuthoringContributions([
        createDescriptor({
          authoring: { attributeSpecs: { model: { rls: makeSpecFactory('rls') }, field: {} } },
        }),
        createDescriptor({
          id: 'other',
          authoring: { attributeSpecs: { model: { rls: makeSpecFactory('rls') }, field: {} } },
        }),
      ]),
    ).toThrow(/Duplicate authoring attributeSpecs entry "model\.rls"/);
  });

  it('rejects the same field attribute name claimed by two descriptors', () => {
    expect(() =>
      assembleAuthoringContributions([
        createDescriptor({
          authoring: {
            attributeSpecs: { model: {}, field: { relation: makeSpecFactory('relation') } },
          },
        }),
        createDescriptor({
          id: 'other',
          authoring: {
            attributeSpecs: { model: {}, field: { relation: makeSpecFactory('relation') } },
          },
        }),
      ]),
    ).toThrow(/Duplicate authoring attributeSpecs entry "field\.relation"/);
  });

  it('rejects a level that is not a record', () => {
    expect(() =>
      assembleAuthoringContributions([
        createDescriptor({
          authoring: { attributeSpecs: { model: 42, field: {} } as unknown as never },
        }),
      ]),
    ).toThrow(/Invalid authoring attributeSpecs contribution from descriptor "test"/);
  });

  it('rejects an attributeSpecs contribution that is not a record', () => {
    expect(() =>
      assembleAuthoringContributions([
        createDescriptor({ authoring: { attributeSpecs: 'nope' as unknown as never } }),
      ]),
    ).toThrow(/Invalid authoring attributeSpecs contribution from descriptor "test"/);
  });

  it('rejects an entry that is not a factory function', () => {
    expect(() =>
      assembleAuthoringContributions([
        createDescriptor({
          authoring: { attributeSpecs: { model: { rls: { kind: 'spec' } }, field: {} } },
        }),
      ]),
    ).toThrow(/Invalid authoring attributeSpecs entry "model\.rls"/);
  });

  it('rejects an attribute name that would pollute the prototype', () => {
    expect(() =>
      assembleAuthoringContributions([
        createDescriptor({
          authoring: {
            attributeSpecs: {
              model: Object.fromEntries([['__proto__', makeSpecFactory('x')]]),
              field: {},
            },
          },
        }),
      ]),
    ).toThrow(/Invalid authoring attributeSpecs entry "model\.__proto__"/);
  });
});
