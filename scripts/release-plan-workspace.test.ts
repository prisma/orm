import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { planWorkspace, readPublishedManifests } from './release-plan-workspace.ts';

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

  for (const version of ['8.0.0', '8.1.0']) {
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
