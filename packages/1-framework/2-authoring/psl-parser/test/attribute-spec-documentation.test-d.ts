import { expectTypeOf, test } from 'vitest';
import type {
  AttributeCtx,
  AttributeSpec,
  FuncCallSig,
  InferAttr,
  Param,
  PositionalParam,
} from '../src/exports';
import {
  blockAttribute,
  fieldAttribute,
  funcCall,
  modelAttribute,
  optional,
  str,
} from '../src/exports';

test('attribute constructors require documentation even without parameters', () => {
  // @ts-expect-error field attribute documentation is required
  fieldAttribute('marker', {});
  // @ts-expect-error model attribute documentation is required
  modelAttribute('marker', {});
  // @ts-expect-error block attribute documentation is required
  blockAttribute('marker', {});
});

test('direct attribute specs require documentation', () => {
  // @ts-expect-error direct specs require documentation too
  const spec: AttributeSpec<Record<never, never>, AttributeCtx> = {
    level: 'block',
    name: 'marker',
    positional: [],
    named: {},
  };
  void spec;
});

test('parameter declarations require documentation independently of their type', () => {
  // @ts-expect-error positional declaration documentation is required
  const positional: PositionalParam<string, AttributeCtx> = { key: 'name', type: str() };
  // @ts-expect-error named declaration documentation is required
  const named: Param<string, AttributeCtx> = { type: str() };
  // @ts-expect-error bare reusable types are not parameter declarations
  const bare: Param<string, AttributeCtx> = str();
  void [positional, named, bare];
});

test('every constructor rejects undocumented positional declarations', () => {
  const config = {
    documentation: 'Accepts a name.',
    positional: [{ key: 'name', type: str() }],
  };
  // @ts-expect-error field positional documentation is required
  fieldAttribute('demo', config);
  // @ts-expect-error model positional documentation is required
  modelAttribute('demo', config);
  // @ts-expect-error block positional documentation is required
  blockAttribute('demo', config);
  // @ts-expect-error nested positional documentation is required
  funcCall('demo', config);
});

test('every constructor rejects undocumented named declarations', () => {
  const config = {
    documentation: 'Accepts a name.',
    named: { name: { type: optional(str()) } },
  };
  // @ts-expect-error field named documentation is required
  fieldAttribute('demo', config);
  // @ts-expect-error model named documentation is required
  modelAttribute('demo', config);
  // @ts-expect-error block named documentation is required
  blockAttribute('demo', config);
  // @ts-expect-error nested named documentation is required
  funcCall('demo', config);
});

test('nested function signatures require documentation even without parameters', () => {
  // @ts-expect-error function signature documentation is required
  funcCall('now', {});
  // @ts-expect-error direct signatures require documentation too
  const signature: FuncCallSig = {};
  void signature;
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
