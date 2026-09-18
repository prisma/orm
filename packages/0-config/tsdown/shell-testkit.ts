import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { publicShells } from '@internal/publish-surface/shells';
import { init as initLexer, parse as parseModule } from 'es-module-lexer';

/** A tarball-install smoke-test failure with the offending command output attached. */
class ShellTestError extends Error {}

/**
 * The supply-chain settings a scratch project installs under. Kept in step with
 * `minimumReleaseAge` / `minimumReleaseAgeExclude` and `trustPolicy` / `trustPolicyExclude` in
 * the repo's pnpm-workspace.yaml, which a scratch project outside the workspace does not inherit.
 */
const MINIMUM_RELEASE_AGE_MINUTES = 1440;
const MINIMUM_RELEASE_AGE_EXCLUDE = [
  '@prisma/cli-engine',
  '@prisma/dev',
  '@prisma/streams-local',
] as const;
const TRUST_POLICY = 'no-downgrade';
const TRUST_POLICY_EXCLUDE = [
  'chokidar@4.0.3',
  'evlog@1.9.0',
  'semver@6.3.1',
  'undici@5.29.0',
  'undici-types@6.21.0',
] as const;
export interface PackedShell {
  readonly name: string;
  readonly tarball: string;
  /**
   * Whether cross-shell dependencies on this name are redirected to the
   * tarball. Stand-ins packed at a skewed version occupy their name only,
   * so they set this to false and are reached solely as direct dependencies.
   */
  readonly override?: boolean;
}

/** The `package.json` of a package directory, as a record. */
function readManifest(packageDir: string): Record<string, unknown> {
  const manifest: unknown = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
  if (!isRecord(manifest)) throw new ShellTestError(`${packageDir}/package.json is not an object`);
  return manifest;
}

function manifestName(packageDir: string, manifest: Record<string, unknown>): string {
  const name = manifest['name'];
  if (typeof name !== 'string') throw new ShellTestError(`${packageDir}/package.json has no name`);
  return name;
}

/** `pnpm pack` a shell package into `outDir`, returning the published name + tarball path. */
export function packShell(shellDir: string, outDir: string): PackedShell {
  const name = manifestName(shellDir, readManifest(shellDir));
  const tarball = join(outDir, `${name.replaceAll(/[@/]/g, '-').replace(/^-/, '')}.tgz`);
  execFileSync('pnpm', ['pack', '--out', tarball], { cwd: shellDir, stdio: 'pipe' });
  return { name, tarball };
}

/**
 * `pnpm pack` a stand-in for a shell package under a different version, so
 * a test can build the version skew a peer dependency exists to prevent.
 * Only the manifest and `dist` are copied — the published tarball's `files`
 * are exactly those.
 */
export function packShellAtVersion(shellDir: string, outDir: string, version: string): PackedShell {
  const manifest = readManifest(shellDir);
  const name = manifestName(shellDir, manifest);
  const stageDir = join(outDir, `restaged-${name.replaceAll(/[@/]/g, '-').replace(/^-/, '')}`);
  // `cpSync` merges rather than replaces, so a stage directory left by an
  // earlier run would contribute dist files the shell no longer builds.
  rmSync(stageDir, { recursive: true, force: true });
  mkdirSync(stageDir, { recursive: true });
  cpSync(join(shellDir, 'dist'), join(stageDir, 'dist'), { recursive: true });
  // The staging directory is outside the workspace, so `pnpm pack` can
  // resolve neither protocol pnpm would have resolved during a real pack:
  // `workspace:` becomes the plain version it names, and `catalog:` entries
  // are dropped. That makes this a stand-in for the real package — enough
  // to occupy its name at another version — not a substitute for it.
  const staged: Record<string, unknown> = { ...manifest, version };
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    const deps = staged[field];
    if (!isRecord(deps)) continue;
    staged[field] = Object.fromEntries(
      Object.entries(deps)
        .filter(([, range]) => !(typeof range === 'string' && range.startsWith('catalog:')))
        .map(([dep, range]) => [
          dep,
          typeof range === 'string' ? range.replace(/^workspace:/, '') : range,
        ]),
    );
  }
  delete staged['devDependencies'];
  writeFileSync(join(stageDir, 'package.json'), `${JSON.stringify(staged, null, 2)}\n`);
  const tarball = join(outDir, `${name.replaceAll(/[@/]/g, '-').replace(/^-/, '')}-${version}.tgz`);
  execFileSync('pnpm', ['pack', '--out', tarball], { cwd: stageDir, stdio: 'pipe' });
  return { name, tarball, override: false };
}

