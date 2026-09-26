import type {
  ArgTypeFromDescriptor,
  ObjectArgumentType,
  TupleFromArgumentDescriptors,
} from '@internal/contract-authoring';
import type { AuthoringArgumentDescriptor } from '@internal/framework-components/authoring';
import { expectTypeOf, test } from 'vitest';
import type {
  FieldHelperFunctionWithNamedConstraint,
  FieldHelperFunctionWithoutNamedConstraint,
  NamedConstraintSpec,
} from '../src/authoring-type-utils';
import { nanoidOptionsArgumentMirror } from './nanoid-preset-mirror';

const nanoidDescriptor = {
  kind: 'fieldPreset',
  args: [nanoidOptionsArgumentMirror],
  output: {
    codecId: 'sql/char@1',
    nativeType: 'character',
    typeParams: { length: { kind: 'arg', index: 0, path: ['size'], default: 21 } },
    id: true,
  },
} as const;

const plainNanoidDescriptor = {
  kind: 'fieldPreset',
  args: [nanoidOptionsArgumentMirror],
  output: {
    codecId: 'sql/char@1',
    nativeType: 'character',
    typeParams: { length: { kind: 'arg', index: 0, path: ['size'], default: 21 } },
  },
} as const;

const uuidv4Descriptor = {
  kind: 'fieldPreset',
  output: {
    codecId: 'sql/char@1',
    nativeType: 'character',
    typeParams: { length: 36 },
    id: true,
  },
} as const;

declare const idNanoid: FieldHelperFunctionWithNamedConstraint<typeof nanoidDescriptor>;
declare const idUuidv4String: FieldHelperFunctionWithNamedConstraint<typeof uuidv4Descriptor>;
declare const nanoid: FieldHelperFunctionWithoutNamedConstraint<typeof plainNanoidDescriptor>;

test('option-kind descriptor types as the literal union of its values', () => {
  type OnCreateArg = { readonly kind: 'option'; readonly values: readonly ['now'] };
  expectTypeOf<ArgTypeFromDescriptor<OnCreateArg>>().toEqualTypeOf<'now'>();

  type MultiValueArg = { readonly kind: 'option'; readonly values: readonly ['now', 'never'] };
  expectTypeOf<ArgTypeFromDescriptor<MultiValueArg>>().toEqualTypeOf<'now' | 'never'>();
});

test('optional descriptors get optional tuple slots', () => {
  const args = [
    { kind: 'number', optional: true, integer: true, minimum: 0 },
    { kind: 'option', values: ['now'], optional: true },
    { kind: 'option', values: ['now'], optional: true },
  ] as const satisfies readonly AuthoringArgumentDescriptor[];

  type Params = TupleFromArgumentDescriptors<typeof args>;

  expectTypeOf<Params>().toEqualTypeOf<readonly [number?, 'now'?, 'now'?]>();

  // Assignability is proved through a generic call site (matching real helper
  // usage) rather than a directly-typed variable: `exactOptionalPropertyTypes`
  // rejects an explicit `undefined` assigned to an optional tuple slot, but a
  // generic rest-parameter call inferring `Params` from the arguments is
  // unaffected — precisely the `field.temporal.timestamptz(undefined, undefined, 'now')`
  // shape callers use to skip a middle optional argument.
  function acceptsParams<const P extends Params>(...args: P): P {
    return args;
  }

  acceptsParams();
  acceptsParams(3);
  acceptsParams(3, 'now', 'now');
  acceptsParams(undefined, undefined, 'now');
});

test('required descriptors keep required tuple slots', () => {
  const args = [
    { kind: 'string' },
    { kind: 'number', optional: true },
  ] as const satisfies readonly AuthoringArgumentDescriptor[];

  type Params = TupleFromArgumentDescriptors<typeof args>;

  expectTypeOf<Params>().toEqualTypeOf<readonly [string, number?]>();

  function acceptsParams<const P extends Params>(...args: P): P {
    return args;
  }

  acceptsParams('name');
  acceptsParams('name', 3);
  // @ts-expect-error required arg must precede the optional one; the call must supply it.
  acceptsParams();
});

/**
 * A preset that has optional args AND declares `id` takes the named-constraint
 * overload pair. Signature 1 (no options) must win for calls whose arguments
 * satisfy the preset args, so a single preset argument is never mistaken for
 * the constraint options.
 */
test('named-constraint helper resolves preset args and constraint options across both overloads', () => {
  expectTypeOf(idNanoid({ size: 16 }).build().id).toEqualTypeOf<NamedConstraintSpec<undefined>>();
  expectTypeOf(idNanoid().build().id).toEqualTypeOf<NamedConstraintSpec<undefined>>();
  expectTypeOf(idNanoid({ size: 16 }, { name: 'x' }).build().id).toEqualTypeOf<
    NamedConstraintSpec<'x'>
  >();
});

/**
 * An options-only call resolves via signature 2 — but only because
 * `ObjectArgumentType` does not intersect with `{}` when every property is
 * optional.
 *
 * The mechanism is subtle enough to be worth stating: `{ size?: number }` is a
 * "weak type" (every property optional), and TypeScript rejects an assignment
 * to a weak type when the source shares none of its properties — so
 * `{ name: 'x' }` is not assignable and signature 1 falls through to signature
 * 2. The old `{} & { size?: number }` form defeated exactly that check: `{}`
 * is not itself weak, so weak-type detection never fired for the intersection
 * and signature 1 wrongly accepted `{ name: 'x' }` as the preset argument.
 *
 * The TS surface performs no runtime argument validation (`buildFieldPreset`
 * calls `instantiateAuthoringFieldPreset` directly), so this type-level check
 * is the only thing standing between this call and a silently-unnamed primary
 * key on a length-21 nanoid column.
 */
test('named-constraint helper routes an options-only call to the constraint overload', () => {
  expectTypeOf(idNanoid({ name: 'x' }).build().id).toEqualTypeOf<NamedConstraintSpec<'x'>>();
});

test('an all-optional object argument rejects a foreign key', () => {
  // @ts-expect-error `bogus` is not a declared property of the nanoid options object.
  nanoid({ bogus: 1 });
  // @ts-expect-error same check on the id-carrying preset, which takes the overload pair.
  idNanoid({ bogus: 1 });
});

test('an all-optional object argument type is a plain weak type, not an intersection with {}', () => {
  type NanoidArg = ObjectArgumentType<(typeof nanoidOptionsArgumentMirror)['properties']>;
  expectTypeOf<NanoidArg>().toEqualTypeOf<{ readonly size?: number }>();
});

test('presets with an all-optional object argument keep their existing call behavior', () => {
  expectTypeOf(nanoid({ size: 16 }).build().descriptor?.codecId).toEqualTypeOf<
    'sql/char@1' | undefined
  >();
  expectTypeOf(nanoid().build().descriptor?.codecId).toEqualTypeOf<'sql/char@1' | undefined>();
  expectTypeOf(nanoid().build().id).toEqualTypeOf<undefined>();
});

test('named-constraint helper without declared args keeps the no-args branch', () => {
  expectTypeOf(idUuidv4String({ name: 'x' }).build().id).toEqualTypeOf<NamedConstraintSpec<'x'>>();
  expectTypeOf(idUuidv4String().build().id).toEqualTypeOf<NamedConstraintSpec<undefined>>();
});
