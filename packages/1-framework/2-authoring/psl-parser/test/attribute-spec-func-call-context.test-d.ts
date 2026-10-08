import { expectTypeOf, test } from 'vitest';
import type { AttributeCtx, FieldAttributeCtx, ModelAttributeCtx } from '../src/exports';
import { fieldRef, funcCall, referencedFieldRef, str } from '../src/exports';

test('function calls preserve the context required by their arguments', () => {
  const plain = funcCall('plain', {
    documentation: 'Accepts a string.',
    positional: [{ key: 'value', type: str(), documentation: 'The value.' }],
  });
  const model = funcCall('model', {
    documentation: 'Accepts a model field.',
    positional: [{ key: 'field', type: fieldRef(), documentation: 'The field.' }],
  });
  const field = funcCall('field', {
    documentation: 'Accepts a referenced field.',
    named: { ref: { type: referencedFieldRef(), documentation: 'The referenced field.' } },
  });
  expectTypeOf(plain.signature.positional[0].key).toEqualTypeOf<'value'>();
  expectTypeOf(model.signature.positional[0].key).toEqualTypeOf<'field'>();
  expectTypeOf(field.signature.named.ref.type.kind).toEqualTypeOf<'referencedFieldRef'>();
  expectTypeOf(plain.parse).parameter(1).toEqualTypeOf<AttributeCtx>();
  expectTypeOf(model.parse).parameter(1).toEqualTypeOf<ModelAttributeCtx>();
  expectTypeOf(field.parse).parameter(1).toEqualTypeOf<FieldAttributeCtx>();
});
