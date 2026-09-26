import type {
  ResolveTemplateValue,
  TupleFromArgumentDescriptors,
} from '@internal/contract-authoring';
import type {
  AuthoringArgumentDescriptor,
  AuthoringFieldPresetDescriptor,
} from '@internal/framework-components/authoring';
import type { ColumnTypeDescriptor } from '@internal/framework-components/codec';
import type { ScalarFieldBuilder, ScalarFieldState } from './contract-dsl';

export type UnionToIntersection<U> = (U extends unknown ? (value: U) => void : never) extends (
  value: infer I,
) => void
  ? I
  : never;

export type NamedConstraintSpec<Name extends string | undefined = string | undefined> = {
  readonly name?: Name;
};

export type NamedConstraintState<
  Enabled extends boolean,
  Name extends string | undefined = undefined,
> = Enabled extends true ? NamedConstraintSpec<Name> : undefined;

export type SupportsNamedConstraintOptions<Descriptor extends AuthoringFieldPresetDescriptor> =
  Descriptor['output'] extends { readonly id: true }
    ? true
    : Descriptor['output'] extends { readonly unique: true }
      ? true
      : false;

export type FieldBuilderFromPresetDescriptor<
  Descriptor extends AuthoringFieldPresetDescriptor,
  Args extends readonly unknown[] = readonly [],
  ConstraintName extends string | undefined = undefined,
> = ScalarFieldBuilder<
  ScalarFieldState<
    ColumnTypeDescriptor<
      ResolveTemplateValue<Descriptor['output']['codecId'], Args> extends string
        ? ResolveTemplateValue<Descriptor['output']['codecId'], Args>
        : string
    >,
    undefined,
    ResolveTemplateValue<Descriptor['output']['nullable'], Args> extends true ? true : false,
    undefined,
    NamedConstraintState<
      ResolveTemplateValue<Descriptor['output']['id'], Args> extends true ? true : false,
      ConstraintName
    >,
    NamedConstraintState<
      ResolveTemplateValue<Descriptor['output']['unique'], Args> extends true ? true : false,
      ConstraintName
    >
  >
>;

export type FieldHelperFunctionWithoutNamedConstraint<
  Descriptor extends AuthoringFieldPresetDescriptor,
> = Descriptor extends {
  readonly args: infer Args extends readonly AuthoringArgumentDescriptor[];
}
  ? <const Params extends TupleFromArgumentDescriptors<Args>>(
      ...args: Params
    ) => FieldBuilderFromPresetDescriptor<Descriptor, Params>
  : () => FieldBuilderFromPresetDescriptor<Descriptor, readonly []>;

/**
 * An intersection of two call signatures rather than one rest-tuple signature
 * with a trailing `options?`. Once optional descriptors yield optional tuple
 * slots, `Params` can infer as the empty tuple, and a single-argument call
 * such as `field.id.nanoid({ size: 16 })` would bind its preset argument to
 * the trailing optional `options` parameter. Resolving the no-options
 * signature first, and falling through to the options-required signature only
 * when the argument list cannot satisfy it, keeps both spellings working.
 */
export type FieldHelperFunctionWithNamedConstraint<
  Descriptor extends AuthoringFieldPresetDescriptor,
> = Descriptor extends {
  readonly args: infer Args extends readonly AuthoringArgumentDescriptor[];
}
  ? (<const Params extends TupleFromArgumentDescriptors<Args>>(
      ...args: Params
    ) => FieldBuilderFromPresetDescriptor<Descriptor, Params>) &
      (<
        const Params extends TupleFromArgumentDescriptors<Args>,
        const Name extends string | undefined = undefined,
      >(
        ...args: [...params: Params, options: NamedConstraintSpec<Name>]
      ) => FieldBuilderFromPresetDescriptor<Descriptor, Params, Name>)
  : <const Name extends string | undefined = undefined>(
      options?: NamedConstraintSpec<Name>,
    ) => FieldBuilderFromPresetDescriptor<Descriptor, readonly [], Name>;

export type FieldHelperFunction<Descriptor extends AuthoringFieldPresetDescriptor> =
  SupportsNamedConstraintOptions<Descriptor> extends true
    ? FieldHelperFunctionWithNamedConstraint<Descriptor>
    : FieldHelperFunctionWithoutNamedConstraint<Descriptor>;

export type FieldHelpersFromNamespace<Namespace> = {
  readonly [K in keyof Namespace]: Namespace[K] extends AuthoringFieldPresetDescriptor
    ? FieldHelperFunction<Namespace[K]>
    : Namespace[K] extends Record<string, unknown>
      ? FieldHelpersFromNamespace<Namespace[K]>
      : never;
};
