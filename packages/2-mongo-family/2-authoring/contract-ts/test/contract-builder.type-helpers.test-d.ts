import { expectTypeOf, test } from 'vitest';
import { createContractAuthoringHelpers, defineContract } from '../src/contract-builder';
import { mongoFamilyPack, mongoTargetPack } from './mongo-test-packs';
import { choicePack } from './type-helper-packs';

const { field, type } = createContractAuthoringHelpers({
  family: mongoFamilyPack,
  target: mongoTargetPack,
  extensions: { choices: choicePack },
});

test('a constructor call is typed as its field type, with no type parameters it does not give', () => {
  expectTypeOf(type.ObjectId()).toEqualTypeOf<{
    readonly kind: 'scalar';
    readonly codecId: 'mongo/objectId@1';
  }>();
  expectTypeOf(type.Vector()).toEqualTypeOf<{
    readonly kind: 'scalar';
    readonly codecId: 'mongo/vector@1';
  }>();
  expectTypeOf(type.Vector(3)).toEqualTypeOf<{
    readonly kind: 'scalar';
    readonly codecId: 'mongo/vector@1';
    readonly typeParams: { readonly length: 3 };
  }>();
  expectTypeOf(field.scalar(type.Int32()).__type).toEqualTypeOf<{
    readonly kind: 'scalar';
    readonly codecId: 'mongo/int32@1';
  }>();
});

test('a constructor takes only the arguments it declares', () => {
  // @ts-expect-error Vector's length is a number
  type.Vector('3');
  // @ts-expect-error ObjectId takes no argument
  type.ObjectId(1);
});

test('a type choice is typed by the row its options choose', () => {
  expectTypeOf(type.choices.Value()).toEqualTypeOf<{
    readonly kind: 'scalar';
    readonly codecId: 'mongo/string@1';
  }>();
  expectTypeOf(type.choices.Value({ as: 'vector', length: 2 })).toEqualTypeOf<{
    readonly kind: 'scalar';
    readonly codecId: 'mongo/vector@1';
    readonly typeParams: { readonly length: 2 };
  }>();
});

test('a type choice combination with no row does not compile', () => {
  // @ts-expect-error the text row's constructor takes no length
  type.choices.Value({ as: 'text', length: 3 });
  // @ts-expect-error no row chooses "binary"
  type.choices.Value({ as: 'binary' });
});

test('a constructor PSL keeps only as a deprecated name is not a type helper', () => {
  expectTypeOf(type).not.toHaveProperty('Int');
  expectTypeOf(type).not.toHaveProperty('Float');
  expectTypeOf(type).not.toHaveProperty('Boolean');
  expectTypeOf(type).toHaveProperty('Int32');
});

test('field.scalar takes a type, not a codec id', () => {
  // @ts-expect-error field.scalar(codecId) was removed
  field.scalar('mongo/string@1');
});

test('the removed scalar helpers are gone from the type', () => {
  expectTypeOf(field).not.toHaveProperty('objectId');
  expectTypeOf(field).not.toHaveProperty('vector');
});

test('a contract written with the type helpers types its fields as the removed helpers did', () => {
  const contract = defineContract(
    { family: mongoFamilyPack, target: mongoTargetPack },
    ({ field: f, model, type: t }) => ({
      models: {
        Doc: model('Doc', {
          collection: 'docs',
          fields: {
            _id: f.scalar(t.ObjectId()),
            embedding: f.scalar(t.Vector(3)),
            title: f.scalar(t.String()).optional(),
          },
        }),
      },
    }),
  );
  type Fields = (typeof contract)['domain']['namespaces']['__unbound__']['models']['Doc']['fields'];
  expectTypeOf<Fields['embedding']['type']>().toEqualTypeOf<{
    readonly kind: 'scalar';
    readonly codecId: 'mongo/vector@1';
    readonly typeParams: { readonly length: 3 };
  }>();
  expectTypeOf<Fields['title']['type']>().toEqualTypeOf<{
    readonly kind: 'scalar';
    readonly codecId: 'mongo/string@1';
  }>();
  expectTypeOf<Fields['title']['nullable']>().toEqualTypeOf<true>();
});
