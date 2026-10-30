/**
 * The mechanism that turns a Prisma 7 scalar or `@db.*` spelling into the
 * Prisma 8 type constructor call that produces the same column. The table
 * itself is target knowledge, supplied by the target binding.
 */
export interface Prisma7TypeMapping {
  readonly constructorPath: readonly string[];
  /** The values of the constructor's arguments, as the constructor takes them. */
  readonly args: readonly unknown[];
}

export interface Prisma7TypeMap {
  /** Prisma 7 scalar name to the constructor Prisma 7 uses for it by default. */
  readonly scalars: Readonly<Record<string, Prisma7TypeMapping>>;
  /**
   * `@db.X` spelling to the constructor Prisma 7 uses for it. The attribute's
   * own arguments, read as a schema's are, replace `args`; `args` are what the
   * column gets without any.
   */
  readonly nativeTypes: Readonly<Record<string, Prisma7TypeMapping>>;
  /** `@db.X` spellings whose column type a database extension provides, read only when the pack that declares the extension is composed. */
  readonly extensionNativeTypes: Readonly<Record<string, Prisma7ExtensionTypeMapping>>;
}

export interface Prisma7ExtensionTypeMapping extends Prisma7TypeMapping {
  /** The extension's name in the database, a key of the binding's extension packs. */
  readonly extension: string;
}

/** An extension pack, and the import a config writes to compose it: `import <importName> from '<importPath>'`. */
export interface Prisma7ExtensionPack {
  readonly id: string;
  readonly importName: string;
  readonly importPath: string;
}

export type Prisma7NativeTypeLookup =
  | { readonly kind: 'mapped'; readonly mapping: Prisma7TypeMapping }
  | { readonly kind: 'packNotComposed'; readonly pack: Prisma7ExtensionPack }
  | { readonly kind: 'unknown' };

export function prisma7ScalarMapping(
  typeMap: Prisma7TypeMap,
  scalar: string,
): Prisma7TypeMapping | undefined {
  return Object.hasOwn(typeMap.scalars, scalar) ? typeMap.scalars[scalar] : undefined;
}

export function prisma7NativeTypeMapping(
  typeMap: Prisma7TypeMap,
  extensionPacks: Readonly<Record<string, Prisma7ExtensionPack>>,
  nativeType: string,
  composedExtensions: ReadonlySet<string>,
): Prisma7NativeTypeLookup {
  const builtIn = Object.hasOwn(typeMap.nativeTypes, nativeType)
    ? typeMap.nativeTypes[nativeType]
    : undefined;
  if (builtIn !== undefined) return { kind: 'mapped', mapping: builtIn };
  const fromExtension = Object.hasOwn(typeMap.extensionNativeTypes, nativeType)
    ? typeMap.extensionNativeTypes[nativeType]
    : undefined;
  const pack =
    fromExtension !== undefined && Object.hasOwn(extensionPacks, fromExtension.extension)
      ? extensionPacks[fromExtension.extension]
      : undefined;
  if (fromExtension === undefined || pack === undefined) return { kind: 'unknown' };
  return composedExtensions.has(pack.id)
    ? { kind: 'mapped', mapping: fromExtension }
    : { kind: 'packNotComposed', pack };
}
