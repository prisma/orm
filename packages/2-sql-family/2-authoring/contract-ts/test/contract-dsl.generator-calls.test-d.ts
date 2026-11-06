import { expectTypeOf, test } from 'vitest';
import { testTypeLookups } from '../../../1-core/contract/test/test-type-lookups';
import { createComposedAuthoringHelpers, field } from '../src/exports/contract-builder';
import { columnDescriptor } from './helpers/column-descriptor';
import { familyPack, slugidPack, targetPack } from './helpers/generator-function-packs';

const { gen } = createComposedAuthoringHelpers({
  ...testTypeLookups,
  family: familyPack,
  target: targetPack,
  extensions: { slugid: slugidPack },
});

const textColumn = columnDescriptor('pg/text@1');

/** Whether the contract types say the client generates the field's value on create, which makes the create input optional. */
type GeneratesOnCreate<Builder> = Builder extends { readonly __state: infer State }
  ? State extends { readonly __defaultPresence?: infer Presence }
    ? NonNullable<Presence> extends { readonly onCreate: true }
      ? true
      : false
    : false
  : false;

test('.onCreate makes the client generate the value on create, so the create input may omit it', () => {
  const onCreate = field.column(textColumn).onCreate(gen.uuid());
  expectTypeOf<GeneratesOnCreate<typeof onCreate>>().toEqualTypeOf<true>();
});

test('.onUpdate alone leaves the value required on create', () => {
  const onUpdate = field.column(textColumn).onUpdate(gen.now());
  expectTypeOf<GeneratesOnCreate<typeof onUpdate>>().toEqualTypeOf<false>();
});

test('.onCreate after .onUpdate still generates on create', () => {
  const both = field.column(textColumn).onUpdate(gen.now()).onCreate(gen.now());
  expectTypeOf<GeneratesOnCreate<typeof both>>().toEqualTypeOf<true>();
});

test('gen holds the functions the packs declare, typed by their signatures', () => {
  expectTypeOf<keyof typeof gen>().toEqualTypeOf<'uuid' | 'now' | 'slugid'>();
  expectTypeOf(gen.uuid).parameters.toEqualTypeOf<[version?: 4 | 7]>();
  expectTypeOf(gen.now).parameters.toEqualTypeOf<[]>();
  // @ts-expect-error uuid takes version 4 or 7
  gen.uuid(5);
});

test('gen of a stack without the extension has no slugid', () => {
  const { gen: withoutExtension } = createComposedAuthoringHelpers({
    ...testTypeLookups,
    family: familyPack,
    target: targetPack,
  });
  expectTypeOf<keyof typeof withoutExtension>().toEqualTypeOf<'uuid' | 'now'>();
});
