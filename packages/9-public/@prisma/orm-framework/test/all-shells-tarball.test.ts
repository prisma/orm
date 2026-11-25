import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicShells } from '@internal/publish-surface/shells';
import {
  bundledSources,
  findInternalImportSpecifiers,
  findInternalNames,
  importSubpaths,
  installShells,
  packShell,
  runInScratch,
} from '@repo/tsdown/shell-testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..');
const allShells = [...publicShells.keys()];
const uncoveredElsewhere = [
  '@prisma/orm-family-mongo',
  '@prisma/orm-target-mongo',
  '@prisma/orm-target-sqlite',
  '@prisma/orm-sqlite',
  '@prisma/orm-target-mysql',
  '@prisma/orm-mysql',
  '@prisma/orm-target-mariadb',
  '@prisma/orm-mariadb',
  '@prisma/orm-mongo',
  '@prisma/orm-extension-postgis',
  '@prisma/orm-extension-paradedb',
  '@prisma/orm-extension-supabase',
  '@prisma/orm-extension-arktype-json',
  '@prisma/orm-extension-middleware-cache',
  '@prisma/orm-postgres-contrib',
];
const targetPackages = [...publicShells]
  .filter(([, shell]) => shell.kind === 'facade')
  .map(([name]) => name);
const namingGeneratedModules: readonly string[] = [
  '@prisma/orm-postgres',
  '@prisma/orm-sqlite',
  '@prisma/orm-mysql',
  '@prisma/orm-mariadb',
  '@prisma/orm-mongo',
];
const targetPlatformPackages = [...publicShells.keys()].filter((name) =>
  name.startsWith('@prisma/orm-target-'),
);
const COLLECT_DECLARED_MODULES = [
  'const collect = (value, into, seen = new Set()) => {',
  "  if (value === null || typeof value !== 'object' || seen.has(value)) return into;",
  '  seen.add(value);',
  "  if (typeof value.package === 'string' && typeof value.named === 'string') into.push(value.package);",
  '  for (const child of Object.values(value)) collect(child, into, seen);',
  '  return into;',
  '};',
].join('\n');
const extensionPackages = [...publicShells]
  .filter(([, shell]) => shell.kind === 'extension')
  .map(([name]) => name);
const statingTypeModules: readonly string[] = [
  '@prisma/orm-extension-postgis',
  '@prisma/orm-extension-pgvector',
  '@prisma/orm-extension-paradedb',
  '@prisma/orm-postgres-contrib',
  '@prisma/orm-extension-arktype-json',
];
const adrExampleNames = [
  '@prisma/orm-framework/contract',
  '@prisma/orm-framework/components',
  '@prisma/orm-framework/psl-parser',
  '@prisma/orm-family-sql/contract',
  '@prisma/orm-family-sql/runtime',
  '@prisma/orm-family-sql/orm-client',
  '@prisma/orm-target-postgres/target',
  '@prisma/orm-target-postgres/target/runtime',
  '@prisma/orm-target-postgres/adapter',
  '@prisma/orm-target-postgres/driver',
  '@prisma/orm-target-postgres/driver/runtime',
  '@prisma/orm-toolchain/cli',
  '@prisma/orm-postgres/runtime',
  '@prisma/orm-postgres/contract',
  '@prisma/orm-postgres/components',
  '@prisma/orm-sqlite/runtime',
  '@prisma/orm-mongo/runtime',
];

