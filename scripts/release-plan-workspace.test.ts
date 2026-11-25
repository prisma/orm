import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { alreadyPublishedOwnNumbered, releaseTagsFor } from './publish-packages-utils.mjs';
import {
  planWorkspace,
  planWorkspaceThrough,
  readPublishedManifests,
  releaseOfRootVersion,
} from './release-plan-workspace.ts';
import { rewriteManifestByPlan } from './set-version-utils.ts';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const rootVersion: string = JSON.parse(
  readFileSync(join(rootDir, 'package.json'), 'utf-8'),
).version;
const SCOPE = '@prisma/orm-';

function printed(...args: string[]): string {
  return execFileSync(
    process.execPath,
    [join(rootDir, 'scripts', 'print-release-plan.ts'), ...args],
    {
      encoding: 'utf-8',
    },
  );
}

/** A table with its column padding collapsed, so a change of width alone does not fail the comparison. */
function rows(table: string): string[] {
  return table
    .trim()
    .split('\n')
    .map((row) => row.trim().replace(/ {2,}/g, '  '));
}

function expectation(name: string): string {
  return readFileSync(join(rootDir, 'scripts', 'fixtures', 'release-plan', name), 'utf-8');
}

describe('print-release-plan', () => {
  it('prints the committed expectation for the root version', () => {
    assert.deepEqual(
      rows(printed()),
      rows(expectation('root.txt').replaceAll('<root>', rootVersion)),
    );
  });

  for (const version of ['8.0.1', '8.1.0']) {
    it(`prints the committed expectation for ${version}`, () => {
      assert.deepEqual(rows(printed(version)), rows(expectation(`${version}.txt`)));
    });
  }
});

describe('the plan for the root version', () => {
  const plan = planWorkspace(rootDir, rootVersion);

  it('is what every committed published manifest holds: its version and each specifier on ours', () => {
    for (const manifest of readPublishedManifests(rootDir).values()) {
      const planned = plan[manifest.name];
      assert.ok(planned, `no plan for ${manifest.name}`);
      assert.equal(manifest.version, planned.version, manifest.name);
      const peers = Object.entries(manifest.peerDependencies ?? {}).filter(([peer]) =>
        peer.startsWith(SCOPE),
      );
      assert.deepEqual(
        Object.fromEntries(peers),
        Object.fromEntries(
          Object.entries(planned.ranges).map(([named, range]) => [named, `workspace:${range}`]),
        ),
        manifest.name,
      );
    }
  });

  it('publishes on the 8.0.0 release candidates exactly what one version for all did: every package at the root version, exact ranges, tag latest', () => {
    if (!/^8\.0\.0-rc\.\d+$/.test(rootVersion)) return;
    for (const manifest of readPublishedManifests(rootDir).values()) {
      const named = Object.keys(manifest.peerDependencies ?? {}).filter((peer) =>
        peer.startsWith(SCOPE),
      );
      assert.deepEqual(plan[manifest.name], {
        version: rootVersion,
        tag: 'latest',
        ranges: Object.fromEntries(named.map((name) => [name, rootVersion])),
      });
    }
  });
});

/** A copy of the published manifests, at the paths the plan reads them from. */
function scratchWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'release-plan-dry-run-'));
  for (const rel of readPublishedManifests(rootDir).keys()) {
    mkdirSync(join(dir, rel), { recursive: true });
    writeFileSync(
      join(dir, rel, 'package.json'),
      readFileSync(join(rootDir, rel, 'package.json'), 'utf-8'),
    );
  }
  return dir;
}

/** What `set-version <version>` writes into each published manifest of `dir`. */
function setVersion(dir: string, version: string): void {
  const plan = planWorkspace(dir, version);
  const { line } = releaseOfRootVersion(version);
  for (const rel of readPublishedManifests(dir).keys()) {
    const path = join(dir, rel, 'package.json');
    const manifest = JSON.parse(readFileSync(path, 'utf-8'));
    rewriteManifestByPlan(manifest, { version, line, plan });
    writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  }
}

/** Each manifest's version and its peer specifiers on ours as packing publishes them. */
function packed(dir: string): Record<string, { version: string; ranges: Record<string, string> }> {
  return Object.fromEntries(
    [...readPublishedManifests(dir).values()].map((manifest) => [
      manifest.name,
      {
        version: manifest.version,
        ranges: Object.fromEntries(
          Object.entries(manifest.peerDependencies ?? {})
            .filter(([peer]) => peer.startsWith(SCOPE))
            .map(([peer, spec]) => [peer, spec.replace(/^workspace:/, '')]),
        ),
      },
    ]),
  );
}

describe('a dry run of set-version and the publish planning on a copy of the manifests', () => {
  it('leaves every manifest byte for byte as it is for the root version', () => {
    const dir = scratchWorkspace();
    try {
      const before = [...readPublishedManifests(dir).keys()].map((rel) =>
        readFileSync(join(dir, rel, 'package.json'), 'utf-8'),
      );
      setVersion(dir, rootVersion);
      const after = [...readPublishedManifests(dir).keys()].map((rel) =>
        readFileSync(join(dir, rel, 'package.json'), 'utf-8'),
      );
      assert.deepEqual(after, before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes and tags what the printed plans for 8.0.1 and then 8.1.0 say, and skips what is already published', () => {
    const dir = scratchWorkspace();
    try {
      for (const version of ['8.0.1', '8.1.0']) {
        const published = packed(dir);
        setVersion(dir, version);
        const { plan } = planWorkspaceThrough(rootDir, version);
        const written = packed(dir);
        assert.deepEqual(
          written,
          Object.fromEntries(
            Object.entries(plan).map(([name, planned]) => [
              name,
              { version: planned.version, ranges: planned.ranges },
            ]),
          ),
          version,
        );
        const tags = releaseTagsFor({
          rootDir: dir,
          rootVersion: version,
          names: Object.keys(plan),
          publishedVersions: () => [],
        });
        assert.deepEqual(
          Object.fromEntries(tags),
          Object.fromEntries(Object.entries(plan).map(([name, planned]) => [name, planned.tag])),
          version,
        );
        const skipped = alreadyPublishedOwnNumbered({
          rootVersion: version,
          packages: Object.entries(written).map(([name, { version: v }]) => ({ name, version: v })),
          publishedVersions: (name: string) => [published[name]?.version ?? ''],
        });
        assert.deepEqual(
          skipped,
          version === '8.1.0' ? ['@prisma/orm-extension-paradedb'] : [],
          version,
        );
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