export interface InstallOptions {
  /**
   * Which packed shells the scratch project *declares*, so a test can
   * install one package the way an application would and let the rest
   * arrive transitively. Defaults to all of them.
   */
  readonly direct?: readonly string[];
  /** Extra `.npmrc` lines, e.g. `strict-peer-dependencies=true`. */
  readonly npmrc?: readonly string[];
}

export interface InstallResult {
  readonly ok: boolean;
  /** Combined stdout and stderr of `pnpm install`. */
  readonly output: string;
}

/**
 * Install packed shells into a scratch project outside the workspace,
 * reporting whether the install succeeded instead of throwing.
 *
 * Every shell is a pnpm override, so cross-shell dependencies (exact
 * lockstep versions that are not on the npm registry yet) resolve to the
 * local tarballs.
 */
export function tryInstallShells(
  scratchDir: string,
  shells: readonly PackedShell[],
  options: InstallOptions = {},
): InstallResult {
  mkdirSync(scratchDir, { recursive: true });
  const fileDeps = Object.fromEntries(shells.map((s) => [s.name, `file:${s.tarball}`]));
  const direct = options.direct ?? shells.map((s) => s.name);
  const manifest = {
    name: 'shell-tarball-smoke',
    private: true,
    type: 'module',
    dependencies: Object.fromEntries(direct.map((name) => [name, fileDeps[name]])),
  };
  writeFileSync(join(scratchDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  // pnpm 10 reads overrides and its own settings from pnpm-workspace.yaml;
  // a `pnpm.overrides` field in package.json and pnpm-specific keys in
  // `.npmrc` are ignored, which would let cross-shell dependencies fall
  // through to the npm registry and strict-peer settings silently lapse.
  const overrideLines = shells
    .filter((s) => s.override !== false)
    .map((s) => `  ${JSON.stringify(s.name)}: ${JSON.stringify(`file:${s.tarball}`)}`);
  const settingLines = (options.npmrc ?? []).map((line) => {
    // Split on the first `=` only — an npmrc value may itself contain `=`
    // (e.g. a base64 auth token), and String#split's limit truncates it.
    const separator = line.indexOf('=');
    const key = separator === -1 ? line : line.slice(0, separator);
    const value = separator === -1 ? '' : line.slice(separator + 1);
    const camelKey = key.replaceAll(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
    // Booleans and numbers must stay bare scalars — quoting would turn them
    // into strings for pnpm's settings parser; everything else is quoted.
    const scalar = /^(true|false|\d+)$/.test(value) ? value : JSON.stringify(value);
    return `${camelKey}: ${scalar}`;
  });
  // The repo's release-age cooldown and trust policy reach this scratch
  // project through the outer workspace, but their exemption lists do not, so
  // a first-party pin published today or a third-party release that
  // pnpm-workspace.yaml already vouches for fails the install. Restate all
  // four: the cooldown and the policy still defend every other dependency,
  // and only the packages the workspace already exempts are allowed past them.
  const workspaceYaml = [
    ...(overrideLines.length > 0 ? ['overrides:', ...overrideLines] : []),
    `minimumReleaseAge: ${MINIMUM_RELEASE_AGE_MINUTES}`,
    'minimumReleaseAgeExclude:',
    ...MINIMUM_RELEASE_AGE_EXCLUDE.map((name) => `  - ${JSON.stringify(name)}`),
    `trustPolicy: ${TRUST_POLICY}`,
    'trustPolicyExclude:',
    ...TRUST_POLICY_EXCLUDE.map((spec) => `  - ${JSON.stringify(spec)}`),
    ...settingLines,
  ];
  writeFileSync(
    join(scratchDir, 'pnpm-workspace.yaml'),
    workspaceYaml.length > 0 ? `${workspaceYaml.join('\n')}\n` : '{}\n',
  );
  if (options.npmrc !== undefined) {
    writeFileSync(join(scratchDir, '.npmrc'), `${options.npmrc.join('\n')}\n`);
  }
  try {
    const output = execFileSync('pnpm', ['install', '--ignore-scripts', '--prefer-offline'], {
      cwd: scratchDir,
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, npm_config_update_notifier: 'false' },
    });
    return { ok: true, output };
  } catch (error) {
    if (error instanceof Error && 'stderr' in error && 'stdout' in error) {
      return { ok: false, output: `${String(error.stdout)}\n${String(error.stderr)}` };
    }
    throw error;
  }
}

/** {@link tryInstallShells}, failing the test when the install does not succeed. */
export function installShells(
  scratchDir: string,
  shells: readonly PackedShell[],
  options: InstallOptions = {},
): void {
  const result = tryInstallShells(scratchDir, shells, options);
  if (!result.ok) throw new ShellTestError(`pnpm install failed:\n${result.output}`);
}

/**
 * Run a Node ES module inside the scratch project, where the packed shells
 * resolve like any published dependency (exports maps included). Throws with
 * the child's output on failure.
 */
export function runInScratch(scratchDir: string, scriptSource: string): string {
  const file = join(scratchDir, `check-${Math.random().toString(36).slice(2)}.mjs`);
  writeFileSync(file, scriptSource);
  try {
    return execFileSync(process.execPath, [file], { cwd: scratchDir, encoding: 'utf8' });
  } catch (error) {
    if (error instanceof Error && 'stderr' in error) {
      throw new ShellTestError(`scratch script failed:\n${String(error.stderr)}`);
    }
    throw error;
  }
}

/**
 * All import subpaths of an installed package: the exports-map keys minus
 * `./package.json` and minus `./bin/*`, which exist so a facade can forward
 * a command and run the program when imported.
 */
export function importSubpaths(installedPackageDir: string): string[] {
  const exports = readManifest(installedPackageDir)['exports'];
  if (!isRecord(exports)) {
    throw new ShellTestError(`${installedPackageDir}/package.json has no exports`);
  }
  return Object.keys(exports).filter(
    (key) => key !== './package.json' && !key.startsWith('./bin/'),
  );
}

/**
 * The internal package names the shell map states, as a set.
 *
 * The map is itself published — `@prisma/orm-toolchain/publish-surface/shells`
 * — because emission resolves generated import specifiers through it at run
 * time. Publishing it necessarily puts every internal package name into a
 * published dist as ordinary string data. Those strings are the table's
 * subject matter, not something the dist imports, and
 * {@link findInternalImportSpecifiers} — which has no allowlist — is what
 * would catch any of them turning into a real import.
 *
 * Derived from the map instead of listed, so it stays exactly the table's
 * contents: adding an internal package cannot quietly widen the check, and
 * the allowance applies only inside {@link shellMapModules}.
 */
const shellMapPackageNames: ReadonlySet<string> = new Set(
  [...publicShells.values()].flatMap((shell) => [
    ...shell.packages.map((pkg) => pkg.name),
    ...(shell.reexports ?? []).map((reexport) => reexport.package),
  ]),
);

/** Export subpath of the published shell map, as an exports-map key suffix. */
const SHELL_MAP_SUBPATH = '/publish-surface/shells';

/**
 * The dist files carrying the shell map in an installed package, empty for
 * every shell that does not publish it.
 *
 * Found by following the package's own exports map and then the relative
 * imports that entry reaches, rather than by matching a filename: the
 * bundler decides which chunk the table lands in, and a guessed name would
 * stop matching without anyone noticing.
 */
function shellMapModules(installedPackageDir: string): ReadonlySet<string> {
  const exports = readManifest(installedPackageDir)['exports'];
  if (!isRecord(exports)) return new Set();
  const key = Object.keys(exports).find((subpath) => subpath.endsWith(SHELL_MAP_SUBPATH));
  if (key === undefined) return new Set();
  const entry: unknown = exports[key];
  // Shells emit one file per entrypoint. A conditional-exports object would
  // mean the entry moved, and silently reading nothing would turn the whole
  // allowance off — so say so instead.
  if (typeof entry !== 'string') {
    throw new ShellTestError(
      `${installedPackageDir} exports ${key} as something other than a file`,
    );
  }

  const found = new Set<string>();
  const pending = [resolve(installedPackageDir, entry)];
  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined || found.has(file)) continue;
    found.add(file);
    const [imports] = parseModule(readFileSync(file, 'utf8'));
    for (const record of imports) {
      if (record.n?.startsWith('.')) pending.push(resolve(dirname(file), record.n));
    }
  }
  return found;
}

