import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { platformEntrypointOf } from '@internal/publish-surface/import-roots';
import {
  excludedSubpaths,
  publicShells,
  type ShellDefinition,
  type ShellName,
} from '@internal/publish-surface/shells';
import { init as initLexer, parse as parseModule } from 'es-module-lexer';
import type { UserConfig } from 'tsdown';
import { defineConfig } from './base.ts';

/** A shell build configuration or mapping-table inconsistency. */
export class ShellConfigError extends Error {}

/**
 * Peers every shell declares by hand rather than deriving from the packages it
 * bundles: `validateShellManifest` neither expects nor rejects these.
 */
const handWrittenPeers = new Set(['typescript']);

interface InternalPackage {
  readonly name: string;
  readonly dir: string;
  readonly absDir: string;
  readonly entry: string;
  readonly published: boolean;
  readonly subpaths: readonly string[] | undefined;
  readonly shell: ShellName;
  readonly exports: Record<string, unknown>;
  readonly dependencies: Record<string, string>;
  readonly peerDependencies: Record<string, string>;
}

/**
 * Build configuration for a public publish shell (ADR 242).
 *
 * Generates one re-export entry per export subpath of each internal package
 * mapped to the shell, bundles all of them in a single rolldown build (shared
 * modules land in shared chunks, preserving module identity within the shell),
 * and rewrites imports of internal packages that belong to *other* shells to
 * their published entrypoints, marking them external.
 */
