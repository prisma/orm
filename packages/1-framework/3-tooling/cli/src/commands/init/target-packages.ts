/**
 * A target package Prisma vouches for: its names, and the facts `init` needs before the package is
 * installed. Listing a package gives it a short name for `--target`, a line in the picker, the
 * mapping from an earlier Prisma's `datasource` provider, and the drivers installed with it.
 * Everything else `init` writes comes from the package's own init contribution.
 */
export interface KnownTargetPackage {
  readonly shortName: string;
  readonly aliases: readonly string[];
  readonly packageName: string;
  /**
   * The package's name inside this repository. Workspace builds name their modules with it, and
   * older versions of `init` installed the package under it.
   */
  readonly workspacePackageName: string;
  /** Shown before the package is installed, so it cannot come from the package. */
  readonly label: string;
  /** The `datasource` provider of a schema the package reads, and the last Prisma version that wrote one. */
  readonly provider: { readonly name: string; readonly writtenBy: 6 | 7 };
  /**
   * The driver packages installed with the target package, which it declares as required peers.
   * A package manager with strict peer checks refuses the package without them, and the printed
   * Prisma 6 setup installs them before `init` has installed anything. The package's other
   * required peers, such as the driver's type package, are not installed yet.
   */
  readonly peerPackages: readonly string[];
}

export const KNOWN_TARGET_PACKAGES = [
  {
    // biome-ignore lint/plugin/no-family-vocabulary: an entry of the list of known target packages, which holds names only
    shortName: 'postgres',
    // biome-ignore lint/plugin/no-family-vocabulary: an entry of the list of known target packages, which holds names only
    aliases: ['postgresql'],
    // biome-ignore lint/plugin/no-family-vocabulary: an entry of the list of known target packages, which holds names only
    packageName: '@prisma/orm-postgres',
    // biome-ignore lint/plugin/no-family-vocabulary: an entry of the list of known target packages, which holds names only
    workspacePackageName: '@internal/postgres',
    // biome-ignore lint/plugin/no-family-vocabulary: an entry of the list of known target packages, which holds names only
    label: 'PostgreSQL',
    // biome-ignore lint/plugin/no-family-vocabulary: an entry of the list of known target packages, which holds names only
    provider: { name: 'postgresql', writtenBy: 7 },
    peerPackages: ['pg'],
  },
  {
    // biome-ignore lint/plugin/no-family-vocabulary: an entry of the list of known target packages, which holds names only
    shortName: 'mongodb',
    // biome-ignore lint/plugin/no-family-vocabulary: an entry of the list of known target packages, which holds names only
    aliases: ['mongo'],
    // biome-ignore lint/plugin/no-family-vocabulary: an entry of the list of known target packages, which holds names only
    packageName: '@prisma/orm-mongo',
    // biome-ignore lint/plugin/no-family-vocabulary: an entry of the list of known target packages, which holds names only
    workspacePackageName: '@internal/mongo',
    // biome-ignore lint/plugin/no-family-vocabulary: an entry of the list of known target packages, which holds names only
    label: 'MongoDB',
    // biome-ignore lint/plugin/no-family-vocabulary: an entry of the list of known target packages, which holds names only
    provider: { name: 'mongodb', writtenBy: 6 },
    // biome-ignore lint/plugin/no-family-vocabulary: an entry of the list of known target packages, which holds names only
    peerPackages: ['mongodb'],
  },
] as const satisfies readonly KnownTargetPackage[];

export type TargetShortName = (typeof KNOWN_TARGET_PACKAGES)[number]['shortName'];

export type KnownTarget = KnownTargetPackage & { readonly shortName: TargetShortName };

export const TARGET_SHORT_NAMES: readonly TargetShortName[] = KNOWN_TARGET_PACKAGES.map(
  (entry) => entry.shortName,
);

/** The flag's placeholder word; the usage line puts it in angle brackets itself. */
export const TARGET_FLAG_PLACEHOLDER = 'package';

/** Stands for a target package's name wherever `init` shows what `--target` takes. */
export const PACKAGE_NAME_PLACEHOLDER = `<${TARGET_FLAG_PLACEHOLDER}>`;

/** Every Prisma 8 package lists it in the `keywords` of its `package.json`; init checks for it. */
export const PRISMA_ORM_PACKAGE_KEYWORD = 'prisma-orm-extension';

/**
 * The entry `--target` names by its short name or an alias, in any case, or by its package name
 * exactly.
 */
export function findTargetByName(value: string): KnownTarget | undefined {
  const name = value.toLowerCase();
  return KNOWN_TARGET_PACKAGES.find(
    (entry) =>
      entry.shortName === name ||
      entry.aliases.some((alias) => alias === name) ||
      entry.packageName === value,
  );
}

/**
 * The target package `init` installs, listed or not. A listed package and an unlisted one run the
 * same code.
 */
export interface TargetPackage {
  readonly packageName: string;
  /** The list entry of a listed package. */
  readonly listed: KnownTarget | undefined;
}

export function listedTargetPackage(entry: KnownTarget): TargetPackage {
  return { packageName: entry.packageName, listed: entry };
}

export function unlistedTargetPackage(packageName: string): TargetPackage {
  return { packageName, listed: undefined };
}

/** What `--json` reports as `target`: the short name of a listed package, otherwise the package name. */
export function reportedTargetName(target: TargetPackage): string {
  return target.listed?.shortName ?? target.packageName;
}

/**
 * The drivers installed with the package, before its contribution is loaded. Only the list knows
 * them before the install, so an unlisted package has none, and its contribution's `peerPackages`
 * go into the later install.
 */
export function firstInstallDrivers(target: TargetPackage): readonly string[] {
  return target.listed?.peerPackages ?? [];
}

/**
 * The entry a `datasource` provider names, matched exactly: the provider itself, or the short
 * name or an alias.
 */
export function findTargetByProvider(provider: string): KnownTarget | undefined {
  return KNOWN_TARGET_PACKAGES.find(
    (entry) =>
      entry.provider.name === provider ||
      entry.shortName === provider ||
      entry.aliases.some((alias) => alias === provider),
  );
}

/** The entry whose provider only Prisma 6 and earlier wrote; such a schema is a Prisma 6 schema. */
export function findPrisma6OnlyTarget(provider: string | undefined): KnownTarget | undefined {
  return KNOWN_TARGET_PACKAGES.find(
    (entry) => entry.provider.writtenBy === 6 && entry.provider.name === provider,
  );
}
