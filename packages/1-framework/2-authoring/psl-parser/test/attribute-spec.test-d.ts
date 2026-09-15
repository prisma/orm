import type { PslDiagnostic } from '@internal/framework-components/psl-ast';
import { ok, type Result } from '@internal/utils/result';
import { expectTypeOf, test } from 'vitest';
import type { ArgType, ArgTypeKind, AttributeCtx, InferAttr } from '../src/exports';
import { fieldAttribute, modelAttribute, optional } from '../src/exports';

function leaf<T>(kind: ArgTypeKind, value: T): ArgType<T, AttributeCtx> {
  return {
    kind,
    label: kind,
    parse: (): Result<T, readonly PslDiagnostic[]> => ok(value),
  };
}

const str = (): ArgType<string, AttributeCtx> => leaf('str', '');
const int = (): ArgType<number, AttributeCtx> => leaf('int', 0);

test('a required named param becomes a required property', () => {
  const spec = fieldAttribute('demo', {
    documentation: 'Declares a field attribute for argument binding.',
    named: { name: { type: str(), documentation: 'The value supplied by name.' } },
  });
  expectTypeOf<InferAttr<typeof spec>>().toEqualTypeOf<{ readonly name: string }>();
});

test('an optional named param becomes an optional property', () => {
  const spec = fieldAttribute('demo', {
    documentation: 'Declares a field attribute for argument binding.',
    named: { name: { type: optional(str()), documentation: 'The value supplied by name.' } },
  });
  expectTypeOf<InferAttr<typeof spec>>().toEqualTypeOf<{ readonly name?: string }>();
});

test('mixed required and optional named params keep their modifiers', () => {
  const spec = fieldAttribute('demo', {
    documentation: 'Declares a field attribute for argument binding.',
    named: {
      name: { type: str(), documentation: 'The relation name.' },
      count: { type: optional(int()), documentation: 'The number of entries.' },
    },
  });
  expectTypeOf<InferAttr<typeof spec>>().toEqualTypeOf<{
    readonly name: string;
    readonly count?: number;
  }>();
});

test('a positional slot contributes its key into the same keyspace', () => {
  const spec = fieldAttribute('demo', {
    documentation: 'Declares a field attribute for argument binding.',
    positional: [
      { key: 'name', type: str(), documentation: 'The value bound to this positional slot.' },
    ],
  });
  expectTypeOf<InferAttr<typeof spec>>().toEqualTypeOf<{ name: string }>();
});

test('an optional positional slot contributes an optional property', () => {
  const spec = fieldAttribute('demo', {
    documentation: 'Declares a field attribute for argument binding.',
    positional: [
      {
        key: 'name',
        type: optional(str()),
        documentation: 'The value bound to this positional slot.',
      },
    ],
  });
  expectTypeOf<InferAttr<typeof spec>>().toEqualTypeOf<{ name?: string }>();
});

test('a positional-or-named alias collapses to one property', () => {
  const spec = fieldAttribute('demo', {
    documentation: 'Declares a field attribute for argument binding.',
    positional: [
      {
        key: 'name',
        type: optional(str()),
        documentation: 'The value bound to this positional slot.',
      },
    ],
    named: {
      name: { type: optional(str()), documentation: 'The relation name.' },
      map: { type: optional(str()), documentation: 'The mapped constraint name.' },
    },
  });
  expectTypeOf<InferAttr<typeof spec>>().toEqualTypeOf<{
    name?: string;
    readonly map?: string;
  }>();
});

test('a spec carrying a refine still infers its output', () => {
  const spec = fieldAttribute('demo', {
    documentation: 'Declares a field attribute for argument binding.',
    named: { name: { type: optional(str()), documentation: 'The value supplied by name.' } },
    refine: (parsed) => {
      void parsed.name;
      return [];
    },
  });
  expectTypeOf<InferAttr<typeof spec>>().toEqualTypeOf<{ readonly name?: string }>();
});

test('modelAttribute infers the same shape fieldAttribute would for equivalent params', () => {
  const fieldSpec = fieldAttribute('demo', {
    documentation: 'Declares a field attribute for argument binding.',
    positional: [
      { key: 'name', type: str(), documentation: 'The value bound to this positional slot.' },
    ],
    named: { count: { type: optional(int()), documentation: 'The value supplied by name.' } },
  });
  const modelSpec = modelAttribute('demo', {
    documentation: 'Declares a model attribute for argument binding.',
    positional: [
      { key: 'name', type: str(), documentation: 'The value bound to this positional slot.' },
    ],
    named: { count: { type: optional(int()), documentation: 'The value supplied by name.' } },
  });
  expectTypeOf<InferAttr<typeof modelSpec>>().toEqualTypeOf<InferAttr<typeof fieldSpec>>();
  expectTypeOf<InferAttr<typeof modelSpec>>().toEqualTypeOf<{
    name: string;
    readonly count?: number;
  }>();
});

test('a model positional slot contributes its key into the keyspace', () => {
  const spec = modelAttribute('demo', {
    documentation: 'Declares a model attribute for argument binding.',
    positional: [
      { key: 'k', type: int(), documentation: 'The value bound to this positional slot.' },
    ],
  });
  expectTypeOf<InferAttr<typeof spec>>().toEqualTypeOf<{ k: number }>();
});