describe('all publish shells packed and installed together', () => {
  let scratch: string;

  function installedExports(name: string): Record<string, unknown> {
    const manifest: { exports?: Record<string, unknown> } = JSON.parse(
      readFileSync(join(scratch, 'node_modules', name, 'package.json'), 'utf8'),
    );
    return manifest.exports ?? {};
  }

  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), 'orm-all-shells-smoke-'));
    installShells(
      scratch,
      allShells.map((name) => {
        const shell = publicShells.get(name);
        if (shell === undefined) throw new Error(`unknown shell ${name}`);
        return packShell(join(repoRoot, shell.dir), scratch);
      }),
    );
  });

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it('installs every shell', () => {
    for (const name of allShells) {
      expect(existsSync(join(scratch, 'node_modules', name, 'package.json'))).toBe(true);
    }
  });

  it('resolves and imports every entrypoint of the shells not covered by the chain test', () => {
    const imports: string[] = [];
    for (const name of uncoveredElsewhere) {
      const installedDir = join(scratch, 'node_modules', name);
      for (const subpath of importSubpaths(installedDir)) {
        imports.push(`${name}${subpath.slice(1)}`);
      }
    }
    const script = [
      `const specifiers = ${JSON.stringify(imports)};`,
      'for (const specifier of specifiers) {',
      '  await import(specifier);',
      '}',
      "console.log('resolved ' + specifiers.length);",
    ].join('\n');
    expect(runInScratch(scratch, script)).toContain(`resolved ${imports.length}`);
  });

  it('resolves the aggregate entrypoint names promised by ADR 242', () => {
    const script = [
      `const specifiers = ${JSON.stringify(adrExampleNames)};`,
      'for (const specifier of specifiers) {',
      '  const mod = await import(specifier);',
      '  if (Object.keys(mod).length === 0) throw new Error(specifier + " is empty");',
      '}',
      "console.log('adr names ok');",
    ].join('\n');
    expect(runInScratch(scratch, script)).toContain('adr names ok');
  });

  it('ships no unrecorded internal package name in any shell dist', async () => {
    for (const name of allShells) {
      const installedDir = join(scratch, 'node_modules', name);
      expect(await findInternalNames(installedDir)).toEqual([]);
    }
  });

  it('ships no @internal import specifier in any shell dist', async () => {
    for (const name of allShells) {
      const installedDir = join(scratch, 'node_modules', name);
      expect(await findInternalImportSpecifiers(installedDir)).toEqual([]);
    }
  });

  it('fills in the published module base wherever a shell bundles code that reads it', () => {
    const unfilled: string[] = [];
    for (const name of allShells) {
      const distDir = join(scratch, 'node_modules', name, 'dist');
      const builtFiles = readdirSync(distDir, { recursive: true, encoding: 'utf8' }).filter(
        (file) => file.endsWith('.mjs'),
      );
      expect(builtFiles.length, name).toBeGreaterThan(0);
      for (const file of builtFiles) {
        if (
          readFileSync(join(distDir, file), 'utf8').includes('__PRISMA_PUBLISHED_MODULE_BASE__')
        ) {
          unfilled.push(`${name}/dist/${file}`);
        }
      }
    }
    expect(unfilled).toEqual([]);
  });

  it('names only its own published exports as the modules generated files import from', () => {
    const configPackages = targetPackages.filter((name) =>
      Object.hasOwn(installedExports(name), './config'),
    );
    expect(configPackages).toEqual(expect.arrayContaining(namingGeneratedModules));
    const script = [
      `const names = ${JSON.stringify(configPackages)};`,
      'const named = {};',
      'for (const name of names) {',
      "  const { defineConfig } = await import(name + '/config');",
      "  const config = defineConfig({ contract: './prisma/contract.prisma' });",
      '  named[name] = [config.contract?.typesModule ?? null, config.migrations?.module ?? null];',
      '}',
      'console.log(JSON.stringify(named));',
    ].join('\n');
    const named: Record<string, [string | null, string | null]> = JSON.parse(
      runInScratch(scratch, script),
    );

    const problems: string[] = [];
    for (const name of configPackages) {
      const modules = named[name] ?? [null, null];
      if (!namingGeneratedModules.includes(name)) {
        if (modules.some((module) => module !== null)) {
          problems.push(`${name} names ${modules.join(', ')} but is not listed as naming modules`);
        }
        continue;
      }
      const exports = installedExports(name);
      for (const module of modules) {
        if (module?.startsWith('@internal/')) {
          problems.push(`${name} names the private module ${module}`);
        } else if (module === null || !module.startsWith(`${name}/`)) {
          problems.push(`${name} names ${module}, which is not a subpath of ${name}`);
        } else if (!Object.hasOwn(exports, `.${module.slice(name.length)}`)) {
          problems.push(`${name} names ${module}, which ${name} does not export`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('states only its own published exports as the modules its target and adapter types come from', () => {
    const entrypoints = targetPlatformPackages.flatMap((name) =>
      ['./target/control', './adapter/control']
        .filter((subpath) => Object.hasOwn(installedExports(name), subpath))
        .map((subpath) => [name, `${name}${subpath.slice(1)}`]),
    );
    const script = [
      COLLECT_DECLARED_MODULES,
      `const entrypoints = ${JSON.stringify(entrypoints)};`,
      'const stated = {};',
      'for (const [name, specifier] of entrypoints) {',
      '  collect((await import(specifier)).default?.types, (stated[name] ??= []));',
      '}',
      'console.log(JSON.stringify(stated));',
    ].join('\n');
    const stated: Record<string, string[]> = JSON.parse(runInScratch(scratch, script));

    const problems: string[] = [];
    for (const name of targetPlatformPackages) {
      const modules = stated[name] ?? [];
      if (modules.length === 0) problems.push(`${name} states no module for its types`);
      const exports = installedExports(name);
      for (const module of modules) {
        if (!module.startsWith(`${name}/`)) {
          problems.push(`${name} states ${module}, which is not a subpath of ${name}`);
        } else if (!Object.hasOwn(exports, `.${module.slice(name.length)}`)) {
          problems.push(`${name} states ${module}, which ${name} does not export`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('names its own contract-types export in every type declaration of the config its defineConfig returns', () => {
    const script = [
      COLLECT_DECLARED_MODULES,
      `const names = ${JSON.stringify(namingGeneratedModules)};`,
      'const stated = {};',
      'for (const name of names) {',
      "  const { defineConfig } = await import(name + '/config');",
      "  const config = defineConfig({ contract: './prisma/contract.prisma' });",
      '  stated[name] = collect([config.target.types, config.adapter.types], []);',
      '}',
      'console.log(JSON.stringify(stated));',
    ].join('\n');
    const stated: Record<string, string[]> = JSON.parse(runInScratch(scratch, script));

    const problems: string[] = [];
    for (const name of namingGeneratedModules) {
      const modules = stated[name] ?? [];
      if (modules.length === 0) problems.push(`${name} states no module for its types`);
      for (const module of modules) {
        if (module !== `${name}/contract-types`) problems.push(`${name} states ${module}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('imports its target and adapter types only from its own exports when its control client emits', () => {
    const controlPackages = namingGeneratedModules.filter((name) =>
      Object.hasOwn(installedExports(name), './control'),
    );
    expect(controlPackages.length).toBeGreaterThan(0);
    const script = [
      "import { mkdirSync, writeFileSync } from 'node:fs';",
      "import { join } from 'node:path';",
      COLLECT_DECLARED_MODULES,
      `const names = ${JSON.stringify(controlPackages)};`,
      "const model = { '@prisma/orm-mongo': 'model User {\\n  id ObjectId @id @map(\"_id\")\\n}\\n' };",
      'const imported = {};',
      'for (const name of names) {',
      "  const dir = join(process.cwd(), 'emit-' + name.replace(/[@/]/g, '-'));",
      '  mkdirSync(dir, { recursive: true });',
      "  const contract = join(dir, 'contract.prisma');",
      "  writeFileSync(contract, '// use prisma-8\\n\\n' + (model[name] ?? 'model User {\\n  id Int @id\\n}\\n'));",
      "  const { defineConfig } = await import(name + '/config');",
      '  const config = defineConfig({ contract });',
      '  const aliases = new Set();',
      '  const walk = (value) => {',
      "    if (value === null || typeof value !== 'object') return;",
      "    if (typeof value.package === 'string' && typeof value.alias === 'string') aliases.add(value.alias);",
      '    for (const child of Object.values(value)) walk(child);',
      '  };',
      '  walk([config.target.types, config.adapter.types]);',
      "  const { createControlClient } = await import(name + '/control').then((control) => ({",
      "    createControlClient: Object.values(control).find((value) => typeof value === 'function'),",
      '  }));',
      '  const emitted = await createControlClient().emit({ contractConfig: config.contract });',
      '  if (!emitted.ok) throw new Error(JSON.stringify(emitted.failure));',
      "  imported[name] = [...emitted.value.contractDts.matchAll(/import type \\{([^}]*)\\} from '([^']+)';/g)]",
      "    .filter(([, names]) => names.split(',').some((each) => aliases.has(each.trim().split(/\\s+as\\s+/).at(-1))))",
      '    .map(([, , module]) => module);',
      '}',
      'console.log(JSON.stringify(imported));',
    ].join('\n');
    const imported: Record<string, string[]> = JSON.parse(runInScratch(scratch, script));

    const problems: string[] = [];
    for (const name of controlPackages) {
      const modules = imported[name] ?? [];
      if (modules.length === 0)
        problems.push(`${name} emitted no import of its target and adapter types`);
      for (const module of modules) {
        if (module !== `${name}/contract-types`)
          problems.push(`${name} emitted an import from ${module}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('ships no type declaration naming an @internal module in any built or declaration file', () => {
    const offenders: string[] = [];
    for (const name of allShells) {
      const distDir = join(scratch, 'node_modules', name, 'dist');
      const files = readdirSync(distDir, { recursive: true, encoding: 'utf8' }).filter(
        (file) => file.endsWith('.mjs') || file.endsWith('.d.mts'),
      );
      expect(files.length, name).toBeGreaterThan(0);
      for (const file of files) {
        for (const match of readFileSync(join(distDir, file), 'utf8').matchAll(
          /\bpackage:\s*["'`](@internal\/[^"'`]+)["'`][,;]?\s*(?:readonly\s+)?named:/g,
        )) {
          offenders.push(`${name}/dist/${file}: ${match[1]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('imports no # module in any built or declaration file that its own package does not declare', () => {
    const offenders: string[] = [];
    for (const name of allShells) {
      const installedDir = join(scratch, 'node_modules', name);
      const manifest: { imports?: Record<string, unknown> } = JSON.parse(
        readFileSync(join(installedDir, 'package.json'), 'utf8'),
      );
      const declared = new Set(Object.keys(manifest.imports ?? {}));
      const distDir = join(installedDir, 'dist');
      const files = readdirSync(distDir, { recursive: true, encoding: 'utf8' }).filter(
        (file) => file.endsWith('.mjs') || file.endsWith('.d.mts'),
      );
      expect(files.length, name).toBeGreaterThan(0);
      for (const file of files) {
        for (const match of readFileSync(join(distDir, file), 'utf8').matchAll(
          /(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s*)(["'])(#[^"']+)\1/gm,
        )) {
          if (!declared.has(match[2] ?? '')) offenders.push(`${name}/dist/${file}: ${match[2]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('states only its own published exports as the modules extension types come from', () => {
    expect(extensionPackages).toEqual(expect.arrayContaining(statingTypeModules));
    const controlEntrypoints = extensionPackages.flatMap((name) =>
      Object.keys(installedExports(name))
        .filter((subpath) => subpath === './control' || subpath.endsWith('/control'))
        .map((subpath) => [name, `${name}${subpath.slice(1)}`]),
    );
    const script = [
      `const entrypoints = ${JSON.stringify(controlEntrypoints)};`,
      'const stated = {};',
      COLLECT_DECLARED_MODULES,
      'for (const [name, specifier] of entrypoints) {',
      '  const descriptor = (await import(specifier)).default;',
      '  collect(descriptor?.types, (stated[name] ??= []));',
      '}',
      'console.log(JSON.stringify(stated));',
    ].join('\n');
    const stated: Record<string, string[]> = JSON.parse(runInScratch(scratch, script));

    const problems: string[] = [];
    for (const name of extensionPackages) {
      const modules = stated[name] ?? [];
      if (!statingTypeModules.includes(name)) {
        if (modules.length > 0) {
          problems.push(
            `${name} states ${modules.join(', ')} but is not listed as stating modules`,
          );
        }
        continue;
      }
      if (modules.length === 0) problems.push(`${name} states no module for its types`);
      const exports = installedExports(name);
      for (const module of modules) {
        if (module.startsWith('@internal/')) {
          problems.push(`${name} states the private module ${module}`);
        } else if (!module.startsWith(`${name}/`)) {
          problems.push(`${name} states ${module}, which is not a subpath of ${name}`);
        } else if (!Object.hasOwn(exports, `.${module.slice(name.length)}`)) {
          problems.push(`${name} states ${module}, which ${name} does not export`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  // The identity rule of ADR 242: an internal module is published from
  // exactly one package. A shell that bundled a module mapped to another
  // shell would ship a second copy of it, and anyone who installs both would
  // have values one copy made that the other does not recognise.
  it('bundles only the internal packages mapped to it', () => {
    const strays: string[] = [];
    for (const name of allShells) {
      const shell = publicShells.get(name);
      if (shell === undefined) throw new Error(`unknown shell ${name}`);
      const owned = shell.packages.map((pkg) => `${pkg.dir}/`);
      const sources = bundledSources(join(scratch, 'node_modules', name));
      expect(sources.length).toBeGreaterThan(0);
      for (const source of sources) {
        const path = `packages/${source}`;
        if (!owned.some((dir) => path.startsWith(dir))) strays.push(`${name}: ${path}`);
      }
    }
    expect(strays).toEqual([]);
  });
});
