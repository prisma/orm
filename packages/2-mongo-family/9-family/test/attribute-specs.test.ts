import { assembleAuthoringContributions } from '@internal/framework-components/control';
import { mongoAttributeSpecs } from '@internal/mongo-contract-psl';
import { assembleAttributeSpecs } from '@internal/psl-parser';
import { describe, expect, it } from 'vitest';
import { mongoFamilyDescriptor } from '../src/core/control-descriptor';
import mongoFamilyPack from '../src/exports/pack';

describe.each([
  ['mongoFamilyDescriptor', mongoFamilyDescriptor],
  ['mongoFamilyPack', mongoFamilyPack],
])('%s', (_, component) => {
  it('assembles every Mongo built-in spec factory by identity', () => {
    const specs = assembleAttributeSpecs(assembleAuthoringContributions([component]));
    expect(specs).toEqual({ model: mongoAttributeSpecs.model, field: mongoAttributeSpecs.field });
    expect(specs.model['index']).toBe(mongoAttributeSpecs.model.index);
    expect(specs.field['relation']).toBe(mongoAttributeSpecs.field.relation);
  });
});
