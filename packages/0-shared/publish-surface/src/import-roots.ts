/**
 * Import-root resolution: the one place that turns an internal workspace
 * specifier into the name generated code should carry.
 *
 * Emission writes package names into files the user keeps — generated
 * contract types, scaffolded migrations, `prisma orm init` output. Which
 * name is correct depends on how the application installed Prisma Next, so
 * every emitter resolves through an {@link ImportRoot} rather than hardcoding
 * a specifier. The mapping itself is `./shells`; nothing here duplicates it.
 */

import { publicShells, type ShellDefinition, type ShellName } from './shells';

const INTERNAL_SCOPE = '@internal/';
const PUBLISHED_SCOPE = '@prisma/';

/** An import root that emitted code cannot express. */
export class ImportRootError extends Error {}

export type ImportRootMode = 'internal' | 'facade' | 'platform';

/**
 * The published packages an application depends on directly, from emission's
 * point of view.
 *
 * - `internal` — the repo's own workspace names. Emitted output is unchanged
 *   from before ADR 242; this is the default and stays so until every in-repo
 *   consumer imports published names.
 * - `facade` — the application installed one `@prisma/orm-<database>` package.
 * - `platform` — a decomposed install that wires the platform packages itself.
 */
export type ImportRoot =
  | { readonly mode: 'internal' }
  | { readonly mode: 'facade'; readonly facade: ShellName }
  | { readonly mode: 'platform' };

// Narrower than `ImportRoot` on purpose: the internal root is valid wherever
// a root is taken, including the places that accept only a subset.
export const internalImportRoot: Extract<ImportRoot, { mode: 'internal' }> = { mode: 'internal' };

/**
 * Rewrites one module specifier for an import root. Specifiers outside the
 * internal scope — relative paths, `node:` builtins, third-party packages —
 * come back unchanged.
 */
export type ImportSpecifierResolver = (specifier: string) => string;

/**
 * The import root an application's own dependency list expresses.
 *
 * Emission has to name packages the application can actually resolve, and the
 * application already states which those are. Reading its manifest keeps the
 * two from drifting and lets consumers move to published names one project at
 * a time instead of behind a repository-wide switch.
 *
 * A project that names exactly one facade is on the facade root; one that
 * names platform shells without a facade is a decomposed install; anything
 * else — including a project with no `@prisma/orm-*` dependency at all — is on
 * the internal root, which emits workspace names unchanged.
 *
 * @throws {ImportRootError} when the project depends on two facades, which no
 * single generated file can be emitted for.
 */
export function importRootForDependencies(dependencies: Iterable<string>): ImportRoot {
  const named = new Set(dependencies);
  const facades: ShellName[] = [];
  let hasPlatform = false;
  for (const [shell, definition] of publicShells) {
    if (!named.has(shell)) continue;
    if (definition.kind === 'facade') facades.push(shell);
    if (definition.kind === 'platform') hasPlatform = true;
  }
  if (facades.length > 1) {
    throw new ImportRootError(
      `an application may depend on only one database facade, but this one depends on ${facades.join(' and ')}`,
    );
  }
  const [facade] = facades;
  if (facade !== undefined) return { mode: 'facade', facade };
  return hasPlatform ? { mode: 'platform' } : internalImportRoot;
}

interface OwningShell {
  readonly shell: ShellName;
  readonly entry: string;
}

const owners: ReadonlyMap<string, OwningShell> = buildOwnerIndex(publicShells);

/**
 * Takes the shell map as an argument rather than closing over `publicShells`
 * so the duplicate-owner guard is reachable from a test: the real map is
 * valid by construction, and a guard nothing can exercise is a guard nobody
 * knows still works.
 */
export function buildOwnerIndex(
  shells: ReadonlyMap<ShellName, ShellDefinition>,
): Map<string, OwningShell> {
  const index = new Map<string, OwningShell>();
  for (const [shell, definition] of shells) {
    for (const pkg of definition.packages) {
      const existing = index.get(pkg.name);
      if (existing !== undefined) {
        throw new ImportRootError(
          `${pkg.name} is mapped to both ${existing.shell} and ${shell}; ` +
            'one module may live in only one published package (ADR 242)',
        );
      }
      index.set(pkg.name, { shell, entry: pkg.entry });
    }
  }
  return index;
}