export async function defineShellConfig(shellName: ShellName): Promise<UserConfig> {
  const shell = publicShells.get(shellName);
  if (shell === undefined) throw new ShellConfigError(`unknown shell ${shellName}`);
  const shellDir = process.cwd();
  const repoRoot = findRepoRoot(shellDir);
  if (resolve(repoRoot, shell.dir) !== shellDir) {
    throw new ShellConfigError(
      `shell config for ${shellName} must run from ${shell.dir}, got ${shellDir}`,
    );
  }

  const lookup = readAllInternalPackages(repoRoot);
  const internals = [...lookup.values()].filter((pkg) => pkg.shell === shellName);

  await initLexer;

  // Generated entries live outside `src/` so turbo's `src/**` build input
  // never hashes a directory that only exists after a build.
  const srcDir = join(shellDir, 'src-gen');
  rmSync(srcDir, { recursive: true, force: true });
  mkdirSync(srcDir, { recursive: true });

  const entry: Record<string, string> = {};
  const addEntry = (entryName: string, fileName: string): string => {
    if (entryName.includes('__')) {
      throw new ShellConfigError(
        `entry name "${entryName}" contains "__", which is reserved as the flat-name separator`,
      );
    }
    // Flat file names: the dts plugin names declaration outputs after the
    // entry file's basename, so nested entry paths would strand every
    // `.d.mts` at the dist root (with hash-renaming on basename collisions),
    // away from its `.mjs` sibling. `__` maps back to `/` in the generated
    // exports map (see `shellExports`).
    const flatName = flatEntryName(entryName);
    if (entry[flatName] !== undefined) {
      throw new ShellConfigError(`duplicate shell entry name "${entryName}" in ${shellName}`);
    }
    entry[flatName] = `src-gen/${flatEntryName(fileName)}`;
    return join(srcDir, flatEntryName(fileName));
  };

  const aggregates = new Map<string, Map<string, string[]>>();
  for (const pkg of internals) {
    // Bundled-but-unpublished: the shell owns the code, so dependency
    // resolution below still treats it as internal to this shell, but it
    // names no entrypoint.
    if (!pkg.published) continue;
    // A declared subpath list publishes exactly those names ('.' is the
    // package's root export) and synthesizes no aggregate. Validate the list
    // against the package's real exports so a rename there fails the build
    // instead of silently dropping published surface.
    if (pkg.subpaths !== undefined) {
      const available = new Set(
        Object.keys(pkg.exports)
          .filter((subpath) => subpath === '.' || subpath.startsWith('./'))
          .map(publishedSubpathName),
      );
      const missing = pkg.subpaths.filter((subpath) => !available.has(subpath));
      if (missing.length > 0) {
        throw new ShellConfigError(
          `${shellName} publishes ${pkg.name} subpath(s) ${missing.join(', ')}, which that package does not export`,
        );
      }
    }
    const aggregated: { specifier: string; distFile: string }[] = [];
    let hasRootExport = false;
    for (const [subpath, value] of Object.entries(pkg.exports)) {
      if (subpath === './package.json') continue;
      if (excludedSubpaths.some((pattern) => pattern.test(subpath))) continue;
      if (pkg.subpaths !== undefined && !pkg.subpaths.includes(publishedSubpathName(subpath)))
        continue;
      const distFile = resolveExportTarget(value);
      if (distFile === undefined) {
        throw new ShellConfigError(
          `unsupported exports value for ${pkg.name} ${subpath}: ${JSON.stringify(value)}`,
        );
      }
      if (subpath === '.') hasRootExport = true;
      const entryName = shellEntryName(pkg.entry, subpath);
      const specifier = subpath === '.' ? pkg.name : `${pkg.name}/${subpath.slice(2)}`;
      const entryFile = addEntry(entryName, `${entryName}.ts`);
      writeFileSync(entryFile, entryModuleSource(specifier, join(pkg.absDir, distFile)));
      if (subpath !== '.') aggregated.push({ specifier, distFile: join(pkg.absDir, distFile) });
    }
    // The ADR names each internal package as a whole (`@prisma/orm-framework/contract`,
    // `@prisma/orm-target-postgres/adapter`, ...). When the internal package
    // has no root export, synthesize that aggregate from its subpath exports;
    // when it has one, the root export already owns the name. A package
    // occupying the shell's own namespace is the shell, so there is no
    // package-level name to synthesize.
    if (pkg.entry !== '' && !hasRootExport && aggregated.length > 0 && pkg.subpaths === undefined) {
      const expected = new Map<string, string[]>();
      for (const { specifier, distFile } of aggregated) {
        for (const name of moduleExports(specifier, distFile)) {
          if (name === 'default') continue;
          expected.set(name, [...(expected.get(name) ?? []), specifier]);
        }
      }
      aggregates.set(pkg.entry, expected);
      const entryFile = addEntry(pkg.entry, `${pkg.entry}.ts`);
      writeFileSync(
        entryFile,
        `${aggregated.map(({ specifier }) => `export * from '${specifier}';`).join('\n')}\n`,
      );
    }
  }

  // Forwarded surfaces: the generated modules import the sibling package by
  // its internal name, which the rewrite plugin turns into that sibling's
  // published entrypoint and marks external. Nothing is copied, so the
  // forwarded modules stay single-instance across the whole install.
  for (const mapping of shell.reexports ?? []) {
    const source = lookup.get(mapping.package);
    if (source === undefined) {
      throw new ShellConfigError(
        `${shellName} re-exports ${mapping.package}, which has no public shell mapping`,
      );
    }
    if (source.shell === shellName) {
      throw new ShellConfigError(
        `${shellName} re-exports ${mapping.package}, which it already publishes directly`,
      );
    }
    const hasSourceRootExport = Object.hasOwn(source.exports, '.');
    if (mapping.root !== false && mapping.subpaths === undefined && !hasSourceRootExport) {
      // No root export upstream: forward the sibling shell's synthesized
      // package-level aggregate, which carries no default export.
      const entryFile = addEntry(mapping.entry, `${mapping.entry}.ts`);
      writeFileSync(entryFile, `export * from '${mapping.package}';\n`);
    }
    const forwarded = mapping.subpaths;
    if (forwarded !== undefined) {
      const available = new Set(
        Object.keys(source.exports)
          .filter((subpath) => subpath.startsWith('./'))
          .map((subpath) => subpath.slice(2)),
      );
      const missing = forwarded.filter((subpath) => !available.has(subpath));
      if (missing.length > 0) {
        throw new ShellConfigError(
          `${shellName} forwards ${mapping.package} subpath(s) ${missing.join(', ')}, which that package does not export`,
        );
      }
    }
    for (const [subpath, value] of Object.entries(source.exports)) {
      if (subpath === './package.json') continue;
      if (subpath === '.' && mapping.root === false) continue;
      if (forwarded !== undefined && !forwarded.includes(subpath.slice(2))) continue;
      if (excludedSubpaths.some((pattern) => pattern.test(subpath))) continue;
      const distFile = resolveExportTarget(value);
      if (distFile === undefined) {
        throw new ShellConfigError(
          `unsupported exports value for ${source.name} ${subpath}: ${JSON.stringify(value)}`,
        );
      }
      const entryName = shellEntryName(mapping.entry, subpath);
      const specifier =
        subpath === '.' ? mapping.package : `${mapping.package}/${subpath.slice(2)}`;
      const entryFile = addEntry(entryName, `${entryName}.ts`);
      writeFileSync(entryFile, entryModuleSource(specifier, join(source.absDir, distFile)));
    }
  }

  validateShellManifest(shellName, shell, shellDir, internals, lookup);

  return defineConfig({
    entry,
    copy: (shell.copy ?? []).map((pattern) => ({ from: resolve(repoRoot, pattern) })),
    skipNodeModulesBundle: false,
    external: (id: string) => /^[@a-zA-Z]/.test(id) && !id.startsWith('@internal/'),
    dts: { enabled: true, sourcemap: true },
    exports: {
      enabled: 'local-only',
      customExports: shellExports,
      bin: false,
    },
    plugins: [crossShellRewritePlugin(shellName)],
    hooks: {
      'build:done': () => assertAggregatesComplete(shellName, shellDir, aggregates),
    },
  });
}

