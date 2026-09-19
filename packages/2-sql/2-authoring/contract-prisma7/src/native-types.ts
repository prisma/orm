/**
 * The mechanism that turns a Prisma 7 scalar or `@db.*` spelling into the
 * Prisma 8 type constructor call that produces the same column. The table
 * itself is target knowledge, supplied by the target binding.
 */
export interface Prisma7TypeMapping {
  readonly constructorName: string;
  readonly args: readonly string[];
}

export interface Prisma7TypeMap {
  /** Prisma 7 scalar name to the constructor Prisma 7 uses for it by default. */
  readonly scalars: Readonly<Record<string, Prisma7TypeMapping>>;
  /**
   * `@db.X` spelling to the constructor Prisma 7 uses for it. The attribute's
   * own arguments replace `args`; `args` are what the column gets without any.
   */
  readonly nativeTypes: Readonly<Record<string, Prisma7TypeMapping>>;
}

export function prisma7ScalarMapping(
  typeMap: Prisma7TypeMap,
  scalar: string,
): Prisma7TypeMapping | undefined {
  return Object.hasOwn(typeMap.scalars, scalar) ? typeMap.scalars[scalar] : undefined;
}

export function prisma7NativeTypeMapping(
  typeMap: Prisma7TypeMap,
  nativeType: string,
  args: readonly string[],
): Prisma7TypeMapping | undefined {
  const mapping = Object.hasOwn(typeMap.nativeTypes, nativeType)
    ? typeMap.nativeTypes[nativeType]
    : undefined;
  if (mapping === undefined) return undefined;
  return args.length === 0 ? mapping : { constructorName: mapping.constructorName, args };
}