function splitSpecifier(specifier: string): { name: string; subpath: string } {
  const [scope, pkg, ...rest] = specifier.split('/');
  return { name: `${scope}/${pkg}`, subpath: rest.join('/') };
}

function joinEntrypoint(shell: ShellName, entry: string, subpath: string): string {
  const tail = [entry, subpath].filter(Boolean).join('/');
  return tail === '' ? shell : `${shell}/${tail}`;
}

/**
 * The shells an application installs directly under this root. Emitted code
 * may name only these: a package manager puts a package's own dependencies in
 * its own `node_modules`, so importing a transitively installed package fails
 * to resolve at run time even though the files are on disk.
 */
export function directDependencyShells(root: ImportRoot): ReadonlySet<ShellName> {
  const direct = new Set<ShellName>();
  if (root.mode === 'internal') return direct;
  for (const [shell, definition] of publicShells) {
    if (definition.kind === 'extension') direct.add(shell);
    if (root.mode === 'platform' && definition.kind === 'platform') direct.add(shell);
  }
  if (root.mode === 'facade') direct.add(root.facade);
  return direct;
}

function owningShell(specifier: string, name: string): OwningShell {
  const owner = owners.get(name);
  if (owner === undefined) {
    throw new ImportRootError(`${specifier} is not mapped to any published shell`);
  }
  return owner;
}

/**
 * The platform-install name for an internal specifier, with the shell that
 * owns it. The shell build needs both: an import that stays inside the shell
 * being built is bundled rather than externalized.
 */
export function platformEntrypointOf(specifier: string): { shell: ShellName; id: string } {
  const { name, subpath } = splitSpecifier(specifier);
  const owner = owningShell(specifier, name);
  return { shell: owner.shell, id: joinEntrypoint(owner.shell, owner.entry, subpath) };
}

/**
 * The facade's own name for an internal specifier it republishes, or
 * `undefined` when the facade does not carry that surface.
 */
function facadeEntrypoint(facade: ShellName, name: string, subpath: string): string | undefined {
  const definition = publicShells.get(facade);
  /* v8 ignore next -- @preserve: every ShellName is a key of publicShells */
  if (definition === undefined) throw new ImportRootError(`unknown shell ${facade}`);
  if (definition.kind !== 'facade') {
    throw new ImportRootError(`${facade} is a ${definition.kind} shell, not a facade`);
  }
  for (const reexport of definition.reexports ?? []) {
    if (reexport.package !== name) continue;
    // A `root: false` forward covers subpaths only — the facade's own code
    // already owns the bare entry name.
    if (subpath === '' && reexport.root === false) return undefined;
    if (reexport.subpaths !== undefined && !reexport.subpaths.includes(subpath)) return undefined;
    return joinEntrypoint(facade, reexport.entry, subpath);
  }
  return undefined;
}

function describe(root: ImportRoot): string {
  return root.mode === 'facade' ? `${root.mode} (${root.facade})` : root.mode;
}

export function resolveImportSpecifier(specifier: string, root: ImportRoot): string {
  if (root.mode === 'internal') return specifier;
  if (!specifier.startsWith(INTERNAL_SCOPE)) return specifier;

  const { name, subpath } = splitSpecifier(specifier);
  if (root.mode === 'facade') {
    const republished = facadeEntrypoint(root.facade, name, subpath);
    if (republished !== undefined) return republished;
  }

  const owner = owningShell(specifier, name);
  const published = joinEntrypoint(owner.shell, owner.entry, subpath);
  if (!directDependencyShells(root).has(owner.shell)) {
    throw new ImportRootError(unreachableUnder(specifier, published, root));
  }
  return published;
}

/**
 * Why a specifier has no name under `root`.
 *
 * The facade wording deliberately does not say "not a direct dependency":
 * under ADR 242 the answer to that is never "install the platform package
 * too", it is that the facade has to republish the surface.
 */
function unreachableUnder(specifier: string, published: string, root: ImportRoot): string {
  if (root.mode === 'facade') {
    return (
      `${specifier} has no name under ${root.facade}: the facade does not ` +
      `republish ${published}. An application installs one facade and nothing ` +
      'else, so every surface it reaches has to be one of that facade’s own ' +
      'entrypoints (ADR 242).'
    );
  }
  return (
    `${specifier} resolves to ${published}, which an application on the ` +
    `${describe(root)} import root does not depend on directly. ` +
    'Emitted code may name only direct dependencies (ADR 242).'
  );
}