/**
 * Entry name for one export subpath of an internal package. A package
 * mapped to the empty entry occupies the shell's own namespace, so its
 * root export becomes the shell's root export (`index`, which tsdown
 * renders as `"."`).
 */
/** The name a package export subpath takes in a `subpaths` list: `'.'` for the root, `'x/y'` for `'./x/y'`. */
function publishedSubpathName(subpath: string): string {
  return subpath === '.' ? '.' : subpath.slice(2);
}

function shellEntryName(entry: string, subpath: string): string {
  const tail = subpath === '.' ? '' : subpath.slice(2);
  if (entry === '') return tail === '' ? 'index' : tail;
  return tail === '' ? entry : `${entry}/${tail}`;
}

/**
 * Expand the flat `__`-separated output names back into `/`-separated public
 * subpaths.
 */
function shellExports(exports: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(exports)) {
    out[key.replaceAll('__', '/')] = value;
  }
  return out;
}

function entryModuleSource(specifier: string, distFile: string): string {
  const lines = [`export * from '${specifier}';`];
  if (moduleExports(specifier, distFile).includes('default')) {
    lines.push(`export { default } from '${specifier}';`);
  }
  return `${lines.join('\n')}\n`;
}

/** Export names of a built internal module, with a diagnosable error when the dist is missing. */
function moduleExports(specifier: string, distFile: string): string[] {
  let source: string;
  try {
    source = readFileSync(distFile, 'utf8');
  } catch {
    throw new ShellConfigError(
      `cannot read ${distFile} for ${specifier} — build the internal package first (pnpm build from the repository root)`,
    );
  }
  const [, exports] = parseModule(source);
  return exports.map((e) => e.n);
}

/**
 * A synthesized aggregate uses `export *`, and ECMAScript silently omits a
 * name when two star-exported modules bind it to *different* values (the
 * same binding reached through several subpaths is fine). Verify the built
 * aggregate exports the full union of its subpaths' names, and fail naming
 * every dropped export so a collision is a decision, not a hole in the
 * public surface.
 */
function assertAggregatesComplete(
  shellName: ShellName,
  shellDir: string,
  aggregates: ReadonlyMap<string, ReadonlyMap<string, string[]>>,
): void {
  const problems: string[] = [];
  for (const [entryName, expected] of aggregates) {
    // Build outputs carry the flat name `addEntry` assigned, not the
    // `/`-separated public one.
    const distFile = join(shellDir, 'dist', `${flatEntryName(entryName)}.mjs`);
    const actual = new Set(moduleExports(`${shellName}/${entryName}`, distFile));
    for (const [name, specifiers] of expected) {
      if (!actual.has(name)) {
        problems.push(
          `${shellName}/${entryName} dropped "${name}" (ambiguous between ${specifiers.join(', ')})`,
        );
      }
    }
  }
  if (problems.length > 0) {
    throw new ShellConfigError(
      `aggregate entrypoints lost exports to star-export ambiguity:\n  ${problems.join('\n  ')}`,
    );
  }
}

function resolveExportTarget(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (isRecord(value)) {
    const target = value['import'] ?? value['default'];
    if (typeof target === 'string') return target;
  }
  return undefined;
}

function publicSpecifier(source: string, shellName: ShellName): { shell: ShellName; id: string } {
  try {
    return platformEntrypointOf(source);
  } catch (cause) {
    throw new ShellConfigError(
      `import of ${source} in shell ${shellName} has no public shell mapping`,
      { cause },
    );
  }
}

