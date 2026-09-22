import { expectTypeOf, test } from 'vitest';
import type {
  ArgType,
  AttributeCtx,
  AttributeSpec,
  BlockAttributeSpecFactory,
  FieldAttributeCtx,
  InferAttr,
  ModelAttributeCtx,
  TypedFuncCall,
} from '../src/exports';
import {
  blockAttribute,
  fieldAttribute,
  fieldRef,
  funcCall,
  list,
  modelAttribute,
  oneOf,
  optional,
  referencedFieldRef,
  str,
} from '../src/exports';

test('blockAttribute infers its output like modelAttribute', () => {
  const blockSpec = blockAttribute('map', {
    documentation: 'Declares a block attribute for argument binding.',
    positional: [
      { key: 'name', type: str(), documentation: 'The value bound to this positional slot.' },
    ],
    named: { schema: { type: optional(str()), documentation: 'The value supplied by name.' } },
  });
  const modelSpec = modelAttribute('map', {
    documentation: 'Declares a model attribute for argument binding.',
    positional: [
      { key: 'name', type: str(), documentation: 'The value bound to this positional slot.' },
    ],
    named: { schema: { type: optional(str()), documentation: 'The value supplied by name.' } },
  });
  expectTypeOf<InferAttr<typeof blockSpec>>().toEqualTypeOf<InferAttr<typeof modelSpec>>();
  expectTypeOf<InferAttr<typeof blockSpec>>().toEqualTypeOf<{
    name: string;
    readonly schema?: string;
  }>();
});

test('documentation preserves defaults, optionality, literals, and refine inference', () => {
  const reusable = str('value');
  const spec = blockAttribute('demo', {
    documentation: 'Demonstrates documented arguments.',
    positional: [{ key: 'first', type: reusable, documentation: 'The first value.' }],
    named: {
      required: { type: reusable, documentation: 'The required value.' },
      omitted: { type: optional(reusable), documentation: 'An optional value.' },
      defaulted: { type: optional(reusable, 'value'), documentation: 'Defaults to `value`.' },
      undefinedDefault: {
        type: optional(reusable, undefined),
        documentation: 'Defaults to undefined.',
      },
    },
    refine: (parsed) => {
      expectTypeOf(parsed.required).toEqualTypeOf<'value'>();
      expectTypeOf(parsed.defaulted).toEqualTypeOf<'value' | undefined>();
      return [];
    },
  });
  expectTypeOf<InferAttr<typeof spec>>().toEqualTypeOf<{
    first: 'value';
    readonly required: 'value';
    readonly omitted?: 'value';
    readonly defaulted?: 'value';
    readonly undefinedDefault?: 'value';
  }>();
});

test('a model-free combinator parses over the bare attribute ctx', () => {
  expectTypeOf(str()).toMatchTypeOf<ArgType<string, AttributeCtx>>();
  expectTypeOf(list(str())).toMatchTypeOf<ArgType<string[], AttributeCtx>>();
  expectTypeOf(
    funcCall('now', { documentation: 'Calls the named value generator.' }),
  ).toMatchTypeOf<ArgType<TypedFuncCall, AttributeCtx>>();
});

test('a bare-ctx combinator is usable at all three levels', () => {
  blockAttribute('map', {
    documentation: 'Declares a block attribute for argument binding.',
    positional: [
      { key: 'name', type: str(), documentation: 'The value bound to this positional slot.' },
    ],
  });
  modelAttribute('map', {
    documentation: 'Declares a model attribute for argument binding.',
    positional: [
      { key: 'name', type: str(), documentation: 'The value bound to this positional slot.' },
    ],
  });
  fieldAttribute('map', {
    documentation: 'Declares a field attribute for argument binding.',
    positional: [
      { key: 'name', type: str(), documentation: 'The value bound to this positional slot.' },
    ],
  });
  blockAttribute('now', {
    documentation: 'Declares a block attribute for argument binding.',
    named: {
      at: {
        type: funcCall('now', { documentation: 'Calls the named value generator.' }),
        documentation: 'The value supplied by name.',
      },
    },
  });
});