export function createImportSpecifierResolver(root: ImportRoot): ImportSpecifierResolver {
  if (root.mode === 'internal') return (specifier) => specifier;
  return (specifier) => resolveImportSpecifier(specifier, root);
}

/**
 * The import roots a scaffolded application can be generated against.
 *
 * `platform` is absent deliberately, and this is a modelling statement rather
 * than a limitation to be lifted: `prisma orm init` writes an application
 * around a per-database facade, and that facade's `runtime` entrypoint is its
 * own wiring code, not a re-export of anything. A decomposed install has no
 * name for it because it has no such module — it wires the platform packages
 * itself. Scaffolding a decomposed project is a different template, not a
 * different import root.
 */
export type ScaffoldImportRoot = Extract<ImportRoot, { mode: 'internal' | 'facade' }>;

/**
 * Builds the resolver `prisma orm init` scaffolds with. Identical to
 * {@link createImportSpecifierResolver} except that it will not accept a root
 * a scaffold cannot express, so the impossible case is rejected where the
 * resolver is made rather than when a template happens to hit a name.
 */
export function createScaffoldSpecifierResolver(root: ScaffoldImportRoot): ImportSpecifierResolver {
  return createImportSpecifierResolver(root);
}

// Covers every form generated code uses to name a module: `import … from
// '<s>'`, a bare side-effect `import '<s>'`, `import('<s>')` in a type
// position, and `export … from '<s>'`. Both quote styles, so a change of
// quoting in the renderers cannot silently empty the scan.
const MODULE_SPECIFIER = /\b(?:from|import)\s*\(?\s*(['"])([^'"\n]+)\1/g;

/**
 * True when `source` contains module syntax that must carry a quoted
 * specifier: `import '<s>'`, `import('<s>')`, or an import/export clause
 * followed by `from '<s>'`.
 *
 * Deliberately independent of {@link MODULE_SPECIFIER} — it exists to notice
 * when that scanner has stopped matching, so it accepts any quote character,
 * including the backtick a renderer must never emit. It does still require a
 * quote: the word "import" on its own appears in prose and comments all the
 * time, and treating that as module syntax made the check below fire on files
 * that have no imports at all.
 */
const HAS_IMPORT_SYNTAX =
  /(?:^|[\s(;}])import\s*[('"`]|(?:^|[\s;}])(?:import|export)\b[\w$*,{}\s]*?\bfrom\s*['"`]/;

/** The module specifiers a generated source file names. */
export function importedSpecifiers(source: string): string[] {
  return [...source.matchAll(MODULE_SPECIFIER)].map(([, , specifier]) => specifier ?? '');
}

/**
 * The specifiers in a generated file that the application would not have as a
 * direct dependency under `root` — the thing no emitted file may contain.
 *
 * Under the `internal` root nothing is reported: those names are the
 * repository's own, and every in-repo consumer resolves them through the
 * workspace.
 *
 * Throws rather than returning `[]` when the source plainly has imports but
 * the scan found none. An audit whose scanner has stopped matching would
 * otherwise report every file as clean, which is the one failure mode that
 * makes the audit worse than not having it.
 */
export function transitiveImports(source: string, root: ImportRoot): string[] {
  const specifiers = importedSpecifiers(source);
  if (specifiers.length === 0 && HAS_IMPORT_SYNTAX.test(source)) {
    throw new ImportRootError(
      'source contains import syntax but no specifier was recognised; ' +
        'the audit would pass vacuously',
    );
  }
  if (root.mode === 'internal') return [];
  const direct = new Set<string>(directDependencyShells(root));
  return specifiers.filter((specifier) => {
    if (specifier.startsWith(INTERNAL_SCOPE)) return true;
    if (!specifier.startsWith(PUBLISHED_SCOPE)) return false;
    const [scope, shell] = specifier.split('/');
    const name = `${scope}/${shell}`;
    return !direct.has(name) && !EXTERNAL_DIRECT_DEPENDENCIES.has(name);
  });
}

/**
 * Published packages this workspace does not own but `init` installs into a
 * scaffolded application directly, so its files may import them:
 * `@prisma/cli-engine` is the config file's `definePrismaConfig` import.
 */
const EXTERNAL_DIRECT_DEPENDENCIES: ReadonlySet<string> = new Set(['@prisma/cli-engine']);