function crossShellRewritePlugin(shellName: ShellName) {
  return {
    name: 'prisma-public-shell-rewrite',
    resolveId(source: string) {
      if (!source.startsWith('@internal/')) return null;
      const target = publicSpecifier(source, shellName);
      if (target.shell === shellName) return null;
      return { id: target.id, external: true };
    },
    generateBundle(_options: unknown, bundle: Record<string, { type: string; code?: string }>) {
      for (const [fileName, output] of Object.entries(bundle)) {
        if (!fileName.endsWith('.d.mts') || output.type !== 'chunk') continue;
        if (typeof output.code !== 'string') continue;
        output.code = rewriteInternalModuleNames(output.code, shellName);
      }
    },
  };
}

/**
 * The dts bundler leaves inline `import("@internal/...")` type references (copied verbatim from the internal declaration files) in the emitted output, and keeps `declare module "@internal/..."` augmentations verbatim. This rewrites both to published specifiers. Same-shell references become self-references, which TypeScript resolves through the shell's own exports map. An `@internal/` module with no public mapping throws `ShellConfigError`.
 */
export function rewriteInternalModuleNames(declarations: string, shellName: ShellName): string {
  return declarations
    .replace(
      /import\((["'])(@internal\/[^"')]+)\1\)/g,
      (_match, quote: string, source: string) =>
        `import(${quote}${publicSpecifier(source, shellName).id}${quote})`,
    )
    .replace(
      /declare module (["'])(@internal\/[^"']+)\1/g,
      (_match, quote: string, source: string) =>
        `declare module ${quote}${publicSpecifier(source, shellName).id}${quote}`,
    );
}

function readAllInternalPackages(repoRoot: string): Map<string, InternalPackage> {
  const lookup = new Map<string, InternalPackage>();
  for (const [shellName, shell] of publicShells) {
    for (const mapping of shell.packages) {
      const absDir = resolve(repoRoot, mapping.dir);
      const manifest = readJson(join(absDir, 'package.json'));
      const name = stringField(manifest, 'name', mapping.dir);
      // Specifier resolution runs inside published bundles and reads the
      // declared name instead of the manifest, so the two must agree.
      if (name !== mapping.name) {
        throw new ShellConfigError(
          `${mapping.dir} declares name ${mapping.name} in the shell map but ${name} in its manifest`,
        );
      }
      // One internal module, one published package (ADR 242). Mapping a
      // package into two shells would ship two copies of it, and a
      // last-wins `set` would hide that behind a build that still succeeds.
      const claimed = lookup.get(name);
      if (claimed !== undefined) {
        throw new ShellConfigError(
          `${name} is mapped to both ${claimed.shell} and ${shellName}; each internal package belongs to exactly one shell`,
        );
      }
      lookup.set(name, {
        name,
        dir: mapping.dir,
        absDir,
        entry: mapping.entry,
        published: mapping.published !== false,
        subpaths: mapping.subpaths,
        shell: shellName,
        exports: recordField(manifest, 'exports'),
        dependencies: stringRecordField(manifest, 'dependencies'),
        peerDependencies: stringRecordField(manifest, 'peerDependencies'),
      });
    }
  }
  return lookup;
}

/**
 * The shell's manifest is hand-maintained; verify it declares exactly the
 * runtime dependencies the bundle needs: the union of the internals'
 * third-party dependencies plus one exact-pinned dependency per referenced
 * sibling shell.
 */
function validateShellManifest(
  shellName: ShellName,
  shell: ShellDefinition,
  shellDir: string,
  internals: readonly InternalPackage[],
  lookup: Map<string, InternalPackage>,
): void {
  const manifest = readJson(join(shellDir, 'package.json'));
  const version = stringField(manifest, 'version', shellName);

  const expectedDeps = new Map<string, string>();
  const expectedPeers = new Map<string, string>();
  const siblingShell = (pkg: InternalPackage, dep: string): ShellName => {
    const target = lookup.get(dep);
    if (target === undefined) {
      throw new ShellConfigError(
        `${pkg.name} depends on ${dep}, which has no public shell mapping`,
      );
    }
    return target.shell;
  };
  for (const pkg of internals) {
    for (const [dep, range] of Object.entries(pkg.dependencies)) {
      if (dep.startsWith('@internal/')) {
        const target = siblingShell(pkg, dep);
        if (target !== shellName) expectedDeps.set(target, `workspace:${version}`);
        continue;
      }
      const existing = expectedDeps.get(dep);
      if (existing === undefined || range === 'catalog:') {
        expectedDeps.set(dep, range);
        continue;
      }
      // `catalog:` is the repo-wide pin, so it outranks a literal range.
      // Two different literal ranges have no ordering between them: picking
      // one silently would publish a shell whose range contradicts what one
      // of its bundled packages asked for.
      if (existing !== 'catalog:' && existing !== range) {
        throw new ShellConfigError(
          `${shellName} bundles packages that ask for conflicting ranges of ${dep}: "${existing}" and "${range}"`,
        );
      }
    }
    for (const [dep, range] of Object.entries(pkg.peerDependencies)) {
      if (handWrittenPeers.has(dep)) continue;
      // An extension's peer on an internal adapter package becomes a peer on
      // the published target shell that carries it (ADR 242).
      if (dep.startsWith('@internal/')) {
        const target = siblingShell(pkg, dep);
        if (target !== shellName) expectedPeers.set(target, `workspace:${version}`);
        continue;
      }
      if (!expectedPeers.has(dep)) expectedPeers.set(dep, range);
    }
  }
  for (const mapping of shell.reexports ?? []) {
    const source = lookup.get(mapping.package);
    if (source !== undefined && source.shell !== shellName) {
      expectedDeps.set(source.shell, `workspace:${version}`);
    }
  }
  // A shell that declares a peer shell must not also depend on it: the
  // point of the peer is that the installer supplies the one copy everyone
  // shares, and a dependency alongside it would let a version skew resolve
  // to a second copy instead of failing the install.
  for (const peerShell of shell.peerShells ?? []) {
    expectedPeers.set(peerShell, `workspace:${version}`);
    expectedDeps.delete(peerShell);
  }
  // Peers picked up from the internal manifests are weaker evidence — some
  // internal packages declare an optional peer on a package they also
  // depend on — so there a real dependency still wins.
  for (const dep of expectedDeps.keys()) expectedPeers.delete(dep);

  const errors: string[] = [];
  const actualDeps = stringRecordField(manifest, 'dependencies');
  const actualPeers = stringRecordField(manifest, 'peerDependencies');
  for (const [dep, range] of expectedDeps) {
    if (actualDeps[dep] !== range) {
      errors.push(
        `dependencies["${dep}"] should be "${range}", got ${JSON.stringify(actualDeps[dep])}`,
      );
    }
  }
  for (const dep of Object.keys(actualDeps)) {
    if (!expectedDeps.has(dep))
      errors.push(`dependencies["${dep}"] is not needed by any bundled internal package`);
  }
  for (const [dep, range] of expectedPeers) {
    if (actualPeers[dep] !== range) {
      errors.push(
        `peerDependencies["${dep}"] should be "${range}", got ${JSON.stringify(actualPeers[dep])}`,
      );
    }
  }
  for (const dep of Object.keys(actualPeers)) {
    if (handWrittenPeers.has(dep)) continue;
    if (!expectedPeers.has(dep))
      errors.push(`peerDependencies["${dep}"] is not needed by any bundled internal package`);
  }
  if (errors.length > 0) {
    throw new ShellConfigError(
      `${shellName} package.json is out of sync with its internal packages:\n  ${errors.join('\n  ')}`,
    );
  }
}

function findRepoRoot(from: string): string {
  let dir = from;
  while (true) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new ShellConfigError(`could not find repository root above ${from}`);
    dir = parent;
  }
}

/**
 * The flat, `__`-separated form of a `/`-separated entry or file name. Build
 * outputs are named after this, and `shellExports` maps it back.
 */
function flatEntryName(name: string): string {
  return name.replaceAll('/', '__');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJson(file: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (!isRecord(parsed)) throw new ShellConfigError(`${file} does not contain a JSON object`);
  return parsed;
}

function stringField(manifest: Record<string, unknown>, field: string, context: string): string {
  const value = manifest[field];
  if (typeof value !== 'string') {
    throw new ShellConfigError(`package.json of ${context} has no string "${field}" field`);
  }
  return value;
}

function recordField(manifest: Record<string, unknown>, field: string): Record<string, unknown> {
  const value = manifest[field] ?? {};
  if (!isRecord(value)) throw new ShellConfigError(`package.json "${field}" is not an object`);
  return value;
}

function stringRecordField(
  manifest: Record<string, unknown>,
  field: string,
): Record<string, string> {
  const value = recordField(manifest, field);
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'string') {
      throw new ShellConfigError(`package.json "${field}"["${key}"] is not a string`);
    }
    out[key] = entry;
  }
  return out;
}
