import type { AttributeSpecContext, FieldAttributeSpecContext } from '@internal/psl-parser';
import { buildSymbolTable } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import { describe, expect, it } from 'vitest';
import { mongoAttributeSpecs } from '../src/mongo-attribute-specs';

function contexts(): { model: AttributeSpecContext; field: FieldAttributeSpecContext } {
  const { document, sourceFile } = parse(`
    model Widget {
      id   ObjectId @id @map("_id")
      name String
    }
  `);
  const { table } = buildSymbolTable({ document, sourceFile, pslBlockDescriptors: {} });
  const model = table.topLevel.models['Widget'];
  const field = model?.fields['name'];
  if (!model || !field) throw new Error('fixture declares Widget.name');
  const modelContext: AttributeSpecContext = {
    symbols: table,
    model,
    controlMutationDefaults: new Map(),
  };
  return { model: modelContext, field: { ...modelContext, field } };
}

describe('mongoAttributeSpecs', () => {
  it('registers every Mongo built-in at its level', () => {
    expect({
      model: Object.keys(mongoAttributeSpecs.model).sort(),
      field: Object.keys(mongoAttributeSpecs.field).sort(),
    }).toEqual({
      model: ['base', 'discriminator', 'index', 'map', 'textIndex', 'unique'],
      field: ['id', 'map', 'relation', 'unique'],
    });
  });

  it('yields a model-level spec named by its key from every model factory', () => {
    const { model } = contexts();
    const produced = Object.entries(mongoAttributeSpecs.model).map(([name, factory]) => {
      const spec = factory(model);
      return { key: name, name: spec.name, level: spec.level };
    });
    expect(produced).toEqual(
      Object.keys(mongoAttributeSpecs.model).map((name) => ({ key: name, name, level: 'model' })),
    );
  });

  it('yields a field-level spec named by its key from every field factory', () => {
    const { field } = contexts();
    const produced = Object.entries(mongoAttributeSpecs.field).map(([name, factory]) => {
      const spec = factory(field);
      return { key: name, name: spec.name, level: spec.level };
    });
    expect(produced).toEqual(
      Object.keys(mongoAttributeSpecs.field).map((name) => ({ key: name, name, level: 'field' })),
    );
  });

  it('returns the same static spec object on every call', () => {
    const { model, field } = contexts();
    expect(mongoAttributeSpecs.model.map(model)).toBe(mongoAttributeSpecs.model.map(model));
    expect(mongoAttributeSpecs.field.relation(field)).toBe(
      mongoAttributeSpecs.field.relation(field),
    );
  });
});
