import type { Expand, fieldOutput, ScopeField } from './scope';

type CodecFieldOutput<
  F extends ScopeField,
  CodecTypes extends Record<string, { readonly output: unknown }>,
> = F['codecId'] extends keyof CodecTypes
  ? F extends { many: true }
    ? readonly CodecTypes[F['codecId']]['output'][]
    : CodecTypes[F['codecId']]['output']
  : unknown;

type ResolveField<
  F extends ScopeField,
  CodecTypes extends Record<string, { readonly output: unknown }>,
> = typeof fieldOutput extends keyof F
  ? NonNullable<F[typeof fieldOutput & keyof F]> extends { readonly output: infer Output }
    ? ApplyNullable<Output, F>
    : never
  : ApplyNullable<CodecFieldOutput<F, CodecTypes>, F>;

type ApplyNullable<T, F extends ScopeField> = F['nullable'] extends true ? T | null : T;

export type ResolveRow<
  Row extends Record<string, ScopeField>,
  CodecTypes extends Record<string, { readonly output: unknown }>,
  PreResolved extends Record<string, unknown> = Record<string, never>,
> = Expand<{
  -readonly [K in keyof Row]: string extends keyof PreResolved
    ? ResolveField<Row[K], CodecTypes>
    : K extends keyof PreResolved
      ? ApplyNullable<PreResolved[K & keyof PreResolved], Row[K]>
      : ResolveField<Row[K], CodecTypes>;
}>;