/**
 * Internal package names that published dists still carry as *string
 * constants* (not import specifiers), recorded when the shells were first
 * published.
 *
 * Most are emitter input: the specifiers the emitter and the migration
 * renderers hand to their import-specifier resolver before writing a user's
 * generated contract and migration files. That resolution is configurable, but
 * its default still returns them unchanged, so the constants necessarily
 * remain in the dist; changing the default to the published names retires
 * them. The rest name internal packages inside diagnostics,
 * config-validation messages, and telemetry identifiers, which go away with
 * the `@internal/*` names themselves.
 *
 * The shell map's own contents are *not* here — see
 * {@link shellMapPackageNames} for why they are recognised as data instead.
 *
 * This is a baseline lock, not an endorsement. Anything not listed fails
 * {@link findInternalNames}, so no *new* internal name can reach a
 * published dist while these are being worked through.
 */
export const knownInternalNamesInDist: readonly string[] = [
  '@internal/*',
  '@internal/adapter-mongo/codec-types',
  '@internal/adapter-postgres/operation-types',
  '@internal/adapter-sqlite/codec-types',
  '@internal/cli',
  '@internal/cli-telemetry',
  '@internal/cli-telemetry/sender',
  '@internal/cli/migration-cli',
  '@internal/config',
  '@internal/config/config-validation',
  '@internal/contract/types',
  '@internal/driver-mongo/control',
  '@internal/emitter',
  '@internal/errors/control',
  '@internal/extension-arktype-json',
  '@internal/extension-arktype-json/codec-types',
  '@internal/extension-paradedb/operation-types',
  '@internal/extension-pgvector',
  '@internal/extension-pgvector/codec-types',
  '@internal/extension-pgvector/operation-types',
  '@internal/extension-postgis',
  '@internal/extension-postgis/codec-types',
  '@internal/extension-postgis/operation-types',
  '@internal/family-mongo',
  '@internal/framework-components',
  '@internal/framework-components/codec',
  '@internal/framework-components/control',
  '@internal/framework-components/ir',
  '@internal/framework-components/psl-ast',
  '@internal/framework-components/runtime',
  '@internal/ids',
  '@internal/middleware-cache',
  '@internal/migration-tools',
  '@internal/migration-tools/aggregate',
  '@internal/migration-tools/io',
  '@internal/mongo',
  '@internal/mongo-contract',
  '@internal/mongo-orm',
  '@internal/mongo-runtime',
  '@internal/mongo/contract-builder',
  '@internal/mongo/runtime',
  '@internal/postgres',
  '@internal/postgres/contract-builder',
  '@internal/postgres/migration',
  '@internal/postgres/runtime',
  '@internal/sql-contract-psl/provider',
  '@internal/sql-contract/types',
  '@internal/sql-relational-core/ast',
  '@internal/sql-runtime',
  '@internal/sqlite/migration',
  '@internal/target-mongo/migration',
  '@internal/target-postgres',
  '@internal/target-postgres/codec-types',
  '@internal/target-postgres/codecs',
  '@internal/target-postgres/errors',
  '@internal/target-sqlite',
  '@internal/target-sqlite/errors',
  '@internal/utils',
  '@internal/utils/canonical-stringify',
  '@internal/utils/hash-content',
  '@internal/utils/structured-error',
  '@internal/vite-plugin-contract-emit',
];

