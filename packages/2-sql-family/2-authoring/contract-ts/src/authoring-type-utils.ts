export type UnionToIntersection<U> = (U extends unknown ? (value: U) => void : never) extends (
  value: infer I,
) => void
  ? I
  : never;

export type NamedConstraintSpec<Name extends string | undefined = string | undefined> = {
  readonly name?: Name;
};
