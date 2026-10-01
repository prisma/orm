import { expectTypeOf, test } from 'vitest';
import type {
  AttributeSpecContext,
  AttributeSpecNamespace,
  FieldAttributeSpecContext,
  FieldAttributeSpecFactory,
  ModelAttributeSpecFactory,
} from '../src/exports';
import { fieldAttribute, modelAttribute, str } from '../src/exports';

const namespace = {
  model: {
    rls: () =>
      modelAttribute('rls', { documentation: 'Declares a model attribute for argument binding.' }),
    audit: (ctx: AttributeSpecContext) =>
      modelAttribute('audit', {
        documentation: 'Declares a model attribute for argument binding.',
        positional: [
          {
            key: ctx.model.name,
            type: str(),
            documentation: 'The value bound to this positional slot.',
          },
        ],
      }),
  },
  field: {
    relation: () =>
      fieldAttribute('relation', {
        documentation: 'Declares a field attribute for argument binding.',
      }),
    map: (ctx: FieldAttributeSpecContext) =>
      fieldAttribute('map', {
        documentation: 'Declares a field attribute for argument binding.',
        positional: [
          {
            key: ctx.field.name,
            type: str(),
            documentation: 'The value bound to this positional slot.',
          },
        ],
      }),
  },
} as const satisfies AttributeSpecNamespace;

test('a const namespace of nullary and ctx-taking factories satisfies the namespace shape', () => {
  expectTypeOf(namespace).toExtend<AttributeSpecNamespace>();
});

test('a const namespace keeps its literal keys, so registered access stays total', () => {
  expectTypeOf(namespace.model).toHaveProperty('rls');
  expectTypeOf(namespace.field).toHaveProperty('relation');
});

test('a field factory receives the field-level context', () => {
  expectTypeOf<
    Parameters<FieldAttributeSpecFactory>[0]
  >().toEqualTypeOf<FieldAttributeSpecContext>();
  expectTypeOf<FieldAttributeSpecContext>().toExtend<AttributeSpecContext>();
});

test('a field factory is not usable where a model factory is required', () => {
  expectTypeOf<FieldAttributeSpecFactory>().not.toExtend<ModelAttributeSpecFactory>();
});

test('a model factory is usable where a field factory is required', () => {
  expectTypeOf<ModelAttributeSpecFactory>().toExtend<FieldAttributeSpecFactory>();
});