/**
 * Scan an installed shell's dist for internal workspace package names.
 *
 * Covers every quoted string in the runtime `.mjs` files, not just import
 * specifiers, because the emitter ships import roots as ordinary string
 * constants and those land in a user's generated files. Declaration files
 * are scanned for import specifiers only — an internal name in JSDoc prose
 * is a documentation wart, not a resolution failure.
 *
 * One package publishes a table *of* internal package names, and inside the
 * modules that carry it those strings are the data rather than something the
 * dist would resolve; see {@link shellMapPackageNames}. That allowance is
 * scoped to those modules, so it cannot hide a name anywhere else.
 *
 * Returns offending `file: name` strings, excluding
 * {@link knownInternalNamesInDist}.
 */
export async function findInternalNames(installedPackageDir: string): Promise<string[]> {
  await initLexer;
  const known = new Set(knownInternalNamesInDist);
  const mapModules = shellMapModules(installedPackageDir);
  const offenders: string[] = [];
  const distDir = join(installedPackageDir, 'dist');
  for (const file of walk(distDir)) {
    if (file.endsWith('.mjs')) {
      const carriesShellMap = mapModules.has(file);
      for (const match of readFileSync(file, 'utf8').matchAll(
        /["'`](@internal\/[^"'`\s\\]+)["'`\\]/g,
      )) {
        const name = match[1] ?? '';
        if (known.has(name)) continue;
        if (carriesShellMap && shellMapPackageNames.has(name)) continue;
        offenders.push(`${file}: ${name}`);
      }
    } else if (file.endsWith('.d.mts')) {
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (/^\s*(\*|\/\/)/.test(line)) continue;
        for (const match of line.matchAll(
          /(?:from\s+|^\s*import\s+|import\()(["'])(@internal\/[^"']+)\1/g,
        )) {
          const name = match[2] ?? '';
          if (!known.has(name)) offenders.push(`${file}: ${name}`);
        }
      }
    }
  }
  return offenders;
}

/**
 * Import specifiers of internal workspace packages in an installed shell's
 * dist. These are resolution failures for a consumer — the internal
 * packages are not published — so unlike {@link findInternalNames} this has
 * no allowlist and must always be empty.
 */
export async function findInternalImportSpecifiers(installedPackageDir: string): Promise<string[]> {
  await initLexer;
  const offenders: string[] = [];
  for (const file of walk(join(installedPackageDir, 'dist'))) {
    if (!file.endsWith('.mjs')) continue;
    const [imports] = parseModule(readFileSync(file, 'utf8'));
    for (const record of imports) {
      if (record.n?.startsWith('@internal/')) offenders.push(`${file}: ${record.n}`);
    }
  }
  return offenders;
}

/**
 * Workspace source paths bundled into an installed package, read from its
 * sourcemaps, excluding the shell's own generated entry stubs. A shell must
 * only ever bundle the internal packages mapped to it — anything else is a
 * second copy of a module that another published package already owns.
 */
export function bundledSources(installedPackageDir: string): string[] {
  const sources = new Set<string>();
  for (const file of walk(join(installedPackageDir, 'dist'))) {
    if (!file.endsWith('.mjs.map')) continue;
    const map: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (!isRecord(map) || !Array.isArray(map['sources'])) continue;
    for (const source of map['sources']) {
      if (typeof source !== 'string') continue;
      const path = source.replace(/^(?:\.\.\/)+/, '');
      if (!path.startsWith('src-gen/')) sources.add(path);
    }
  }
  return [...sources].sort();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}
