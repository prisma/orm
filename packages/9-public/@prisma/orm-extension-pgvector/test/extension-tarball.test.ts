import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicShells, type ShellName } from '@internal/publish-surface/shells';
import {
  bundledSources,
  findInternalImportSpecifiers,
  findInternalNames,
  importSubpaths,
  installShells,
  type PackedShell,
  packShell,
  packShellAtVersion,
  runInScratch,
  tryInstallShells,
} from '@repo/tsdown/shell-testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..');
const workspaceVersion = (
  JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as { version: string }
).version;
const skewedVersion = workspaceVersion.replace(/\d+$/, (patch) => String(Number(patch) + 1));
const extension = '@prisma/orm-extension-pgvector';
const facade = '@prisma/orm-postgres';
const targetShell = '@prisma/orm-target-postgres';
const platform: ShellName[] = [
  '@prisma/orm-framework',
  '@prisma/orm-toolchain',
  '@prisma/orm-family-sql',
  '@prisma/orm-target-postgres',
];

function pack(scratch: string, names: readonly ShellName[]): PackedShell[] {
  return names.map((name) => {
    const shell = publicShells.get(name);
    if (shell === undefined) throw new Error(`unknown shell ${name}`);
    return packShell(join(repoRoot, shell.dir), scratch);
  });
}

describe('an extension pack installed next to the facade it extends', () => {
  let scratch: string;
  let installedDir: string;

  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), 'orm-extension-pgvector-'));
    // The target shell is declared alongside the facade because pnpm
    // resolves a peer range through the registry rather than through
    // `pnpm.overrides`, so a harness built on `file:` tarballs cannot
    // satisfy a peer that only arrives transitively. It is the same single
    // copy either way — which is what the identity assertion below checks.
    installShells(scratch, pack(scratch, [extension, facade, ...platform]), {
      direct: [extension, facade, targetShell],
    });
    installedDir = join(scratch, 'node_modules', '@prisma', 'orm-extension-pgvector');
  });

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it('resolves and imports every extension entrypoint', () => {
    const subpaths = importSubpaths(installedDir);
    expect(subpaths).toEqual([
      './codec-types',
      './column-types',
      './control',
      './operation-types',
      './pack',
      './runtime',
    ]);
    const script = [
      `const subpaths = ${JSON.stringify(subpaths)};`,
      'for (const subpath of subpaths) {',
      `  await import('${extension}' + subpath.slice(1));`,
      '}',
      `console.log('resolved ' + subpaths.length);`,
    ].join('\n');
    expect(runInScratch(scratch, script)).toContain(`resolved ${subpaths.length}`);
  });

  it('supports variable dimensions from the installed package', () => {
    expect(
      runInScratch(
        scratch,
        `
      import { strict as assert } from 'node:assert';
      import { vector } from '${extension}/column-types';
      import runtime from '${extension}/runtime';
      assert.deepEqual(vector().typeParams, {});
      const descriptor = runtime.codecs().find(codec => codec.codecId === 'pg/vector@1');
      const codec = descriptor.factory({})({ name: 'embedding' });
      for (const value of [[1], [1, 2, 3]]) {
        assert.deepEqual(await codec.decode(await codec.encode(value, {}), {}), value);
      }
      console.log('variable dimensions ok');
    `,
      ),
    ).toContain('variable dimensions ok');
  });

  it('requires its target shell as an exact-pinned peer, not a dependency', () => {
    const manifest: unknown = JSON.parse(readFileSync(join(installedDir, 'package.json'), 'utf8'));
    const { dependencies, peerDependencies } = Object(manifest) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    expect(peerDependencies?.[targetShell]).toBe(workspaceVersion);
    expect(dependencies?.[targetShell]).toBeUndefined();
  });

  it('resolves its target-shell requirement to the copy the facade uses', () => {
    const script = `
      import { strict as assert } from 'node:assert';
      import { createRequire } from 'node:module';
      const fromExtension = createRequire(import.meta.resolve('${extension}/package.json'));
      const fromFacade = createRequire(import.meta.resolve('${facade}/package.json'));
      const target = '${targetShell}/package.json';
      assert.equal(fromExtension.resolve(target), fromFacade.resolve(target));
      const viaExtension = await import(fromExtension.resolve('${targetShell}/adapter/runtime'));
      const viaFacade = await import('${facade}/adapter/runtime');
      assert.equal(viaExtension.default, viaFacade.default);
      console.log('peer ok');
    `;
    expect(runInScratch(scratch, script)).toContain('peer ok');
  });

  it('bundles only its own extension code', () => {
    const sources = bundledSources(installedDir);
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(source).toMatch(/^3-extensions\/pgvector\//);
    }
  });

  it('ships no unrecorded internal package name in dist', async () => {
    expect(await findInternalNames(installedDir)).toEqual([]);
  });

  it('ships no @internal import specifier in dist', async () => {
    expect(await findInternalImportSpecifiers(installedDir)).toEqual([]);
  });
});

// What the peer buys: an application that upgrades the facade without
// upgrading the extension would, under a hard dependency, quietly end up
// with two copies of the target shell and two codec registries. As a peer
// under strict resolution the same combination cannot install at all.
describe('an extension pack next to a target shell of a different version', () => {
  let scratch: string;

  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), 'orm-extension-pgvector-skew-'));
  });

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it('fails to install rather than resolving a second copy', () => {
    const targetDir = publicShells.get(targetShell)?.dir;
    if (targetDir === undefined) throw new Error(`unknown shell ${targetShell}`);
    // Everything the extension needs is packed except the target, which is
    // present one patch ahead — so the only thing that can fail is the peer.
    const packed = [
      ...pack(scratch, [
        extension,
        '@prisma/orm-framework',
        '@prisma/orm-family-sql',
        '@prisma/orm-toolchain',
      ]),
      packShellAtVersion(join(repoRoot, targetDir), scratch, skewedVersion),
    ];
    const result = tryInstallShells(scratch, packed, {
      direct: [extension, targetShell],
      npmrc: ['strict-peer-dependencies=true', 'auto-install-peers=false'],
    });
    const workspaceYaml = readFileSync(join(scratch, 'pnpm-workspace.yaml'), 'utf8');
    expect(workspaceYaml).toContain(`  ${JSON.stringify(extension)}: "file:`);
    expect(workspaceYaml).not.toContain(`  ${JSON.stringify(targetShell)}:`);
    expect(workspaceYaml).not.toContain('"@types/node"');
    expect(workspaceYaml).toContain('minimumReleaseAge: 1440\n');
    expect(workspaceYaml).toContain('strictPeerDependencies: true\n');
    expect(workspaceYaml).toContain('autoInstallPeers: false\n');
    expect(readFileSync(join(scratch, '.npmrc'), 'utf8')).toBe(
      'strict-peer-dependencies=true\nauto-install-peers=false\n',
    );
    expect(result.ok).toBe(false);
    // pnpm prints the offending version as `found <v>` in its tree-style
    // report and as `Installed: <v>` in the verbose one; assert the parts
    // common to both.
    expect(result.output).toContain(`unmet peer ${targetShell}`);
    expect(result.output).toContain(skewedVersion);
  });
});
