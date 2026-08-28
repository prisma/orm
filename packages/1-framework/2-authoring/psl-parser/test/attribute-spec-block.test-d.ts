import { expectTypeOf, test } from 'vitest';
import type {
  ArgType,
  AttributeSpec,
  BlockAttributeSpecFactory,
  BlockInterpretCtx,
  InferAttr,
  InterpretCtx,
} from '../src/exports';
import { blockAttribute, fieldRef, list, modelAttribute, optional, str } from '../src/exports';

test('blockAttribute infers its output like modelAttribute', () => {
  const blockSpec = blockAttribute('map', {
    positional: [{ key: 'name', type: str() }],
    named: { schema: optional(str()) },
  });
  const modelSpec = modelAttribute('map', {
    positional: [{ key: 'name', type: str() }],
    named: { schema: optional(str()) },
  });
  expectTypeOf<InferAttr<typeof blockSpec>>().toEqualTypeOf<InferAttr<typeof modelSpec>>();
  expectTypeOf<InferAttr<typeof blockSpec>>().toEqualTypeOf<{
    name: string;
    readonly schema?: string;
  }>();
});

test('a model-free combinator parses over the block ctx', () => {
  expectTypeOf(str()).toEqualTypeOf<ArgType<string, BlockInterpretCtx>>();
  expectTypeOf(list(str())).toEqualTypeOf<ArgType<string[], BlockInterpretCtx>>();
});

test('a combinator that reads the model is rejected inside a block spec', () => {
  blockAttribute('bad', {
    // @ts-expect-error fieldRef needs selfModel, which a block never has
    positional: [{ key: 'field', type: fieldRef('self') }],
  });
});

test('a block spec is accepted where a model-level spec is expected', () => {
  const blockSpec = blockAttribute('map', { positional: [{ key: 'name', type: str() }] });
  expectTypeOf(blockSpec).toMatchTypeOf<AttributeSpec<{ name: string }, InterpretCtx>>();
});

test('a model-level spec is rejected where a block spec is expected', () => {
  const modelSpec = modelAttribute('map', {
    positional: [{ key: 'field', type: fieldRef('self') }],
  });
  expectTypeOf(modelSpec).not.toMatchTypeOf<AttributeSpec<{ field: string }, BlockInterpretCtx>>();
});

test('a nullary factory over a block spec satisfies BlockAttributeSpecFactory', () => {
  const factory = () => blockAttribute('map', { positional: [{ key: 'name', type: str() }] });
  expectTypeOf(factory).toMatchTypeOf<BlockAttributeSpecFactory>();
  const modelFactory = () =>
    modelAttribute('map', { positional: [{ key: 'field', type: fieldRef('self') }] });
  expectTypeOf(modelFactory).not.toMatchTypeOf<BlockAttributeSpecFactory>();
});
