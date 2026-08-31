import { assembleAuthoringContributions } from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import { assembleAttributeSpecs, fieldAttribute, modelAttribute } from '../src/exports';

function modelSpecFactory(name: string) {
  return () => modelAttribute(name, {});
}

function fieldSpecFactory(name: string) {
  return () => fieldAttribute(name, {});
}

function descriptor(attribute: string, spec: unknown) {
  return {
    kind: 'modelAttribute' as const,
    attribute,
    spec,
    lower: () => undefined,
  };
}

describe('assembleAttributeSpecs', () => {
  it('assembles empty records when nothing is contributed', () => {
    const specs = assembleAttributeSpecs(assembleAuthoringContributions([{ id: 'target' }]));
    expect(specs).toEqual({ model: {}, field: {} });
  });

  it('preserves family built-in factories by identity', () => {
    const rls = modelSpecFactory('rls');
    const relation = fieldSpecFactory('relation');
    const specs = assembleAttributeSpecs(
      assembleAuthoringContributions([
        {
          id: 'family',
          authoring: { attributeSpecs: { model: { rls }, field: { relation } } },
        },
      ]),
    );
    expect(specs.model['rls']).toBe(rls);
    expect(specs.field['relation']).toBe(relation);
  });

  it('merges model-attribute descriptor spec factories into the model record', () => {
    const audit = modelSpecFactory('audit');
    const specs = assembleAttributeSpecs(
      assembleAuthoringContributions([
        {
          id: 'target',
          authoring: { modelAttributes: { auditMarker: descriptor('audit', audit) } },
        },
      ]),
    );
    expect(specs.model['audit']).toBe(audit);
  });

  it('keys descriptor entries by attribute name, not by registration path', () => {
    const specs = assembleAttributeSpecs(
      assembleAuthoringContributions([
        {
          id: 'target',
          authoring: {
            modelAttributes: {
              nested: { deeper: descriptor('audit', modelSpecFactory('audit')) },
            },
          },
        },
      ]),
    );
    expect(Object.keys(specs.model)).toEqual(['audit']);
  });

  it('merges family built-ins and descriptor entries into one model record', () => {
    const specs = assembleAttributeSpecs(
      assembleAuthoringContributions([
        {
          id: 'family',
          authoring: { attributeSpecs: { model: { rls: modelSpecFactory('rls') }, field: {} } },
        },
        {
          id: 'target',
          authoring: { modelAttributes: { audit: descriptor('audit', modelSpecFactory('audit')) } },
        },
      ]),
    );
    expect(Object.keys(specs.model).sort()).toEqual(['audit', 'rls']);
  });

  it('throws when a descriptor claims an attribute a family built-in already claims', () => {
    const contributions = assembleAuthoringContributions([
      {
        id: 'family',
        authoring: { attributeSpecs: { model: { audit: modelSpecFactory('audit') }, field: {} } },
      },
      {
        id: 'target',
        authoring: { modelAttributes: { audit: descriptor('audit', modelSpecFactory('audit')) } },
      },
    ]);
    expect(() => assembleAttributeSpecs(contributions)).toThrow(/"audit"/);
  });

  it('leaves model-attribute descriptors out of the field record', () => {
    const specs = assembleAttributeSpecs(
      assembleAuthoringContributions([
        {
          id: 'target',
          authoring: { modelAttributes: { audit: descriptor('audit', modelSpecFactory('audit')) } },
        },
      ]),
    );
    expect(specs.field).toEqual({});
  });

  it('freezes the assembled view and both records', () => {
    const specs = assembleAttributeSpecs(
      assembleAuthoringContributions([
        {
          id: 'family',
          authoring: { attributeSpecs: { model: { rls: modelSpecFactory('rls') }, field: {} } },
        },
      ]),
    );
    expect(Object.isFrozen(specs)).toBe(true);
    expect(Object.isFrozen(specs.model)).toBe(true);
    expect(Object.isFrozen(specs.field)).toBe(true);
    expect(() => {
      (specs.model as Record<string, unknown>)['stamp'] = modelSpecFactory('stamp');
    }).toThrow(TypeError);
  });
});