test('fieldRef and referencedFieldRef expose distinct context metadata', () => {
  const localField = fieldRef();
  const referencedField = referencedFieldRef();

  expectTypeOf(localField).toMatchTypeOf<ArgType<string, ModelAttributeCtx>>();
  expectTypeOf(localField.kind).toEqualTypeOf<'fieldRef'>();
  expectTypeOf(referencedField).toMatchTypeOf<ArgType<string, FieldAttributeCtx>>();
  expectTypeOf(referencedField.kind).toEqualTypeOf<'referencedFieldRef'>();
});

test('a block spec is accepted where a bare-ctx spec is expected', () => {
  const blockSpec = blockAttribute('map', {
    documentation: 'Declares a block attribute for argument binding.',
    positional: [
      { key: 'name', type: str(), documentation: 'The value bound to this positional slot.' },
    ],
  });
  expectTypeOf(blockSpec).toMatchTypeOf<AttributeSpec<{ name: string }, AttributeCtx>>();
});

test('model and field factories preserve their level-specific contexts', () => {
  const modelSpec = modelAttribute('map', {
    documentation: 'Declares a model attribute for argument binding.',
    positional: [
      { key: 'field', type: fieldRef(), documentation: 'The value bound to this positional slot.' },
    ],
  });
  const fieldSpec = fieldAttribute('map', {
    documentation: 'Declares a field attribute for argument binding.',
    positional: [
      { key: 'name', type: str(), documentation: 'The value bound to this positional slot.' },
    ],
  });

  expectTypeOf(modelSpec).toMatchTypeOf<AttributeSpec<{ field: string }, ModelAttributeCtx>>();
  expectTypeOf(fieldSpec).toMatchTypeOf<AttributeSpec<{ name: string }, FieldAttributeCtx>>();
});

test('oneOf over bare-ctx alternatives stays usable in a block spec', () => {
  const spec = blockAttribute('kind', {
    documentation: 'Declares a block attribute for argument binding.',
    positional: [
      {
        key: 'kind',
        type: oneOf(str('a'), str('b')),
        documentation: 'The value bound to this positional slot.',
      },
    ],
  });
  expectTypeOf<InferAttr<typeof spec>>().toEqualTypeOf<{ kind: 'a' | 'b' }>();
});

test('oneOf takes its ctx from the annotation a mixed alternation is assigned to', () => {
  const arm: ArgType<string, ModelAttributeCtx> = oneOf(str(), fieldRef());
  expectTypeOf(arm).toMatchTypeOf<ArgType<string, ModelAttributeCtx>>();
  const modelSpec = modelAttribute('ok', {
    documentation: 'Declares a model attribute for argument binding.',
    positional: [
      { key: 'value', type: arm, documentation: 'The value bound to this positional slot.' },
    ],
  });
  expectTypeOf<InferAttr<typeof modelSpec>>().toEqualTypeOf<{ value: string }>();
});

test('a nullary factory over a block spec satisfies BlockAttributeSpecFactory', () => {
  const factory = () =>
    blockAttribute('map', {
      documentation: 'Declares a block attribute for argument binding.',
      positional: [
        { key: 'name', type: str(), documentation: 'The value bound to this positional slot.' },
      ],
    });
  expectTypeOf(factory).toMatchTypeOf<BlockAttributeSpecFactory>();
  const modelFactory = () =>
    modelAttribute('map', {
      documentation: 'Declares a model attribute for argument binding.',
      positional: [
        {
          key: 'field',
          type: fieldRef(),
          documentation: 'The value bound to this positional slot.',
        },
      ],
    });
  expectTypeOf(modelFactory).toMatchTypeOf<
    () => AttributeSpec<{ field: string }, ModelAttributeCtx>
  >();
});
