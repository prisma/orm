import type { Expand, ScopeField } from './scope';

type ResolveField<
  F extends ScopeField,
  CodecTypes extends Record<string, { readonly output: unknown }>,
> = F['codecId'] extends keyof CodecTypes
  ? F['nullable'] extends true
    ? CodecTypes[F['codecId']]['output'] | null
    : CodecTypes[F['codecId']]['output']
  : unknown;

type ApplyNullable<T, F extends ScopeField> = F['nullable'] extends true ? T | null : T;

export type ResolveRow<
  Row extends Record<string, ScopeField>,
  CodecTypes extends Record<string, { readonly output: unknown }>,
  PreResolved extends Record<string, unknown> = Record<string, never>,
> = Expand<{
  -readonly [K in keyof Row]: string extends keyof PreResolved
    ? ResolveField<Row[K], CodecTypes>
    : K extends keyof PreResolved
      ? ApplyNullable<NonNullable<PreResolved[K & keyof PreResolved]>, Row[K]>
      : ResolveField<Row[K], CodecTypes>;
}>;
